#!/bin/bash
# Pulls the latest API bundle from S3, rebuilds the image and restarts the containers.
# Runs at first boot and on every deployment (via SSM Run Command). Safe to run repeatedly.
set -euo pipefail

source /opt/ledgerai/instance.conf   # NAME, REGION, BUCKET
export AWS_DEFAULT_REGION="$REGION"
WORK=/opt/ledgerai

exec 9>/var/lock/ledgerai-deploy.lock
flock 9

echo "[deploy] fetching code"
aws s3 cp "s3://$BUCKET/deploy/api.zip" /tmp/api.zip --only-show-errors
rm -rf "$WORK/api"
mkdir -p "$WORK/api"
unzip -q -o /tmp/api.zip -d "$WORK/api"

echo "[deploy] loading config from SSM /$NAME/"
umask 077
aws ssm get-parameters-by-path --path "/$NAME/" --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r pname pvalue; do echo "${pname##*/}=$pvalue"; done > "$WORK/all.env"
PGPASS=$(grep '^POSTGRES_PASSWORD=' "$WORK/all.env" | cut -d= -f2-)
grep -v '^POSTGRES_PASSWORD=' "$WORK/all.env" > "$WORK/api.env"
rm -f "$WORK/all.env"

docker network create "$NAME" >/dev/null 2>&1 || true

echo "[deploy] database"
if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME-db"; then
  docker run -d --name "$NAME-db" --restart unless-stopped --network "$NAME" \
    -e POSTGRES_USER=ledger -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=ledgerai \
    -e PGDATA=/var/lib/postgresql/data/pgdata \
    -v /data/postgres:/var/lib/postgresql/data \
    postgres:16-alpine
else
  docker start "$NAME-db" >/dev/null 2>&1 || true
fi
for i in $(seq 1 60); do
  docker exec "$NAME-db" pg_isready -U ledger -d ledgerai >/dev/null 2>&1 && break
  sleep 2
done

echo "[deploy] building API image"
docker build -q -t "$NAME-api" "$WORK/api"

echo "[deploy] starting API"
docker rm -f "$NAME-api" >/dev/null 2>&1 || true
docker run -d --name "$NAME-api" --restart unless-stopped --network "$NAME" \
  -p 80:4000 --env-file "$WORK/api.env" "$NAME-api"
docker image prune -f >/dev/null

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "[deploy] healthy"
    exit 0
  fi
  sleep 2
done
echo "[deploy] API did not become healthy" >&2
docker logs --tail 50 "$NAME-api" >&2
exit 1
