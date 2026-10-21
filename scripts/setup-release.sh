#!/bin/bash
# Run with an administrator's gcloud session and GH_TOKEN for the repository owner.
set -euo pipefail
project=hirebarend
number=1008115912104
repository=justforgiggles/property-prices
account=${GCLOUD_ACCOUNT:-hirebarend@gmail.com}
pool=property-prices-github
provider=github
runtime="$number-compute@developer.gserviceaccount.com"
deployer="property-prices-deploy@$project.iam.gserviceaccount.com"
builder="property-prices-build@$project.iam.gserviceaccount.com"
cloud() { gcloud "$@" --project="$project" --account="$account" --quiet; }
cloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
for name in property-prices-deploy property-prices-build; do
  if ! cloud iam service-accounts describe "$name@$project.iam.gserviceaccount.com" >/dev/null 2>&1; then
    cloud iam service-accounts create "$name" --display-name="$name GitHub release"
  fi
done
if ! cloud iam workload-identity-pools describe "$pool" --location=global >/dev/null 2>&1; then
  cloud iam workload-identity-pools create "$pool" --location=global --display-name='Property prices GitHub'
fi
condition="assertion.repository_id == '1370448547' && assertion.repository_owner_id == '322805962' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$repository/.github/workflows/release.yml@refs/heads/main'"
operation=create-oidc
if cloud iam workload-identity-pools providers describe "$provider" --workload-identity-pool="$pool" --location=global >/dev/null 2>&1; then operation=update-oidc; fi
cloud iam workload-identity-pools providers "$operation" "$provider" \
  --workload-identity-pool="$pool" --location=global \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' \
  --attribute-condition="$condition"
cloud iam service-accounts add-iam-policy-binding "$deployer" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.repository_id/1370448547" >/dev/null
for role in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
  cloud projects add-iam-policy-binding "$project" --member="serviceAccount:$deployer" --role="$role" --condition=None >/dev/null
done
cloud projects add-iam-policy-binding "$project" --member="serviceAccount:$builder" --role=roles/run.builder --condition=None >/dev/null
for identity in "$runtime" "$builder"; do
  cloud iam service-accounts add-iam-policy-binding "$identity" --member="serviceAccount:$deployer" --role=roles/iam.serviceAccountUser >/dev/null
done
gh api --method PUT "repos/$repository/environments/production" --input - <<'JSON' >/dev/null
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
if ! gh api "repos/$repository/environments/production/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
  gh api --method POST "repos/$repository/environments/production/deployment-branch-policies" -f name=main -f type=branch >/dev/null
fi
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$repository" --env production --body "projects/$number/locations/global/workloadIdentityPools/$pool/providers/$provider"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$repository" --env production --body "$deployer"
gh variable set GCP_BUILD_SERVICE_ACCOUNT --repo "$repository" --env production --body "projects/$project/serviceAccounts/$builder"
printf '%s\n' 'Production federation and GitHub variables configured. No service-account keys created.'
