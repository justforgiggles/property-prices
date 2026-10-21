# Scheduled scraping

The scrape workflow runs daily at **15:00 UTC**, or manually:

```sh
gh workflow run scrape.yml --repo justforgiggles/property-prices --ref main
```

It deletes previous droplets tagged `property-prices-scraper-1370448547`, confirms
deletion, and creates one `s-1vcpu-2gb` Ubuntu droplet in London. It starts
`scripts/scrape.sh` as a detached systemd service and exits.

The worker runs the existing scraper unchanged. A Node preload routes all requests
through Oxylabs residential proxies, using a fresh session each time: South Africa
for the first two attempts, UK for the third. There is no direct-network fallback.
The worker stops after 24 hours or an estimated 10GB of downloaded response bodies;
this estimate excludes protocol overhead and is not a provider billing limit.

Only a successful scrape commits raw data and `data/scrape-completed.json` to
`main`. That push triggers model release and cleanup independently. Cleanup checks
the completion record's droplet ID and ownership tags before deletion. There are
no periodic checkpoints: an unfinished run's new data may be lost. Failed runs
remain until the next scheduled/manual launch removes them, and remain billable
until deletion. No automatic restarts or replacement workers are used.

The main-only `scraping` GitHub environment contains `DIGITALOCEAN_TOKEN`,
`SCRAPE_DEPLOY_KEY`, `OXYLABS_USERNAME`, and `OXYLABS_PASSWORD`. The deploy key grants
write access only to this repository. The DigitalOcean token stays in Actions;
worker credentials are delivered over pinned SSH and stored in root-only files.

The workflow log identifies the droplet. For inspection through DigitalOcean's
recovery console, use `journalctl -u property-scraper` and
`systemctl status property-scraper`. The unrelated `frms-prod-fra1-01` droplet is
never targeted. Local scraping remains `npm run scrape`.
