---
name: property-prices-deploy
description: Retrain and deploy this repository's property valuation model to its existing hirebarend Cloud Run service when asked to update it.
---

# Property prices deployment

1. Inspect the working tree and current raw data. For retraining, run
   `npm run train`, then `npm run agents`; training writes model artifacts and the
   location catalog, and the generator owns the base/agent forms and artwork.
2. Run `npm test` and `npm run verify -w @property-prices/model`. After retraining,
   verify that the manifest's raw-data fingerprint matches the training inputs.
3. Deploy with `npm run deploy`, or dispatch the existing `release.yml` workflow
   to train, generate, deploy, and publish generated files together. Use the
   existing `property-prices-valuation` service in `hirebarend/europe-west3`.
   Source-only pushes do not automatically release. See `scripts/RELEASE.md`.
4. Confirm the new revision is ready, receives 100% of traffic, and answers
   `GET /health`. Do not submit a production webhook: it writes a real lead.

For deploy-only requests, use the existing verified model without retraining.
Failures stop the sequence; completed steps remain in place. Report the revision,
URL, checks, and generated-file publication status.
