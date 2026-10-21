# Model and form releases

`.github/workflows/release.yml` runs on relevant `main` pushes and manual dispatch.
It uses only committed raw data; scraping remains separate. The `production`
environment permits `main` and has no human approval gate. PR checks never receive
cloud credentials or write repository contents.

## Release sequence

1. Reject a stale source commit. Install Node 22, Python 3.14, OpenMP and Liberation
   fonts on Ubuntu 24.04. Run tests/build/schema checks and generate all agent forms.
2. Train using `scripts/train.sh`, which updates the model, catalog and both base
   forms plus profile forms. Regenerate complete agent forms and artwork; check
   reproducibility in the same runner environment and verify inference/provenance.
3. Confirm every base/agent form intended for hosting is already registered. The
   legacy `property-valuation copy.yaml` is validated and synchronized but not hosted.
4. Authenticate with OIDC. Deploy the existing Cloud Run function with no traffic
   and a `release-candidate` tag. `/healthz` loads the actual bundle and runs an
   example prediction without writing a submission. Match revision and manifest hash.
5. Check `main` again, route 100% of traffic to the candidate, and verify the service.
6. Commit only generated catalog/YAML/artwork paths. A normal Git push rejects
   concurrent updates. `GITHUB_TOKEN` commits do not trigger another workflow;
   `[skip ci]` additionally prevents recursive push checks.
7. Compare every registered hosted form with its local YAML and check exact artwork
   bytes. Retry briefly for GitHub CDN propagation. Save release diagnostics and the
   model bundle as GitHub artifacts for 30 days.

Publishing is a push to GitHub `main`: frms.dev fetches its registered YAML directly.
There is no frms.dev CI token. Previously open browser tabs, metadata and social
previews may remain cached. Adding an agent requires registering its GitHub form
with frms.dev before the release; the workflow intentionally fails its registration
preflight rather than creating a new form implicitly.

The fixed training recipe has no held-out accuracy benchmark. These gates verify
integrity, runnable inference, data provenance, application behavior and publication;
they do not establish improved predictive accuracy. The first Ubuntu generation may
change raster artwork because previous files were rendered on macOS.

## Initial setup and permissions

Run `bash scripts/setup-release.sh` with the existing Google project owner session
and a GitHub administrative session for `justforgiggles/property-prices`. The script
adds dedicated deployment/build service accounts, a repository-specific identity
pool/provider, necessary IAM bindings, the `production` environment and its variables.
It can be rerun. It does not create service-account keys or replace existing IAM policy.

The deployment identity has Cloud Run Source Developer and Service Usage Consumer
on `hirebarend`, and Service Account User on the existing runtime identity and dedicated
build identity. The builder has Cloud Run Builder. OIDC trust checks immutable GitHub
repository/owner IDs, `main`, and the exact release workflow path. The workflow itself
has only contents-write and id-token-write permissions. Runtime identity is unchanged.

Environment variables:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: pool/provider resource name.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: deployment identity email.
- `GCP_BUILD_SERVICE_ACCOUNT`: build identity resource name.

`scripts/deploy.sh` still supports local deployment with `hirebarend@gmail.com`.
Set `GCLOUD_ACCOUNT=''` to use CI's active identity. `RELEASE_REVISION_SUFFIX` selects
candidate deployment with no production traffic; leave it unset for the original
local deployment behavior. Set `GCLOUD_BUILD_SERVICE_ACCOUNT` to select the builder.

## Failure and recovery

Before publication, any deployment failure restores the previous traffic split.
After publication, recovery restores only generated outputs through a normal commit,
then restores traffic. Unrelated intervening commits are retained. An intervening edit
to generated files prevents automatic form recovery and is reported as incomplete;
service recovery is still attempted. Training/check failures never touch production.
Concurrent release jobs are serialized; old queued revisions fail the freshness check.

`.release/state.json` journals the source, output allowlist, previous traffic, revision,
model hashes and publication commit before external effects. Inspect the workflow
summary and download `release-<run-id>-<attempt>` for recovery details. Ordinary step
failures invoke recovery; hard runner loss or forced termination cannot guarantee it.
GitHub and Cloud Run do not support a shared atomic transaction.

To retry a failed release, dispatch **Release model and forms** on current `main`.
To restore service manually, use the `previous_traffic` mapping in the release journal:

```sh
gcloud run services update-traffic property-prices-valuation \
  --project hirebarend --region europe-west3 --account hirebarend@gmail.com \
  --to-revisions PREVIOUS_REVISION=100
```

For form recovery, use a clean checkout of current `main`, review changes to the
journal's generated paths since `publication`, and restore those paths from `source`
with `git restore --source SOURCE_SHA --staged --worktree -- <paths>`. Remove outputs
that did not exist at that source. Commit and push normally; never force-push or revert
unrelated user changes. Run `node scripts/verify-hosted-forms.mjs` afterward. If the
runner remains available, `python3 scripts/release.py recover` performs these checks
and operations using its journal and installed credentials.

GitHub's normal workflow failure notifications and the release summary report failures.
No external messaging service is configured.
