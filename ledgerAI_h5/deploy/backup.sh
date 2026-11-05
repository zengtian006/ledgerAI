#!/usr/bin/env bash
# Nightly Postgres dump to S3. Cron: 0 3 * * * /opt/ledgerai/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source .env
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T db pg_dump -U ledger -d ledgerai --format=custom | \
  aws s3 cp - "s3://${S3_BUCKET}/backups/ledgerai-${STAMP}.dump" --sse AES256
