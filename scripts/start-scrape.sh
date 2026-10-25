#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --rebase origin main
exec /bin/bash scripts/scrape.sh
