#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
. ./.env

: "${ACCESS_KEY:?ACCESS_KEY is missing from .env}"

# ponytail: one 500-record page; paginate when submissions reach 500.
trap 'rm -f data.json.tmp data.json.tmp.pretty' 0
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_KEY" \
  --output data.json.tmp \
  "https://frms.dev/api/v1/forms/ad3e54459/submissions?page=1&limit=500"
jq . data.json.tmp > data.json.tmp.pretty
mv data.json.tmp.pretty data.json
