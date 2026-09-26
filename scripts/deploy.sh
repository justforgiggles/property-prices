#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
packages/model/.venv/bin/python -m property_model.artifacts packages/model/models

gcloud run deploy property-prices-valuation \
  --source packages/model \
  --function valuation \
  --base-image python314 \
  --concurrency 1 \
  --cpu 2 \
  --memory 2Gi \
  --region europe-west3 \
  --account hirebarend@gmail.com \
  --project hirebarend \
  --set-env-vars 'WORKERS=1,THREADS=1,RESEND_FROM_EMAIL=Peter <hello@frms.dev>' \
  --set-secrets RESEND_API_KEY=resend-api-key:latest \
  --quiet
