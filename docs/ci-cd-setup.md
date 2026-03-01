# CI/CD Setup — GitHub Actions → Cloud Run

## Overview

Pushing to `main` (changes in `packages/api/` or the workflow file) triggers automatic deployment to Cloud Run via GitHub Actions. Manual deploys can be triggered via `workflow_dispatch`.

Workflow file: `.github/workflows/deploy-api.yml`

## Architecture

```
GitHub Actions (OIDC token)
  → Workload Identity Federation (WIF)
    → Impersonates service account
      → Pushes image to Artifact Registry (europe-north1)
      → Deploys to Cloud Run (europe-north1)
```

## Container Registry

Images are stored in **Artifact Registry** in `europe-north1` (co-located with Cloud Run):

```
europe-north1-docker.pkg.dev/ai-coach-485409/fitbit-api/fitbit-api
```

**Important**: Do NOT use `gcr.io` — it defaults to US location, adding latency for Cloud Run in europe-north1.

## Authentication — Workload Identity Federation

WIF allows GitHub Actions to authenticate to GCP without storing long-lived service account keys.

### Components

| Component | Value |
|---|---|
| **GCP Project** | `ai-coach-485409` |
| **Project Number** | `594114799065` |
| **Service Account** | `github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com` |
| **WIF Pool** | `github` (global) |
| **WIF Provider** | `github-provider` |
| **Provider Full Path** | `projects/594114799065/locations/global/workloadIdentityPools/github/providers/github-provider` |

### GitHub Secrets

| Secret | Value |
|---|---|
| `WIF_PROVIDER` | `projects/594114799065/locations/global/workloadIdentityPools/github/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | `github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com` |

### Required IAM Roles

The service account `github-actions-deployer@` needs these **project-level** roles:

- `roles/run.admin` — deploy to Cloud Run
- `roles/iam.serviceAccountUser` — act as the Cloud Run service account
- `roles/storage.admin` — access GCS (legacy, for other uses)
- `roles/artifactregistry.writer` — push container images

The WIF pool needs this **service-account-level** binding:

- `roles/iam.workloadIdentityUser` on the service account, granted to:
  ```
  principalSet://iam.googleapis.com/projects/594114799065/locations/global/workloadIdentityPools/github/attribute.repository/vcorr/fitbitbot
  ```

## Docker Build — package-lock.json

The Dockerfile in `packages/api/` runs `npm ci` with its own `package-lock.json`. Since this is a monorepo with npm workspaces, the root `npm install` hoists dependencies to the root `node_modules/`.

**Critical**: When adding dependencies to `packages/api/package.json`, you must regenerate the lock file **in isolation** (not via the workspace), otherwise `npm ci` in Docker will fail:

```bash
# Wrong — workspace-aware, won't update packages/api/package-lock.json properly
cd packages/api && npm install

# Right — generate lock file as if it's a standalone package
cp packages/api/package.json /tmp/lockfile-regen/
cd /tmp/lockfile-regen && npm install --package-lock-only
cp package-lock.json /path/to/packages/api/package-lock.json
```

Then verify with `docker build -t test packages/api` before pushing.

## Troubleshooting

### `npm ci` fails with "Missing: ... from lock file"

The `package-lock.json` in `packages/api/` is out of sync. Regenerate it in isolation (see above).

### "Account deleted" or "Unable to acquire impersonated credentials"

The WIF secrets in GitHub are pointing to a deleted or wrong resource. Verify:

```bash
# Check service account exists
gcloud iam service-accounts describe github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com --project ai-coach-485409

# Check WIF pool/provider exist
gcloud iam workload-identity-pools providers list --workload-identity-pool=github --location=global --project=ai-coach-485409

# Verify project number matches (should be 594114799065)
gcloud projects describe ai-coach-485409 --format='value(projectNumber)'
```

Then update GitHub secrets if needed:

```bash
gh secret set WIF_PROVIDER --repo vcorr/fitbitbot --body "projects/594114799065/locations/global/workloadIdentityPools/github/providers/github-provider"
gh secret set WIF_SERVICE_ACCOUNT --repo vcorr/fitbitbot --body "github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com"
```

### "Permission 'iam.serviceAccounts.getAccessToken' denied"

The WIF principal can't impersonate the service account. Add the binding:

```bash
gcloud iam service-accounts add-iam-policy-binding github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com \
  --project=ai-coach-485409 \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/594114799065/locations/global/workloadIdentityPools/github/attribute.repository/vcorr/fitbitbot"
```

### "Permission 'artifactregistry.repositories.uploadArtifacts' denied"

The service account lacks AR write access:

```bash
gcloud projects add-iam-policy-binding ai-coach-485409 \
  --member="serviceAccount:github-actions-deployer@ai-coach-485409.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

### Re-runs don't pick up secret changes

GitHub Actions re-runs use the original run's secret snapshot. Trigger a **new** run instead:

```bash
gh workflow run deploy-api.yml --repo vcorr/fitbitbot --ref main
```
