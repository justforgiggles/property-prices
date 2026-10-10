---
name: property-prices-deploy
description: Retrain and deploy this repository's property valuation model to its existing hirebarend Cloud Run service when asked to update it.
---

# Property prices deployment

Work from this repository's root. Use the existing scripts and account settings; do not create a new Cloud Run service.

1. Check the working tree and inspect the current data under `data/raw`. If the request includes retraining, run `./scripts/train.sh` with the default output path. Training also updates local form locations; report any tracked form change. Publishing the hosted form is separate work.
2. Verify `packages/model/models/manifest.json` records the current raw-data fingerprint after retraining. Run `npm test` and `npm run verify -w @property-prices/model`. Resolve failures before deployment.
3. Confirm `property-prices-valuation` already exists in project `hirebarend`, region `europe-west3`, under `hirebarend@gmail.com`. `./scripts/deploy.sh` checks this again and then updates that service. Stop if the service is absent or the account cannot access it.
4. After deployment, describe the same service and confirm a new ready revision receives 100% of traffic. Check the service URL with a safe HTTP request. Do not send a valid production webhook as a smoke test: it writes to frms.dev.

When asked only to deploy, use the existing verified bundle; do not retrain unless requested. Report the revision, URL, checks, and any local form changes.
