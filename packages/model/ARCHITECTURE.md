# Property valuation model architecture

This document describes the implemented Property24 asking-price pipeline. The
source of truth is [`src/property_model`](src/property_model); this is the
current system, not a proposed design.

## Overview

```mermaid
flowchart LR
    A[Property24 JSON-LD] --> B[Validate and normalize]
    B --> C[26,065 market rows]
    C --> D[25,323 valid-room rows]
    D --> E[16,376 valid-size rows]
    C --> F[Target and location encoders]
    C --> G[Valid-size price/m² encoders]
    E --> H[Leak-safe 17-feature matrix]
    F --> H
    G --> H
    H --> I[25/75 fused CatBoost ensemble]
    I --> J[Chronological selection, calibration, test]
    J --> K{Quality gates pass?}
    K -->|yes| L[Four ONNX models plus encoders.json]
    K -->|no| M[Keep deployed bundle]
    L --> N[Node.js inference]
    N --> O[range, nullable point, confidence, risk]
```

| Module | Responsibility |
| --- | --- |
| [`data.py`](src/property_model/data.py) | Normalize raw JSON-LD, preserve useful incomplete rows, and report cohorts/exclusions. |
| [`features.py`](src/property_model/features.py) | Fit hierarchical encoders and build the fixed numeric matrix. |
| [`modeling.py`](src/property_model/modeling.py) | Fit fused CatBoost models, produce temporal predictions, and calibrate intervals. |
| [`evaluation.py`](src/property_model/evaluation.py) | Calculate forward metrics and release gates. |
| [`train.py`](src/property_model/train.py) | Train, verify, export, and atomically promote the bundle. |

## 1. Data cohorts

The scraper stores each listing ID once in `data/raw/YYYY-MM-DD.jsonl`, using
Property24's `datePosted`. Training reads those files in lexical order and
requires the filename and `datePosted` to agree. Invalid JSON, invalid IDs, or
duplicate IDs stop training.

Only ZAR sale listings for houses, apartments/flats, and townhouses in
Gauteng, KwaZulu Natal, and the Western Cape enter the market cohort. Required
market fields are date, country, region, city, suburb, type, and an asking
price from R50,000 to R200,000,000. Rental and out-of-scope listings are hard
exclusions.

The current history is partitioned without losing otherwise useful listings:

| Cohort | Rows | Use |
| --- | ---: | --- |
| Market | 26,065 | Target encodings, location support counts, and market priors. |
| Valid rooms | 25,323 | Market rows with both bedroom and bathroom counts. |
| Valid size | 16,376 | Direct model fitting and size-dependent features. |

Bedrooms and bathrooms are accepted for training from 0.5 to 20 in half-step
increments. Missing, non-finite, out-of-range, or other fractional room values
become missing; the listing remains in the market cohort. Floor size is valid
from 10 to 5,000 m² when its asking price is also between R500 and R500,000 per
m². An invalid or missing size likewise remains available to non-size market
encoders.

This distinction is deliberate: structural gaps do not erase valid evidence
about location and asking price, while the deployed regressor remains directly
size-aware and trains only on rows that match its required inputs.
Rates and taxes are present for 8,452 of the 16,376 model-training rows. Those
rows receive full loss weight; the remaining rows stay in training at 10%
weight with the explicit missing-value representation.

## 2. Features and leakage control

The ONNX graph consumes a fixed 17-column `float32` tensor. Categorical values
are converted to smoothed numeric encodings because CatBoost categorical
features are not exported in this graph.

Geography uses composite keys so same-named places do not collide:

```text
region
region|city
region|city|suburb
```

Target encodings use `log1p(price)` and all market rows. Price/m² encodings use
`log(price / size)` and only rows with valid size. Both use hierarchical
smoothing with strength 3 and back off from suburb to city to region to the
global mean. Unknown locality counts fall back to zero.

The feature order persisted in `encoders.json` and enforced by Node is:

| # | Feature | Definition |
| ---: | --- | --- |
| 1 | `bedrooms` | Bedroom count. |
| 2 | `bathrooms` | Bathroom count. |
| 3 | `size` | Floor size in m². |
| 4 | `size_missing` | Missing-size indicator; zero for size-cohort training and serving. |
| 5 | `total_rooms` | `bedrooms + bathrooms`. |
| 6 | `bed_bath_ratio` | `bedrooms / (bathrooms + 0.5)`. |
| 7 | `size_per_bedroom` | `size / max(bedrooms, 0.5)`. |
| 8 | `log_size` | Natural log of size. |
| 9 | `log_rates_and_taxes` | `log1p` monthly rates and taxes, zero when missing historically. |
| 10 | `rates_and_taxes_missing` | Historical missing-value indicator; zero for serving. |
| 11–14 | `te_region`, `te_locality_1`, `te_locality_2`, `te_type` | Smoothed log-price encodings. |
| 15 | `te_ppsqm` | Hierarchical log price/m² encoding. |
| 16 | `prior_log_price` | `te_ppsqm + log_size`. |
| 17 | `loc2_log_count` | `log1p` market-row count for the composite suburb. |

Training features use deterministic random inner out-of-fold encoding. For
each inner fold, its listing IDs are removed from the broader encoder cohort,
so no row's target contributes to its own features. Final serving encoders use
all 26,065 market rows because a new request has no observed target. There is
no recency-weighted encoder or price index.

## 3. Selected models and intervals

All models predict `log1p(price)`. The selected direct-target model is a 25/75
CatBoost ensemble fused with `catboost.sum_models` before ONNX export:

| Member | Weight | Iterations | Learning rate | Depth | L2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Base | 25% | 850 | 0.02 | 6 | 3 |
| Depth-8 override | 75% | 638 | 0.02 | 8 | 3 |

The same blend is used for the RMSE point model and the P10/P90 quantile models.
Fusion preserves the existing one-file-per-output serving contract. A staged
model that predicted a residual from a time-varying prior was benchmarked and
rejected because it did not beat this direct size-aware ensemble.

The raw P10–P90 band is a nominal 80% interval. The penultimate chronological
fold supplies split-conformal scores:

```text
score = max(min(q10, q90) - actual_log_price,
            actual_log_price - max(q10, q90))
```

The finite-sample 80th-percentile score is constrained to a non-negative
log-space widening and applied symmetrically. The lower ZAR bound is clamped
to zero, crossed quantiles are ordered, and the point prediction is clamped
inside the final interval.

## 4. Forward evaluation and gates

Outer folds are expanding chronological windows based on `date_posted`.
Encoders and models for each validation window use only earlier rows. The early
outer folds form the model-selection report, the penultimate fold calibrates
the interval, and the newest fold is the untouched test. These evaluation rows
all have rates and taxes, matching the production contract; missing-rate rows
remain available to earlier-fold training at 10% weight. Only the inner OOF
encoding described above is random.

The current 2,415-row known-rates test result is MdAPE 15.15%, RMSLE 0.271,
log-space R² 0.893, 61.37% within 20%, median bias 2.18%, interval coverage
83.89%, and median relative interval width 71.17%.

On the same 5,253 known-rates selection rows, downweighting missing-rate
training rows improves the production-focused point metrics:

| Metric | Equal weight | 10% missing-rate weight |
| --- | ---: | ---: |
| MdAPE | 15.96% | 15.69% |
| MAE | R694,494 | R677,329 |
| RMSLE | 0.288 | 0.283 |
| Within 20% | 59.30% | 61.45% |

Promotion requires every configured gate to pass on the newest test fold:

- MdAPE ≤19%.
- Log-space R² ≥0.80.
- RMSLE ≤0.36.
- At least 52% of predictions within 20%.
- Absolute median percentage bias ≤5%.
- Interval coverage from 75% to 85%.
- Median relative interval width ≤84%.
- At least 50 high-confidence rows with at least 80% within 20%.
- At least 100 low-confidence rows with at most 50% within 20%.

The confidence regressor is trained only on early forward predictions, using
the 17 base features plus the point and ordered quantile outputs and their
gaps. The penultimate fold selects the widest quantile band that retains 80%
within-20% accuracy. On the newest fold, the resulting tiers are high: 135
rows at 85.2%, medium: 1,795 rows at 63.2%, and low: 485 rows at 47.8%.

`build/metrics.json` also reports RMSE, MAE, median absolute error, MAPE,
WAPE, within-10%, selection/CV metrics, and province/property-type slices.
`build/data-quality.json` records cohort conservation and hard exclusions.

## 5. Export and production contract

After the gates pass, final encoders are fit from all market rows, with the
price/m² tables restricted to their valid-size subset. A leakage-safe OOF
matrix is built for all 16,376 size-cohort rows, and the fused point/P10/P90
models are trained with the rates-aware row weights. The staged bundle is checked against native Python
predictions before atomic promotion.

The artifact shape is:

```text
models/
├── encoders.json
├── model.onnx
├── model_confidence.onnx
├── model_q10.onnx
└── model_q90.onnx
```

`encoders.json` contains the exact feature order, composite lookup tables,
counts, globals, size-imputation tables, conformal widening, cohort counts,
source dates, hashes, selected model/data labels, and test metrics.
[`tests/verify-onnx.cjs`](tests/verify-onnx.cjs) independently recreates Node
features and requires finite, ordered predictions matching native CatBoost
within relative tolerance `1e-5` or absolute tolerance R1.

The public API accepts:

```json
{"region":"Western Cape","locality_1":"Cape Town","locality_2":"Sea Point","type":"House","bedrooms":3,"bathrooms":2,"size":120,"rates_and_taxes":1800}
```

Public bedrooms and bathrooms remain integers from 1–20; half-step rooms are a
training-data capability only. Size must be 10–5,000 m², and monthly
`rates_and_taxes` must be a whole-rand amount from R1–R100,000. `locality_2`
may be empty or omitted and then uses the city/region/global fallback. Extra
fields are rejected. The response is
`{"low":number,"recommended":number|null,"high":number,"confidence":"high"|"medium"|"low","errorRisk":number}`.
Low-confidence responses suppress the point estimate.

Node validates the encoder schema and exact feature orders, loads and caches
the four ONNX sessions, constructs the price and confidence tensors, and
applies the same inverse-log, interval, and tier rules as Python. Model failures return HTTP 500,
invalid input returns 400, unsupported methods return 405, and responses use
`Cache-Control: no-store`.

## 6. Limitations

- The target is an advertised asking price, not a completed transaction, bank
  valuation, guaranteed sale value, or pricing-strategy optimum.
- Coverage is limited to supported Property24 categories and three provinces;
  sparse or unseen locations rely on broader fallback means.
- The model has no condition, amenity, erf-size, exact-coordinate, text, or
  image features.
- Listings are immutable first captures, so the model does not observe price
  revisions, sale outcomes, or time on market.
- Probable relists and development duplicates are not grouped beyond unique
  listing ID.
- The nominal 80% interval is empirical and can vary by market segment or as
  the market changes.

## Reproduce

From the repository root:

```sh
npm run train
npm run test:onnx -w @property-prices/model
npm run prepare:models -w @property-prices/function
npm test
```

Training writes reports under `packages/model/build` and promotes the verified
bundle to `packages/model/models`.
