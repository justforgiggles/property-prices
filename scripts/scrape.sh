#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

unset NODE_OPTIONS HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
npm ci --workspace @property-prices/data --include-workspace-root=false --include=dev

scrape_status=0
npm run scrape || scrape_status=$?
git add -- data/raw

if [ "$scrape_status" -ne 0 ] && git diff --cached --quiet -- data/raw; then
  echo 'Scrape failed without new data; nothing to publish.' >&2
  exit "$scrape_status"
fi

export SCRAPE_STATUS=complete
if [ "$scrape_status" -ne 0 ]; then
  export SCRAPE_STATUS=partial
fi
python3 - <<'PY'
import datetime
import json
import os
import uuid
from pathlib import Path

Path('data/scrape-completed.json').write_text(json.dumps({
    'run_id': str(uuid.uuid4()),
    'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'status': os.environ['SCRAPE_STATUS'],
}, indent=2) + '\n')
PY
git add -- data/scrape-completed.json
git -c user.name='Property scraper' -c user.email='scraper@users.noreply.github.com' commit -m "Scrape ${SCRAPE_STATUS}"
git pull --rebase origin main
git push origin HEAD:main
exit "$scrape_status"
