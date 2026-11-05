# The instance turns every parameter under /<name>/ into an environment variable for the API container
# (parameter name == variable name), so changing config never needs a rebuild of the instance.

resource "random_password" "db" {
  length  = 32
  special = false
}

# CloudFront adds this header to every origin request; the API rejects requests without it.
resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "postgres_password" {
  name  = "/${var.name}/POSTGRES_PASSWORD"
  type  = "SecureString"
  value = random_password.db.result
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.name}/DATABASE_URL"
  type  = "SecureString"
  value = "postgres://ledger:${random_password.db.result}@${var.name}-db:5432/ledgerai"
}

resource "aws_ssm_parameter" "gemini_api_key" {
  name  = "/${var.name}/GEMINI_API_KEY"
  type  = "SecureString"
  value = var.gemini_api_key
}

resource "aws_ssm_parameter" "origin_verify_secret" {
  name  = "/${var.name}/ORIGIN_VERIFY_SECRET"
  type  = "SecureString"
  value = random_password.origin_secret.result
}

locals {
  plain_params = {
    NODE_ENV              = "production"
    AUTH_MODE             = "cognito"
    COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
    COGNITO_CLIENT_ID     = "${aws_cognito_user_pool_client.web.id},${aws_cognito_user_pool_client.ios.id}"
    STORAGE_DRIVER        = "s3"
    S3_BUCKET             = aws_s3_bucket.data.id
    AWS_REGION            = var.region
    TRUST_PROXY_HOPS      = "1"
    DEFAULT_CURRENCY      = var.default_currency
    GEMINI_MODEL          = var.gemini_model
    GEMINI_FALLBACK_MODEL = var.gemini_fallback_model
  }
}

resource "aws_ssm_parameter" "plain" {
  for_each = merge(
    local.plain_params,
    length(var.admin_emails) > 0 ? { ADMIN_EMAILS = join(",", var.admin_emails) } : {},
  )
  name  = "/${var.name}/${each.key}"
  type  = "String"
  value = each.value
}
