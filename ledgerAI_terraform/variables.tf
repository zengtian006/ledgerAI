variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  description = "Prefix for resource names and the SSM parameter path (/<name>/...)"
  type        = string
  default     = "ledgerai"
}

variable "availability_zone" {
  description = "AZ for the EC2 instance and its data volume (default VPC subnet)"
  type        = string
  default     = "us-east-1a"
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "data_volume_gb" {
  description = "Size of the EBS volume holding the Postgres data"
  type        = number
  default     = 20
}

variable "gemini_api_key" {
  description = "Google Gemini API key (set with TF_VAR_gemini_api_key; stored in SSM Parameter Store)"
  type        = string
  sensitive   = true
}

variable "gemini_model" {
  type    = string
  default = "gemini-3.5-flash"
}

variable "gemini_fallback_model" {
  type    = string
  default = "gemini-3.5-flash-lite"
}

variable "default_currency" {
  description = "Currency given to new users until they choose a country"
  type        = string
  default     = "GBP"
}

variable "api_source_dir" {
  description = "Path to the API source that is zipped and deployed to the instance"
  type        = string
  default     = "../ledgerAI_h5/api"
}

variable "price_class" {
  type    = string
  default = "PriceClass_All"
}

variable "cognito_deletion_protection" {
  type    = string
  default = "INACTIVE"
}

variable "backup_retention_days" {
  description = "Days to keep nightly pg_dump files in S3"
  type        = number
  default     = 60
}

variable "admin_emails" {
  description = "Emails allowed to open /admin (must be verified Cognito accounts)"
  type        = list(string)
  default     = []
}

variable "root_domain" {
  description = "Domain registered in Route 53 (hosted zone must exist). The app is served at www.<root_domain>; the apex redirects there. Leave empty to use only the cloudfront.net address."
  type        = string
  default     = ""
}
