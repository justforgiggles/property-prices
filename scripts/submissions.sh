#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
. ./.env

: "${ACCESS_KEY:?ACCESS_KEY is missing from .env}"

# ponytail: one 500-record page; paginate when submissions reach 500.
trap 'rm -f data.json.tmp' 0
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_KEY" \
  --output data.json.tmp \
  "https://frms.dev/api/v1/forms/ad3e54459/submissions?page=1&limit=500"
mv data.json.tmp data.json
trap - 0
