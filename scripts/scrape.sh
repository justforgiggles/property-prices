#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --rebase origin main
npm ci --workspace @prop-radar/data --include-workspace-root=false --include=dev
set +e
npm run scrape 2>&1 | tee data/result.log
run_status=("${PIPESTATUS[@]}")
set -e

if [ "${run_status[1]}" -ne 0 ]; then
  echo 'Failed to capture scraper output; keeping local data for recovery.' >&2
  exit "${run_status[1]}"
fi

if [ "${run_status[0]}" -ne 0 ]; then
  echo 'Scraper failed; publishing only its log and preserving local data.' >&2
  # Publish from a clean checkout so partial data and stale summaries stay local.
  set +e
  (
    set -e
    publish_dir=$(mktemp -d)
    trap 'if [ -e "$publish_dir/checkout/.git" ]; then git worktree remove --force "$publish_dir/checkout"; fi; rmdir "$publish_dir"' EXIT
    git fetch origin main
    git worktree add --detach "$publish_dir/checkout" origin/main
    cp data/result.log "$publish_dir/checkout/data/result.log"
    cd "$publish_dir/checkout"
    git add -- data/result.log
    if ! git diff --cached --quiet; then
      git commit -m 'Record failed scrape log'
      git pull --rebase origin main
      git push origin HEAD:main
    fi
  )
  publish_status=$?
  set -e
  if [ "$publish_status" -ne 0 ]; then
    echo 'Failed to publish scraper log; data/result.log remains available locally.' >&2
  fi
  exit "${run_status[0]}"
fi

git add -- data/raw data/result.json data/result.log
git commit -m 'Scrape'
git pull --rebase origin main
git push origin HEAD:main
