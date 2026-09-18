# Property prices

Three packages: `packages/data` captures raw Property24 listing JSON-LD, `packages/model` trains and verifies CatBoost/ONNX models in Python, and `packages/function` serves one HTTP valuation function in Node.js. The website, leads, insights, geocoding, and MongoDB are intentionally outside this repository.

## Setup

Use Node.js 22 and Python 3.10–3.12:

```bash
npm ci
python3.12 -m venv packages/model/.venv
packages/model/.venv/bin/python -m pip install -e packages/model
```

The scraper uses plain HTTP requests; it does not use Playwright. It discovers city searches in Western Cape, Gauteng, and KwaZulu Natal through Property24's location dictionary. A full crawl makes many requests and may take considerable time. Site blocking, invalid pages, or incomplete city crawls produce a nonzero exit code.

## Data → model → function

```bash
npm run scrape                                 # rolling 30 published days
npm run train                                  # all deduplicated raw history
npm run prepare:models -w @property-prices/function
npm test
```

Each previously unseen listing ID is appended once to `data/raw/YYYY-MM-DD.jsonl`, based on its publication date. Dated raw files are versionable and are never rewritten by scraper reruns; review and commit new files after a crawl. Training compares complete-row, missing-size-prior, and imputed-size strategies on chronological folds, writes metrics and exclusion counts under `packages/model/build`, and promotes a four-file bundle only after forward quality gates and Python/Node ONNX parity pass. Models are generated and ignored by Git; a clean checkout can train from the migrated raw history.

The scraper requests newest-first results and stops at the first unseen organic listing older than the rolling cutoff. Promoted listings are still captured but do not determine the cutoff.

## Prediction API

Send JSON to the public function with `POST`:

```json
{"region":"Western Cape","locality_1":"Cape Town","locality_2":"Sea Point","bedrooms":3,"bathrooms":2,"size":120,"type":"House"}
```

`locality_2` may be omitted. Bedrooms and bathrooms must be integers from 1–20 and floor area must be 10–5,000 m². The function assumes South Africa and returns `{"low":number,"recommended":number,"high":number}` in ZAR. It accepts no address, coordinates, price, or other fields. Invalid input returns 400; unsupported methods return 405; model failures return 500. Responses use `Cache-Control: no-store`.

Run it locally after preparing models:

```bash
npm run serve -w @property-prices/function
```

Deploy only after `npm run train` and `npm run prepare:models -w @property-prices/function` pass. Select your Google Cloud project and region, then deploy the standalone [Cloud Run function](https://cloud.google.com/run/docs/deploy-functions):

```bash
gcloud run deploy property-prices-predict \
  --source packages/function \
  --function predict \
  --base-image nodejs22 \
  --region YOUR_REGION \
  --allow-unauthenticated
```

The cloud build checks for all four nonempty model artifacts before compiling. `packages/function/.gcloudignore` excludes local dependencies and includes the prepared models despite Git ignoring them. No cloud deployment is performed automatically.

## Valuation form and email

[`forms/property-valuation.yaml`](./forms/property-valuation.yaml) is a frms.dev form for residential properties in Gauteng, KwaZulu-Natal, and the Western Cape. After pushing it to the default branch, its form URL is:

```text
https://frms.dev/justforgiggles/property-prices/forms/property-valuation
```

The form's webhook points to the deployed email handler. Redeploy it after changing the function source:

```bash
gcloud run deploy property-prices-valuation \
  --source packages/function \
  --function valuation \
  --base-image nodejs22 \
  --region europe-west3 \
  --allow-unauthenticated \
  --set-env-vars 'RESEND_FROM_EMAIL=Peter <hello@frms.dev>' \
  --set-secrets RESEND_API_KEY=resend-api-key:latest
```

Before deployment, configure the sender domain:

- Create `dmarc@frms.dev` as an alias to the monitored `hello@frms.dev` mailbox.
- Publish one `_dmarc.frms.dev` TXT record with `v=DMARC1; p=none; rua=mailto:dmarc@frms.dev; adkim=r; aspf=r; pct=100`.
- Keep Resend's existing `send.frms.dev` SPF/MX return path and `resend._domainkey.frms.dev` DKIM record unchanged.
- Disable open and click tracking for `frms.dev` in Resend.

The handler accepts completed frms.dev submission envelopes, runs the existing model, and sends the respondent the HTML and plain-text valuation email. It returns `204` only after Resend accepts the message. Keep `RESEND_API_KEY` in Google Secret Manager; never add the value from the core project's `.env.production` to this repository or the form YAML. Keep DMARC at `p=none` until reports show that every legitimate `frms.dev` sender is aligned.
