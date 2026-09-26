# Property prices

An explainable pipeline from Property24 listings to a recommended asking price.
`packages/data` scrapes raw data. `packages/model` trains the model and serves
one Python webhook that predicts locally and emails the estimate.

Start with the [pipeline architecture](packages/model/ARCHITECTURE.md) and
[worked example](packages/model/WALKTHROUGH.md). The model follows the demo's
frozen ten-LightGBM-plus-CatBoost recipe. It predicts advertised asking prices,
not completed sale values, and supplies diagnostics rather than price ranges
or confidence tiers.

## Setup

Use Node.js 22 and Python 3.14. LightGBM needs OpenMP (`brew install libomp` on
macOS if absent; Google's Ubuntu runtime supplies `libgomp1`).

```sh
npm ci
python3.14 -m venv packages/model/.venv
packages/model/.venv/bin/python -m pip install -e packages/model functions-framework==3.9.2 Jinja2==3.1.6
```

If upgrading an existing Python 3.12 environment, recreate the virtual
environment with Python 3.14 first. The old ONNX package is replaced only after
the native model package passes verification.

## Raw data → model

```sh
npm run scrape
npm run sync:locations
./scripts/train.sh
npm test
npm run build
python3 scripts/test-scripts.py
```

The scraper captures each listing ID once in publication-dated JSONL files.
Training keeps incomplete residential properties, links probable relistings,
reserves whole groups for evaluation, and constructs historical features using
grouped cross-fitting. It evaluates a development-only fit before fitting the
production model on all valid rows.

`data/splits.json` locks evaluation membership and the raw-data hash. After a
new scrape, explicitly choose a new split file; do not overwrite the previous
split to improve a score:

```sh
./scripts/train.sh --splits data/splits-2026-10-01.json
```

Optional `--data-dir`, `--output-dir` and `--build-dir` paths are resolved from
the caller's working directory. Defaults are anchored to this repository.
Training writes reports under `packages/model/build/reports`, preserves a
verified development model under `build/evaluation`, and publishes native
artifacts under `packages/model/models`. Unchanged development fits can be
reused after provenance and artifact verification; production always refits.
Model files and build reports are ignored by Git.

The first repository-data evaluation reserves 5,700 of 28,551 cleaned listings:
**64.30% within ±20% overall**, **66.74% within ±20% in the mainstream band**,
and **13.64% overall median absolute percentage error**. These results concern
the development-trained recipe; they are not a fresh test of the final model
trained on all rows. See [verification evidence](packages/model/VERIFICATION.md).

For independent evaluation of the saved development artifact:

```sh
packages/model/.venv/bin/python -m property_model evaluate
```

## Prediction

```sh
packages/model/.venv/bin/python -m property_model predict
packages/model/.venv/bin/python -m property_model predict --input '{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":2,"bathrooms":1,"floor_size":85,"rates":700}'
```

The CLI accepts one object, a nonempty list, or a JSON filename, and outputs a
list. Direct prediction is a Python API/CLI capability; there is no standalone
prediction HTTP endpoint. Supply the seven input fields shown above. Geography is text or
null; measurements are numbers or null. Omitted values remain unknown.
Bedrooms/bathrooms accept 0–100 including fractions, area accepts 5–100,000 m²,
and monthly rates accept R0–R1,000,000. Numeric strings, booleans, nonfinite
numbers, out-of-range values and additional fields are rejected. If all four
measurements are missing, the documented geographic-median fallback applies.

Each CLI result contains `recommended_asking_price_zar`,
`unrounded_prediction_zar`, `comparable_estimate_zar`, `comparable_count`,
`historical_suburb_count`, `historical_city_count`, `historical_province_count`,
`geographic_fallback`, `closest_comparable_distance`, `mean_comparable_distance`,
`comparable_price_per_m2_zar`, `comparable_log_dispersion`, `model_log_std`, and
`missing_inputs`. Unavailable diagnostics are null. Display the rounded
recommendation directly without another adjustment.

## Email function and deployment

The [form](forms/property-valuation.yaml) retains its existing required inputs,
location selectors and narrower numeric limits. Property type was removed.
Location options now follow the same breadcrumb geography as the model, with
source spelling retained for display. `npm run check:locations` detects stale
form or validation catalogs.

The Python webhook validates a completed form submission, maps `floor_area` to
`floor_size` and `rates_and_taxes` to `rates`, predicts directly using the cached
model, renders the existing HTML/plain-text templates, and sends through Resend.
It preserves HTML escaping and submission-ID idempotency. All responses use
`Cache-Control: no-store`: invalid submissions return 400, non-POST methods 405,
model failures 500, email failures 502, and accepted deliveries 204.

Run the single function locally:

```sh
packages/model/.venv/bin/python -m functions_framework \
  --source packages/model/main.py --target valuation --port 8080
```

The HTTP body is the form's completed-submission envelope, for example:

```json
{"id":"submission-123","status":"completed","data":{"province":"Gauteng","city":"Johannesburg","suburb":"Berea","bedrooms":"2","bathrooms":"1","floor_area":"85","rates_and_taxes":"700","email":"owner@example.com"}}
```

The webhook requires bedrooms/bathrooms from 1–20, area from 10–5,000 m²,
and rates from R1–R100,000, all whole numbers. It accepts numeric form strings,
checks location combinations against the catalog, and rejects booleans. The
broader model input contract described above remains available through the CLI.
Tests mock delivery; invoking the real webhook with valid Resend credentials
sends a real email. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for local sending.

```sh
./scripts/deploy.sh
```

This verifies the model artifacts and deploys only `property-prices-valuation`
from `packages/model` using Python 3.14 in `hirebarend`, `europe-west3`. Its
existing webhook URL, public access policy, and Resend secret configuration are
preserved. There is no prediction URL or service-to-service authentication.

The service uses one worker, concurrency one, 2 CPUs and 2 GiB memory.
Its `.gcloudignore` includes templates, location catalog and native model files,
while excluding virtual environments, tests and build reports. No training is
performed during deployment.

After deploying and verifying the replacement webhook, the old
`property-prices-predict` Cloud Run service can be retired if no external clients
still use it. The deployment script does not delete it automatically. No cloud
deployment or deletion was performed during this change.

Runtime references: [Python functions](https://docs.cloud.google.com/run/docs/runtimes/python),
[system packages](https://docs.cloud.google.com/docs/buildpacks/stacks).

The hosted form remains at
`https://frms.dev/justforgiggles/property-prices/forms/property-valuation`.
Retain the existing verified Resend sender domain and DNS configuration.

## Verification commands

```sh
npm test
npm run build
python3 scripts/test-scripts.py
npm run verify -w @property-prices/model
packages/model/.venv/bin/python packages/model/tests/verify_service.py
packages/model/.venv/bin/python packages/model/tests/verify_reference.py /path/to/demo
```

The last command is an optional one-time migration comparison using the demo's
preserved reference; normal training, inference and tests need no sibling repo.
Only load trusted model packages because the historical reference uses Joblib.
