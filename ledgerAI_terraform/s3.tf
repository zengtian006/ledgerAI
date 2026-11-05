locals {
  web_bucket      = "${var.name}-${data.aws_caller_identity.current.account_id}-web"
  receipts_bucket = "${var.name}-${data.aws_caller_identity.current.account_id}-data"
}

# ---------- Frontend (served only through CloudFront) ----------
resource "aws_s3_bucket" "web" {
  bucket        = local.web_bucket
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web.json
}

# ---------- Receipt images, API deploy bundle and DB backups (private) ----------
resource "aws_s3_bucket" "data" {
  bucket = local.receipts_bucket
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "expire-db-backups"
    status = "Enabled"
    filter { prefix = "backups/" }
    expiration { days = var.backup_retention_days }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# ---------- API code bundle pulled by the instance ----------
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/${var.api_source_dir}"
  output_path = "${path.module}/.build/api.zip"
  excludes    = ["node_modules", ".env", ".pgdata", "uploads", "test", "scripts"]
}

resource "aws_s3_object" "api_code" {
  bucket = aws_s3_bucket.data.id
  key    = "deploy/api.zip"
  source = data.archive_file.api.output_path
  etag   = data.archive_file.api.output_md5
}
