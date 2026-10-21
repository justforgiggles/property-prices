# Property prices

Property24 listings → trained asking-price model → valuations on frms.dev.
`packages/data` scrapes listings. `packages/model` trains the model and serves
inference through the API/webhook. `forms` contains the shared template, agent
profiles, source artwork, and generated live forms.

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

[Scraping](scripts/SCRAPING.md) starts a detached DigitalOcean worker daily at
15:00 UTC. A successful scrape commits its data once and triggers independent
cleanup and [release](scripts/RELEASE.md).

Release runs train → agents → deploy → commit generated outputs. Only data and
scrape-completion changes trigger it automatically. After changing model code,
agent profiles, templates, or deployment scripts, run the release workflow
manually to publish those changes. Commands stop on failure; rerun after fixing
the problem. There is no automatic rollback.

## Inference and webhook

```sh
npm run verify -w @property-prices/model
packages/model/.venv/bin/python -m property_model.inference.main --input '{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":2,"bathrooms":1,"floor_size":85,"rates":700}'
packages/model/.venv/bin/python -m functions_framework \
  --source packages/model/src/property_model/http/main.py --target valuation --port 8080
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

Deployment updates the existing `property-prices-valuation` Cloud Run function in
project `hirebarend`, region `europe-west3`. It uses Python 3.14, 2 CPUs, 2 GiB,
concurrency one, and one worker. `GET /health` checks inference without writing
a submission. Restart or redeploy to load new model artifacts.
