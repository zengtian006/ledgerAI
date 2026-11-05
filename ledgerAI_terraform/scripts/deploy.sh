#!/bin/bash
# Full deployment: infrastructure -> web build/upload -> API redeploy on the instance.
#   ./scripts/deploy.sh            # everything
#   ./scripts/deploy.sh --skip-infra   # skip terraform apply (web + API code only)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
WEB_DIR="$ROOT/../ledgerAI_h5/web"
API_ENV="$ROOT/../ledgerAI_h5/api/.env"
export AWS_PAGER=""

# The Gemini key is read from the API's local .env unless already provided (it is never printed)
if [ -z "${TF_VAR_gemini_api_key:-}" ] && [ -f "$API_ENV" ]; then
  TF_VAR_gemini_api_key=$(grep -E '^GEMINI_API_KEY=' "$API_ENV" | head -1 | cut -d= -f2-)
  export TF_VAR_gemini_api_key
fi

if [ "${1:-}" != "--skip-infra" ]; then
  terraform init -input=false
  terraform apply -input=false -auto-approve
fi

out() { terraform output -raw "$1"; }
REGION=$(out region)
WEB_BUCKET=$(out web_bucket)
DIST_ID=$(out cloudfront_distribution_id)
INSTANCE_ID=$(out instance_id)

echo "==> Building web app"
(
  cd "$WEB_DIR"
  [ -d node_modules ] || npm ci
  VITE_COGNITO_USER_POOL_ID=$(cd "$ROOT" && out cognito_user_pool_id) \
  VITE_COGNITO_CLIENT_ID=$(cd "$ROOT" && out cognito_client_id) \
  npm run build
)

echo "==> Uploading web app to s3://$WEB_BUCKET"
aws s3 sync "$WEB_DIR/dist" "s3://$WEB_BUCKET" --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws s3 cp "$WEB_DIR/dist/index.html" "s3://$WEB_BUCKET/index.html" \
  --cache-control "no-cache" --content-type "text/html" --only-show-errors
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" "/" >/dev/null

echo "==> Waiting for the instance to register with SSM"
for i in $(seq 1 60); do
  STATUS=$(aws ssm describe-instance-information --region "$REGION" \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$STATUS" = "Online" ] && break
  sleep 10
done
[ "$STATUS" = "Online" ] || { echo "Instance not reachable via SSM" >&2; exit 1; }

echo "==> Deploying API on $INSTANCE_ID (first boot may take a few minutes)"
CMD_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --timeout-seconds 900 \
  --parameters 'commands=["bash /opt/ledgerai/deploy.sh 2>&1 | tail -40"]' \
  --query Command.CommandId --output text)

for i in $(seq 1 100); do
  S=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$S" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 10
done
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text
[ "$S" = "Success" ] || { echo "API deploy ended with status $S" >&2; exit 1; }

echo
echo "Done. App: $(out app_url)"
