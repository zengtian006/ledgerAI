# LedgerAI – AWS infrastructure (Terraform, us-east-1)

One CloudFront distribution serves both the app and the API (the web app calls a relative `/api`). With `root_domain` set it is served at `https://www.<root_domain>` (ACM certificate + Route 53 records are created automatically; the apex redirects to `www`); the default `*.cloudfront.net` address keeps working.

```
 Phone ──HTTPS──▶ www.ledgerai.click → CloudFront (ACM certificate)
                    ├─ /*      → S3 web bucket (private, Origin Access Control; SPA rewrite function)
                    └─ /api/*  → EC2 (HTTP :80, caching off, Authorization forwarded, secret header added)
                                   │
   Cognito user pool ◀── token verified by the API (aws-jwt-verify)
                                   ▼
        EC2 t4g.small (Amazon Linux 2023, Docker)
          ├─ ledgerai-api  (Node/Express)  ──▶ S3 data bucket (receipt images, presigned URLs)
          ├─ ledgerai-db   (Postgres 16)   ──▶ EBS gp3 data volume (/data, survives instance replacement)
          └─ config/secrets from SSM Parameter Store (/ledgerai/*), outbound HTTPS to Gemini
        Nightly pg_dump → s3://<data-bucket>/backups/  ·  daily EBS snapshots (DLM, keep 7)
```

## What gets created (41 resources)
S3 (web, data), CloudFront + OAC + SPA function, Cognito user pool + app client, EC2 + Elastic IP + security group,
two Cognito app clients (web, iOS), IAM roles (instance, DLM), SSM parameters, DLM snapshot policy.

## Deploy
Prerequisites: Terraform ≥ 1.6, AWS CLI configured for the target account, Node 22+.

```bash
cd ledgerAI_terraform
./scripts/deploy.sh
```
The script runs `terraform apply`, builds the web app with the Cognito IDs, syncs it to S3, invalidates CloudFront and
redeploys the API on the instance through SSM Run Command. The Gemini key is read from `../ledgerAI_h5/api/.env`
(or `TF_VAR_gemini_api_key`). Use `./scripts/deploy.sh --skip-infra` for code-only releases.
The app URL is printed at the end (`terraform output app_url`).

## Security notes
- The instance accepts HTTP only from CloudFront's origin-facing prefix list, and the API also rejects requests that lack the
  `X-Origin-Verify` secret CloudFront adds. There is no SSH port; use `aws ssm start-session --target <instance-id>`.
- The CloudFront → EC2 hop is plain HTTP. With a domain you can now add TLS on that hop (e.g. `origin.<root_domain>` with a certificate on the instance), or use a CloudFront VPC origin with a private subnet.
- Secrets (Gemini key, DB password, origin secret) live in SSM as SecureStrings. **Terraform state also contains them**;
  state is local (`terraform.tfstate`, git-ignored). Move it to an encrypted S3 backend before sharing the project.
- Cognito verification codes still use its default email sender (limited to 50 emails/day); switching Cognito itself to SES is a separate configuration.

## Operations
| Task | How |
|---|---|
| Admin dashboard | `https://<app_url>/admin`, limited to `admin_emails` (Cognito-verified addresses) |
| Release new API/web code | `./scripts/deploy.sh --skip-infra` |
| View API logs | `aws ssm start-session --target <id>` then `docker logs -f ledgerai-api` |
| Change config / secrets | Edit variables, `terraform apply`, then redeploy (the instance re-reads `/ledgerai/*`) |
| Restore a backup | `aws s3 cp s3://<data-bucket>/backups/<file> -` then `pg_restore` into `ledgerai-db` |
| Tear down | `terraform destroy`; the database EBS volume is kept (`delete_on_termination = false`) and must be deleted by hand |

Estimated cost: about $15-20/month (t4g.small, EBS, Elastic IP, data transfer); CloudFront, S3, Cognito and SSM are near zero at small scale.
