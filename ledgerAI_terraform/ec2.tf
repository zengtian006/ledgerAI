data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "api" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Only CloudFront's edge servers can reach the API; there is no SSH port (use SSM Session Manager).
resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "LedgerAI API: HTTP from CloudFront only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "HTTP from CloudFront origin-facing servers"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "Outbound (Gemini, AWS APIs, Docker Hub)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.api.id
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name

  user_data = templatefile("${path.module}/files/bootstrap.sh.tftpl", {
    name      = var.name
    region    = var.region
    bucket    = aws_s3_bucket.data.id
    deploy_sh = file("${path.module}/files/deploy.sh")
    backup_sh = file("${path.module}/files/backup.sh")
  })

  # IMDSv2 only; hop limit 2 so the Docker container can reach the instance role credentials
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  # Postgres data lives on its own volume that survives instance replacement
  ebs_block_device {
    device_name           = "/dev/sdf"
    volume_type           = "gp3"
    volume_size           = var.data_volume_gb
    encrypted             = true
    delete_on_termination = false
    tags                  = { Name = "${var.name}-data", Snapshot = var.name }
  }

  tags = { Name = "${var.name}-api" }

  # Code is deployed by scripts/deploy.sh (SSM Run Command), never by recreating the instance
  lifecycle {
    ignore_changes = [user_data, ami]
  }

  depends_on = [
    aws_s3_object.api_code,
    aws_ssm_parameter.plain,
    aws_ssm_parameter.database_url,
    aws_ssm_parameter.postgres_password,
    aws_ssm_parameter.gemini_api_key,
    aws_ssm_parameter.origin_verify_secret,
    aws_iam_role_policy.api,
    aws_iam_role_policy_attachment.ssm_core,
  ]
}

resource "aws_eip" "api" {
  domain   = "vpc"
  instance = aws_instance.api.id
  tags     = { Name = "${var.name}-api" }
}
