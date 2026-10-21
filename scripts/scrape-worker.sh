#!/usr/bin/env bash
set -euo pipefail
cd /opt/property-prices
set -a
source /root/scrape.env
set +a
export GIT_SSH_COMMAND='ssh -i /root/.ssh/scrape-deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes'
export SCRAPE_RAW_DIRECTORY=/opt/property-prices/data/raw
npm ci
git -C /opt/scrape-publish config user.name 'Property scraper'
git -C /opt/scrape-publish config user.email 'scraper@users.noreply.github.com'
# A separate publishing checkout keeps git operations away from the running scraper.
cd /opt/property-prices/packages/data
timeout --signal=TERM --kill-after=30s 24h node --import /opt/property-prices/scripts/scrape-proxy.mjs --import tsx /opt/property-prices/packages/data/src/cli.ts scrape &
scraper=$!
cd /opt/scrape-publish
trap 'kill "$scraper" 2>/dev/null || true' EXIT
while kill -0 "$scraper" 2>/dev/null; do
  sleep 300
  python3 /opt/property-prices/scripts/scrape-checkpoint.py checkpoint
done
wait "$scraper"
python3 /opt/property-prices/scripts/scrape-checkpoint.py complete
