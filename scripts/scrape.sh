#!/usr/bin/env bash
# Droplet entrypoint; local scraping remains `npm run scrape`.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f /root/scrape.env ]; then
  set -a
  source /root/scrape.env
  set +a
  export GIT_SSH_COMMAND='ssh -i /root/.ssh/scrape-deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes'
fi
: "${SCRAPE_RUN_ID:?Missing scrape run ID}"
: "${SCRAPE_DROPLET_ID:?Missing droplet ID}"
npm ci
export NODE_OPTIONS="--import=$PWD/scripts/scrape-proxy.mjs"
timeout --signal=TERM --kill-after=30s 24h npm run scrape
unset NODE_OPTIONS
python3 - <<'PY'
import datetime, json, os
from pathlib import Path
Path('data/scrape-completed.json').write_text(json.dumps({
    'run_id': os.environ['SCRAPE_RUN_ID'],
    'droplet_id': int(os.environ['SCRAPE_DROPLET_ID']),
    'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2) + '\n')
PY
git config user.name 'Property scraper'
git config user.email 'scraper@users.noreply.github.com'
git add -- data/raw data/scrape-completed.json
git commit -m 'Scrape completed'
git pull --rebase origin main
git push origin HEAD:main
