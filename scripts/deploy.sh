#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

gcloud run deploy property-prices-predict \
  --source packages/function \
  --function predict \
  --base-image nodejs22 \
  --concurrency 1 \
  --memory 1Gi \
  --region europe-west3 \
  --account hirebarend@gmail.com \
  --project hirebarend \
  --quiet

gcloud run deploy property-prices-valuation \
  --source packages/function \
  --function valuation \
  --base-image nodejs22 \
  --concurrency 1 \
  --memory 1Gi \
  --region europe-west3 \
  --account hirebarend@gmail.com \
  --project hirebarend \
  --set-env-vars 'RESEND_FROM_EMAIL=Peter <hello@frms.dev>' \
  --set-secrets RESEND_API_KEY=resend-api-key:latest \
  --quiet
