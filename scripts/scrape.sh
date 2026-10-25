#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --rebase origin main
npm ci --workspace @property-prices/data --include-workspace-root=false --include=dev
npm run scrape
git add -- data/raw data/result.json
git commit -m 'Scrape'
git pull --rebase origin main
git push origin HEAD:main
