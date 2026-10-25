# Scheduled scraping

The Raspberry Pi scrapes directly every day at **10:00 Africa/Johannesburg
(SAST, UTC+2)**. There is no proxy. The systemd timer skips missed starts and
will not start another instance while the previous run is active. There is no
run time limit or automatic retry of a failed daily run.

## Install

The installer targets Debian ARM64 and the `office` user. Run on the Pi:

```sh
sudo bash scripts/install-rpi-scraper.sh
```

For a fresh Pi without a checkout, copy this installer there first and run it
with `sudo bash /path/to/install-rpi-scraper.sh`. It installs Node 22.22.0 and
required utilities, creates a dedicated SSH key, and clones this repository to
`/home/office/property-prices`. If the key is not registered, it prints the public
key and stops: add it as a **write-enabled deploy key** on
`justforgiggles/property-prices`, then rerun. The private key remains in
`/home/office/.ssh/property-scraper`. GitHub host keys are obtained over HTTPS.

The script can be rerun. Use `--no-enable-timer` during initial acceptance to
install without activating the daily timer; this flag does not disable an
already active timer. No scrape is launched by installation.

## Daily behavior

The service runs as `office`, pulls `main` with rebase, installs only the scraper
workspace's dependencies, and invokes the existing scraper with its existing
request delays and retries. Failed updates or dependency installs stop the run.
Model training and deployment remain in GitHub Actions and Cloud Run.

When scraping finishes, it publishes once. A complete run always writes
`data/scrape-completed.json`; a failed run does so only if it collected data.
The marker contains `run_id`, `completed_at`, and `status` (`complete` or
`partial`). Raw data and this marker are committed and pushed to `main`,
triggering the existing model/forms release even for partial results. A partial
run still exits unsuccessfully so the failure remains visible in systemd.

Git conflicts, interrupted writes, and push failures need manual attention.
Unpublished commits and partially written files remain on the Pi; do not delete
or reset them without inspecting the data. No checkpoint publication, automatic
repair, alerting integration, or full-run watchdog is installed.

## Verify and operate

```sh
cd /home/office/property-prices
npm run scrape:smoke
npm test -w @property-prices/data
npm run build -w @property-prices/data
git push --dry-run origin HEAD:main
sudo systemctl enable --now property-scraper.timer
systemctl list-timers property-scraper.timer
systemctl status property-scraper.service
journalctl -u property-scraper.service -n 100 --no-pager
sudo systemctl start --no-block property-scraper.service
```

The smoke command discovers cities and tests the first city's search page and
at most ten listing pages with four-second delays. It requires at least one
valid recent listing, validates the saved JSONL, and prints its temporary output
path. It does not change or publish repository data. This is a basic acceptance
check, not proof that an hours-long full scrape will complete.

For maintenance, stop the timer with `sudo systemctl stop property-scraper.timer`.
This does not stop an already running scrape. Inspect and resolve a failed run
before starting the service manually again.

The former DigitalOcean worker workflow, provisioning code, proxy integration,
and scraper-only credentials were retired after Pi acceptance. The unrelated
`frms-prod-fra1-01` server and provider accounts are not part of this migration.
