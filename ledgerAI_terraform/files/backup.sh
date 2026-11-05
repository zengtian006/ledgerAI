#!/bin/bash
# Nightly Postgres dump to S3 (cron). Old dumps expire via the bucket lifecycle rule.
set -euo pipefail
source /opt/ledgerai/instance.conf
export AWS_DEFAULT_REGION="$REGION"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker exec "$NAME-db" pg_dump -U ledger -d ledgerai --format=custom |
  aws s3 cp - "s3://$BUCKET/backups/ledgerai-$STAMP.dump" --sse AES256 --only-show-errors
echo "backup ledgerai-$STAMP.dump uploaded"
