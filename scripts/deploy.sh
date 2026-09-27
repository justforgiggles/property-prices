#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
packages/model/.venv/bin/python -m property_model.inference.main --model-dir packages/model/models

gcloud run deploy property-prices-valuation \
  --source packages/model \
  --function valuation \
  --set-build-env-vars GOOGLE_FUNCTION_SOURCE=src/property_model/http/main.py \
  --base-image europe-west3-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/python314 \
  --concurrency 1 \
  --cpu 2 \
  --memory 2Gi \
  --region europe-west3 \
  --account hirebarend@gmail.com \
  --project hirebarend \
  --set-env-vars 'WORKERS=1,THREADS=1' \
  --remove-secrets RESEND_API_KEY \
  --quiet
