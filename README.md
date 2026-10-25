# Prop Radar

Display names use **Prop Radar**; project identifiers use `prop-radar`, and the
Python import package is `prop_radar`. The GitHub repository remains
`justforgiggles/property-prices`, including its raw asset URLs. Existing account
identities, live form filenames, and the local checkout folder are unchanged.

Property24 listings → trained asking-price model → valuations on frms.dev.
`packages/data` scrapes listings. `packages/model` trains the model and serves
inference through the API/webhook. `forms` contains the shared template, agent
profiles, source artwork, and generated live forms.
`packages/website` is the static Next.js website hosted on GitHub Pages.

## Setup

Use Node.js 22 and Python 3.14. On macOS, LightGBM needs `brew install libomp`.

```sh
npm ci
python3.14 -m venv packages/model/.venv
packages/model/.venv/bin/python -m pip install -e packages/model functions-framework==3.9.2
```

## Commands

```sh
npm run scrape       # run the existing scraper locally
npm run train        # train the model and write locations.json
npm run agents       # generate the base/agent forms and artwork
npm run deploy       # verify and deploy the trained model
npm run submissions  # download base-form submissions using ACCESS_KEY in .env
npm test
npm run build        # TypeScript check
npm run dev:website  # website development server
npm run build:website # export website to packages/website/out
```

Training reads `data/raw/*.jsonl`, cleans residential listings, links related
properties, and fits ten LightGBM learners plus a CatBoost residual learner.
Grouped cross-fitting keeps a property's own price out of its historical
features. Predictions estimate advertised asking prices in ZAR.

Artifacts are saved under `packages/model/models/` and ignored by Git. The bundle
includes native learners, reference data, and a manifest with the recipe, data
audit, and checksums. Training verifies the saved model before publishing it and
`packages/model/locations.json`. It does not edit forms: run `npm run agents`
after training. Optional `--data-dir` and `--output-dir` arguments can be passed
to `npm run train -- ...`; locations still belong to this checkout.

## Forms

`forms/template.json` defines the shared form, agent contact fields, and lead
email. `forms/agents/*.json` supplies branding, contact details, and local artwork.
One script, `scripts/agents.mjs`, generates the base form, agent forms, icons,
logos, and sharing images using the latest location catalog.

See [agent setup](forms/assets/README.md). Generated form filenames and asset URLs
are live public interfaces; preserve them when editing profiles or the template.
The hosted forms read the generated YAML and artwork from `main`.

## Automation

The Raspberry Pi scrapes directly every day at **10:00 SAST**. Its systemd timer
skips missed starts and never overlaps runs. `scripts/scrape.sh` pulls `main`,
installs scraper dependencies, scrapes, commits raw data and `data/result.json`,
rebases, and pushes. Shell commands stop on failure; Git conflicts and interrupted
runs need manual attention.

Node keeps the existing city-level error handling and continues to the next
city after an error. Finishing the city loop is a successful run, even if some
cities failed. `data/result.json` records `completed_at`, `listings_added`, and
`failed_cities`. The added count includes listings saved before a city failed.
Uncaught errors stop publication. Listings retain their four-second delay and
are stored in `data/raw/YYYY-MM-DD.jsonl`; location ordering is unchanged.

Install on the Debian ARM64 Pi as follows (the installer uses the `office` user):

```sh
sudo bash scripts/install-rpi-scraper.sh
```

On a fresh Pi, copy the installer there first. It creates a dedicated SSH key;
register its printed public key as a write-enabled deploy key for this repository
and rerun. It clones into `/home/office/prop-radar`. Use `--no-enable-timer`
to defer initial activation. The private key remains on the Pi.

```sh
systemctl list-timers prop-radar.timer
journalctl -u prop-radar.service -n 100 --no-pager
sudo systemctl start --no-block prop-radar.service  # manual run
```

The model workflow, `.github/workflows/release.yml`, runs train → agents → deploy
→ commit generated outputs. Changes to raw data or `data/result.json` trigger it
automatically. Keep its filename: Google OIDC trust is restricted to that workflow
on `main`. The `production` environment supplies `GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_DEPLOY_SERVICE_ACCOUNT`, and `GCP_BUILD_SERVICE_ACCOUNT`. After changing model code,
agent profiles, templates, or deployment scripts, run the release workflow
manually to publish those changes. Commands stop on failure; rerun after fixing
the problem. There is no automatic rollback.

```sh
gh workflow run release.yml --repo justforgiggles/property-prices --ref main
```

There is no PR workflow. `npm test` runs the remaining model and form tests locally;
`npm run build` type-checks the data package.

Builds and deployments share `prop-radar@hirebarend.iam.gserviceaccount.com`.
GitHub authentication uses the `prop-radar` workload identity pool and its
`github` provider. The Google project and runtime account remain unchanged.

## Website

The website uses Next.js App Router, TypeScript, shadcn UI, and Tailwind. Only Node.js 22
and `npm ci` are needed to work on it; Python and model artifacts are not required.
Run `npm run dev:website` and open http://localhost:3000/property-prices/.
Run `npm run typecheck -w @prop-radar/website` to check types, and
`npm run build:website` to generate the static site in `packages/website/out`.

Development, type checking, and builds first generate the ignored
`packages/website/data/cities.json` from `data/raw/*.jsonl`. Run
`npm run generate -w @prop-radar/website` to regenerate it independently and
`npm test -w @prop-radar/website` to test the aggregation.

Counts represent distinct advertisement IDs published in the 90 calendar days
ending today in `Africa/Johannesburg`, including today. They do not measure active
inventory or unique properties. Cities are grouped by name and province; only
cities with more than 20 recent listings appear, ordered by listing count descending
with alphabetical ties. The banner still counts all listings. Its update date is the generation
date, and its total remains unchanged when searching city names. Malformed records
fail generation rather than silently reducing counts.

Page styling uses Tailwind classes. The sole global stylesheet contains framework
imports and theme tokens, without custom selectors. The radar mark is copied into
the website; no report files or Python dependencies are needed to build it.

The production URL is https://justforgiggles.github.io/property-prices/.
The `/property-prices` base path applies locally and in production. Static export
uses directory-style routes and unoptimized images; server-only features such as
API routes, Server Actions, and runtime rendering are not available. Use Next.js
links for internal navigation and include the base path in public asset URLs.

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**
as the source before the first deployment. The `github-pages` environment should
allow deployments only from `main`. The website workflow, `.github/workflows/website.yml`,
tests, checks types, builds, and publishes the export when raw data, website files,
the root package manifest, the lockfile, or the workflow change on `main`. It also
rebuilds daily at **09:00 UTC / 11:00 SAST** so listings age out without new data
(GitHub may delay scheduled runs). Counts remain a snapshot between builds.
It also supports manual deployment from `main`:

```sh
gh workflow run website.yml --repo justforgiggles/property-prices --ref main
```

There is no website PR workflow. Build artifacts are uploaded directly to Pages
and are not committed to a deployment branch. Check the workflow run and its
deployment URL after publishing; the existing model release runs independently.

## Inference and webhook

```sh
npm run verify -w @prop-radar/model
packages/model/.venv/bin/python -m prop_radar.inference.main --input '{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":2,"bathrooms":1,"floor_size":85,"rates":700}'
packages/model/.venv/bin/python -m functions_framework \
  --source packages/model/src/prop_radar/http/main.py --target valuation --port 8080
```

Inference accepts an object, a nonempty list, or a JSON filename; `--model-dir`
selects another trusted bundle. Results include a rounded asking price and
comparable diagnostics. Display the rounded recommendation without adjustment.
Missing measurements use the existing geographic-median fallback.

The webhook handles partial property-section events, validates their form and
submission IDs, predicts, and writes `data.prediction` to that submission on
frms.dev. Other section events return 204. It does not send prediction JSON in
the HTTP response. The completion screen reads `formatted_asking_price` and can
show its existing fallback if the update arrives late.

Deployment updates the existing `prop-radar-valuation` Cloud Run function in
project `hirebarend`, region `europe-west3`. It uses Python 3.14, 2 CPUs, 2 GiB,
concurrency one, and one worker. `GET /health` checks inference without writing
a submission. Restart or redeploy to load new model artifacts.
