#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
account=${GCLOUD_ACCOUNT-hirebarend@gmail.com}
set --
if [ -n "$account" ]; then set -- "$@" --account "$account"; fi
if [ -n "${GCLOUD_BUILD_SERVICE_ACCOUNT:-}" ]; then
  set -- "$@" --build-service-account "$GCLOUD_BUILD_SERVICE_ACCOUNT"
fi
packages/model/.venv/bin/python -m property_model.inference.main --model-dir packages/model/models

gcloud run services describe property-prices-valuation \
  --region europe-west3 \
  ${account:+--account "$account"} \
  --project hirebarend \
  --format='value(metadata.name)' >/dev/null

gcloud run deploy property-prices-valuation \
  --source packages/model \
  --function valuation \
  --set-build-env-vars GOOGLE_FUNCTION_SOURCE=src/property_model/http/main.py \
  --base-image europe-west3-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/python314 \
  --concurrency 1 \
  --cpu 2 \
  --memory 2Gi \
  --region europe-west3 \
  "$@" \
  --project hirebarend \
  --set-env-vars 'WORKERS=1,THREADS=1' \
  --remove-secrets RESEND_API_KEY \
  --quiet

gcloud run services update-traffic property-prices-valuation \
  --to-latest \
  --region europe-west3 \
  ${account:+--account "$account"} \
  --project hirebarend \
  --quiet
