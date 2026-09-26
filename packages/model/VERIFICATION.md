# Migration verification — 2026-09-25

## Faithful replication before retraining

The new package was run with the demo's saved native learners and its original
raw snapshot. All 27,889 cleaned reference rows and their features matched.
Grouped training features also matched on a 200-row sample. Full-population
predictions differed by at most 7.45058059692e-09 rand and
**every rounded recommendation was identical**. The required comparison
tolerance was relative 1e-9, absolute 1e-8. Complete, unknown-location and
all-missing-input diagnostics also matched the demo.

This verifies migration equivalence, not independent predictive accuracy.

## Fresh evaluation on this repository

| Population | Rows | Within ±20% | MdAPE | MAE | Log RMSE |
|---|---:|---:|---:|---:|---:|
| All reserved test properties | 5,700 | 64.30% | 13.64% | R637,333 | 0.3127 |
| Mainstream reserved properties | 4,576 | 66.74% | 12.77% | R362,552 | 0.2675 |

- Raw rows: 29,264; cleaned rows: 28,551; linked groups: 27,353.
- Excluded rows: 713; malformed rows: 0; repeated IDs removed: 0.
- Development: 22,851; reserved test: 5,700, with disjoint property groups.
- Mainstream bounds: R630,000–R5,280,000, calculated from development data.
- Mainstream grouped-bootstrap 95% interval for within-20% accuracy:
  65.37%–68.02%.

These are measurements of the frozen recipe trained on development data.
The final production model was subsequently fitted on all 28,551
rows. Its training observations are not an independent test. The recipe was
not tuned using these test results, and the demo's 68.33% mainstream result is
not claimed for this different population.

Full metrics, row predictions and segment tables are in `build/reports`.
The production manifest also records the evaluation and training provenance.

## Runtime and integration — updated 2026-09-26

- All Python tests pass, including group-target isolation, validation,
  comparable arithmetic, native round-trip, failed-publication rollback,
  integrity checks and frozen split handling.
- Data-package tests/build, Python webhook tests and shell syntax checks pass.
  The full `npm test` command currently stops at the location check: the
  September 26 raw listings add 16 locations absent from the existing catalog
  and form. Both were preserved during the serving consolidation. Run
  `npm run sync:locations` when updating the form for those new listings.
- Shell entrypoints pass stubbed-command tests, including argument forwarding,
  single-service deployment, secret configuration and preflight failure stopping.
- Two real local Python webhook requests render the same rounded prices as
  direct native predictions. HTML escaping, idempotency keys, invalid requests
  and HTTP responses are checked; Resend transport is mocked. The model files
  and training recipe were not changed or retrained for this consolidation.
- Local artifact load: 0.47 seconds; warm prediction: 35 ms; peak process RSS:
  approximately 450 MiB. These are local macOS measurements, not cloud latency
  guarantees. The Python deployment requests 2 GiB and concurrency one.
- Cloud SDK upload inspection includes all 13 native-package files and excludes
  virtual environments, tests and build reports. The Python webhook, email
  helpers, templates and location catalog are included. No cloud deployment was run.

## Provenance

```text
raw_sha256      9bd746d0d84e4b33cbfc7adb782d77fd1017f12236daf76056db7623bcb71be8
split_sha256    9227c33be3b8482aacd23f2dba216c54ddf91e57b3f8c73e65d38ee24ee8c366
manifest_sha256 5c8ea61951582b2bbcd5ed172f58985a6a6c07b16007b40af884fe94a7bb5f0f
```

Run `tests/verify_reference.py /path/to/demo` for optional migration parity,
`tests/verify_service.py` for local webhook/email parity, and
`python -m property_model evaluate` for the saved development artifact's
reserved-test report. Normal operation has no dependency on the demo directory.
