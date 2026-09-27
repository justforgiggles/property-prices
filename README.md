# Property prices

Property24 listings → trained asking-price model → valuation email.
`packages/data` scrapes raw listings; `packages/model` trains and serves the
Python HTTP function. Predictions describe advertised asking prices in ZAR.

## Setup

Use Node.js 22 and Python 3.14. LightGBM needs OpenMP (`brew install libomp`
on macOS if absent).

```sh
npm ci
python3.14 -m venv packages/model/.venv
packages/model/.venv/bin/python -m pip install -e packages/model functions-framework==3.9.2 Jinja2==3.1.6
```

## Workflow

```sh
npm run scrape
./scripts/train.sh
./scripts/deploy.sh
```

Training reads `data/raw/*.jsonl`, extracts and cleans residential listings,
links related properties, constructs features, and fits ten LightGBM learners
plus one CatBoost residual learner on all valid listings. Internal four-fold
grouped cross-fitting keeps a property's own price out of its historical
features. There is no separate development model, saved split file or held-out
accuracy report.

Training saves native learners, historical reference data and a manifest under
`packages/model/models/`. The manifest contains the recipe, data-quality audit,
training population and artifact checksums. It reloads and checks the bundle
before replacing the current artifacts.

The same training population determines the location catalog and city/suburb
fields in `forms/property-valuation.yaml`, restricted to Gauteng, KwaZulu Natal
and Western Cape. Model and location publication restores previous outputs on
caught failures. This supports one local writer and is not crash-atomic across
files. Updating the hosted form remains a separate external publication step.

Optional `--data-dir` and `--output-dir` paths resolve from the caller's working
directory; defaults are anchored to the source checkout. A custom output path
does not change what HTTP or deployment loads. Training still updates local
form locations when a custom output path is used. Model artifacts are ignored
by Git.

Read the three entry points to follow the implementation:

- [Training](packages/model/src/property_model/train/main.py)
- [Inference](packages/model/src/property_model/inference/main.py)
- [HTTP](packages/model/src/property_model/http/main.py)

## Prediction

```sh
packages/model/.venv/bin/python -m property_model.inference.main
packages/model/.venv/bin/python -m property_model.inference.main --input '{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":2,"bathrooms":1,"floor_size":85,"rates":700}'
```

`--input` accepts an object, a nonempty list, or a JSON filename. Results contain
the rounded asking price, unrounded prediction and comparable diagnostics.
Use `--model-dir` to inspect another bundle. Omitted inputs remain unknown; if
all measurements are missing, inference uses the geographic-median fallback.
Display the rounded recommendation without further adjustment.

## HTTP and deployment

```sh
packages/model/.venv/bin/python -m functions_framework \
  --source packages/model/src/property_model/http/main.py --target valuation --port 8080
```

The function accepts completed form submissions:

```json
{"id":"submission-123","status":"completed","data":{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":"2","bathrooms":"1","floor_area":"85","rates_and_taxes":"700","email":"owner@example.com"}}
```

It validates the location and required form fields, maps measurements to model
inputs, predicts locally, renders HTML/text email and sends through Resend.
Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for local sending; valid requests
with real credentials send real email. Submission IDs provide delivery
idempotency. Success returns 204; invalid submissions return 400, other methods
405, model failures 500 and email failures 502. The HTTP response does not
contain prediction JSON.

`deploy.sh` checks inference and deploys `property-prices-valuation` from
`packages/model`, using the function source under `src/property_model/http/`.
It uses Google's full Python 3.14 image for LightGBM's OpenMP library, project
`hirebarend`, region `europe-west3`, one worker,
concurrency one, 2 CPUs, 2 GiB memory and existing Resend secret configuration.
Artifacts, location catalog and email templates are included in the upload;
training is not run during deployment. Restart or redeploy to load new artifacts.

## Lightweight checks

```sh
npm test
npm run build
npm run verify -w @property-prices/model
packages/model/.venv/bin/python -m property_model.train.main --help
```

`npm test` runs data-package and shell-wiring checks; `npm run build` checks the
data package's TypeScript. Model verification loads the existing bundle and
runs an example prediction. Only load trusted artifacts: reference data uses
Joblib. Existing minimal manifests are supported with compatibility checks,
while explicitly warning that provenance and checksums are unavailable.
