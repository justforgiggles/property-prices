# Model and form release

The release workflow runs on `main` when raw data or the scrape completion record
changes. Source-only edits require manual dispatch:

```sh
gh workflow run release.yml --repo justforgiggles/property-prices --ref main
```

It trains the model and location catalog, generates all forms/assets, verifies
inference, deploys the existing Google function, and commits generated outputs
with `[skip ci]`. Releases run sequentially. A failed command stops the job;
previously completed steps remain in place. Fix the problem and rerun. Git pushes
are normal rebased pushes, so conflicts stop publication rather than overwrite
other work.

The existing `production` GitHub environment provides these variables:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `GCP_BUILD_SERVICE_ACCOUNT`

Google authentication uses GitHub OIDC. Keep the workflow filename `release.yml`:
the existing identity trust is restricted to that workflow on `main`.
The target is `property-prices-valuation` in `hirebarend/europe-west3`.
After deployment, traffic is assigned to the latest revision, including services
previously pinned to a revision by the old release controller.

For local deployment, use `npm run train`, `npm run agents`, then `npm run deploy`.
The default local account is `hirebarend@gmail.com`; CI sets `GCLOUD_ACCOUNT` empty
to use OIDC. `GCLOUD_BUILD_SERVICE_ACCOUNT` supplies the build identity when set.
