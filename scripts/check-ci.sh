#!/bin/bash
set -euo pipefail
npm test
npm run build
python3 scripts/test-scrape.py
node --test scripts/test-scrape-proxy.mjs
packages/model/.venv/bin/python -m unittest discover -s packages/model/tests
packages/model/.venv/bin/python scripts/test-release.py
npm run generate:agents
npm run check:agents
npm run validate:agents
