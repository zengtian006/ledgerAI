output "app_url" {
  description = "Open this on your phone"
  value       = local.use_domain ? "https://${local.www_host}" : "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_url" {
  description = "Default CloudFront address (keeps working alongside the custom domain)"
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "web_bucket" {
  value = aws_s3_bucket.web.id
}

output "data_bucket" {
  value = aws_s3_bucket.data.id
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_ios_client_id" {
  description = "App client used by the iOS app"
  value       = aws_cognito_user_pool_client.ios.id
}

output "instance_id" {
  value = aws_instance.api.id
}

output "api_public_ip" {
  value = aws_eip.api.public_ip
}

output "region" {
  value = var.region
}
