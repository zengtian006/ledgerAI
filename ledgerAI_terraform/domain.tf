locals {
  use_domain = var.root_domain != ""
  www_host   = "www.${var.root_domain}"
  app_hosts  = local.use_domain ? [local.www_host, var.root_domain] : []
}

data "aws_route53_zone" "main" {
  count        = local.use_domain ? 1 : 0
  name         = var.root_domain
  private_zone = false
}

# CloudFront certificates must be issued in us-east-1, which is this stack's region
resource "aws_acm_certificate" "main" {
  count                     = local.use_domain ? 1 : 0
  domain_name               = local.www_host
  subject_alternative_names = [var.root_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.use_domain ? {
    for o in aws_acm_certificate.main[0].domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  } : {}

  zone_id         = data.aws_route53_zone.main[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count                   = local.use_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "app_a" {
  for_each = toset(local.app_hosts)
  zone_id  = data.aws_route53_zone.main[0].zone_id
  name     = each.key
  type     = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_aaaa" {
  for_each = toset(local.app_hosts)
  zone_id  = data.aws_route53_zone.main[0].zone_id
  name     = each.key
  type     = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}
