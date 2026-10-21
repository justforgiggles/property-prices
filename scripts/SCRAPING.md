# Scheduled scraping

`.github/workflows/scrape.yml` runs daily at 15:00 UTC or via **Run workflow** on `main`.
It deletes and confirms removal of old droplets tagged `property-prices-scraper-1370448547`,
then creates one `s-1vcpu-2gb` Ubuntu droplet in London. The Actions job exits after
starting a systemd service; it does not wait for the crawl.

The service runs the existing scraper unchanged, with a Node preload that routes
requests through Oxylabs residential proxies. Each request gets a fresh session:
South Africa for the first two attempts, UK for the third. Failed responses and
connection failures have a three-attempt budget, with no direct-network fallback.
The worker stops after 24 hours or approximately 10GB of downloaded response bodies
(including failed responses). This estimate excludes protocol overhead and is not
a provider billing limit.

Every five minutes, a separate publishing checkout copies complete JSONL records,
validates them, and pushes a `[skip ci]` checkpoint to `main`. A partially written
last line waits for the next checkpoint. Git operations never modify the live
scraper's files. Independent non-data commits are rebased normally; concurrent raw
data edits or push/rebase failures stop the worker. No force pushes are used.

Only successful scraper exit produces `data/scrape-completed.json`, including the
run and droplet IDs, in a final commit without `[skip ci]`. That push triggers both:

- Cleanup of the exact droplet, after checking repository and run ownership tags.
- The existing release workflow: training, locations, base/agent forms, checks,
  and deployment to the existing Google Cloud Run function.

Cleanup does not wait for deployment. Failed scraping or setup leaves the droplet
for inspection until the next scheduled/manual launch removes it. GitHub schedule
or DigitalOcean outages can delay cleanup; retained droplets remain billable.
No replacement droplets or automatic scraper restarts are attempted.

## Credentials and operation

The main-only `scraping` GitHub environment contains `DIGITALOCEAN_TOKEN`,
`SCRAPE_DEPLOY_KEY`, `OXYLABS_USERNAME`, and `OXYLABS_PASSWORD`.
The deploy key grants write access to this repository only. The DigitalOcean token
stays in Actions. Credentials are delivered over SSH with a pinned per-run host
key; Oxylabs credentials and the deploy key are stored in root-only droplet files.

To start immediately:

```sh
gh workflow run scrape.yml --repo justforgiggles/property-prices --ref main
```

The workflow log identifies the droplet ID. For failed-run inspection, use the
DigitalOcean recovery console and run `journalctl -u property-scraper` and
`systemctl status property-scraper`. The next launch deletes that failed droplet.
The existing `frms-prod-fra1-01` droplet is unrelated and is never targeted.

Run infrastructure and checkpoint tests with `python3 scripts/test-scrape.py`,
and proxy tests with `node --test scripts/test-scrape-proxy.mjs`.
