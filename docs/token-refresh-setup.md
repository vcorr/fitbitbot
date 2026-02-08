# Fitbit Token Refresh Setup

This document explains how to set up automatic token refresh for the Fitbit API using Google Cloud Scheduler.

## Overview

Fitbit access tokens expire after 8 hours. To prevent service interruptions, we use Cloud Scheduler to automatically refresh tokens four times daily (00:00, 07:00, 14:00, 21:00 UTC) before expiration.

## Architecture

- **Endpoint**: `POST /refresh-token`
- **Schedule**: Four times daily at 00:00, 07:00, 14:00, 21:00 UTC (`0 */7 * * *` cron)
- **Authentication**: Protected by X-API-Key header
- **Storage**: Refreshed tokens are automatically saved to Secret Manager (`fitbit-token`)

## Setup Instructions

### 1. Deploy the API

Ensure the API is deployed to Cloud Run with the `/refresh-token` endpoint:

```bash
git push origin main
```

This triggers the GitHub Actions workflow that deploys to Cloud Run.

### 2. Get the Cloud Run URL

```bash
gcloud run services describe fitbit-api \
  --region=europe-north1 \
  --format='value(status.url)'
```

Example output: `https://fitbit-api-xxxxxxxxx-lz.a.run.app`

### 3. Create the Cloud Scheduler Job

Replace `YOUR_API_URL` and `YOUR_API_KEY` in the command below:

```bash
gcloud scheduler jobs create http fitbit-token-refresh \
  --location=europe-north1 \
  --schedule="0 */7 * * *" \
  --uri="YOUR_API_URL/refresh-token" \
  --http-method=POST \
  --headers="X-API-Key=YOUR_API_KEY" \
  --oidc-service-account-email="ai-coach-485409@appspot.gserviceaccount.com" \
  --max-retry-attempts=3 \
  --max-backoff=1h \
  --min-backoff=5s \
  --description="Refresh Fitbit access token four times daily before 8-hour expiration"
```

**Important Notes:**
- Schedule runs at: 00:00, 07:00, 14:00, and 21:00 UTC every day
- Uses exponential backoff: 5s → 10s → 20s between retries (max-backoff=1h only applies to retries beyond the 3rd)
- Service account must have `roles/run.invoker` permission on the Cloud Run service

### 4. Verify the Job is Created

```bash
gcloud scheduler jobs list --location=europe-north1
```

Look for `fitbit-token-refresh` in the output.

## Testing

### Manual Test via API

Test the endpoint directly with curl:

```bash
# Replace YOUR_API_URL and YOUR_API_KEY
curl -X POST https://fitbit-api-xxxxxxxxx-lz.a.run.app/refresh-token \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "success": true,
  "message": "Token refreshed successfully"
}
```

### Trigger the Scheduler Job Manually

```bash
gcloud scheduler jobs run fitbit-token-refresh \
  --location=europe-north1
```

### Check Job Execution Logs

```bash
# View scheduler logs
gcloud scheduler jobs describe fitbit-token-refresh \
  --location=europe-north1

# View Cloud Run logs (to see token refresh activity)
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=fitbit-api \
   AND textPayload=~'Token Refresh'" \
  --limit=20 \
  --format=json
```

### Verify Tokens in Secret Manager

Check that new token versions are being created:

```bash
gcloud secrets versions list fitbit-token --limit=5
```

You should see new versions created four times daily.

## Monitoring

### Check Last Execution Status

```bash
gcloud scheduler jobs describe fitbit-token-refresh \
  --location=europe-north1 \
  --format='value(status.lastAttemptTime, status.state)'
```

### View Execution History

Go to Google Cloud Console:
1. Navigate to **Cloud Scheduler**
2. Click on `fitbit-token-refresh`
3. Click on **Logs** tab to see execution history

## Troubleshooting

### Job Returns 401 Unauthorized

- **Cause**: Invalid or missing API key
- **Fix**: Update the job with the correct API key from Secret Manager:

```bash
# Get the API key
gcloud secrets versions access latest --secret=api-key

# Update the job
gcloud scheduler jobs update http fitbit-token-refresh \
  --location=europe-north1 \
  --headers="X-API-Key=YOUR_CORRECT_API_KEY"
```

### Job Returns 500 Internal Server Error

- **Cause**: Token refresh failed (invalid credentials or expired refresh token)
- **Fix**: Check Cloud Run logs for details:

```bash
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=fitbit-api \
   AND severity>=ERROR" \
  --limit=50 \
  --format=json
```

If the refresh token itself has expired, you'll need to re-authenticate via the Fitbit OAuth flow.

### Job Not Running

- **Cause**: Job is paused or disabled
- **Fix**: Resume the job:

```bash
gcloud scheduler jobs resume fitbit-token-refresh \
  --location=europe-north1
```

## Important Warnings

### NEVER Refresh Tokens Locally

**DO NOT** run token refresh operations from your local development environment. This can cause issues:

1. Local environment lacks permissions to update Secret Manager
2. Can overwrite production tokens with stale local tokens
3. May trigger rate limits on the Fitbit API

**Always** let Cloud Scheduler handle token refresh in production.

### Rate Limits

Fitbit API has a limit of 150 requests per hour per user. Token refresh operations count toward this limit, but they're minimal (1 request per refresh).

## Updating the Schedule

If you need to change the refresh frequency:

```bash
gcloud scheduler jobs update http fitbit-token-refresh \
  --location=europe-north1 \
  --schedule="NEW_CRON_EXPRESSION"
```

**Recommended schedules:**
- Every 7 hours: `0 */7 * * *` (current, safe)
- Every 6 hours: `0 */6 * * *` (more frequent, extra safety)
- Twice daily: `0 0,12 * * *` (minimum, risky if one fails)

## Deleting the Job

If you need to remove the scheduler job:

```bash
gcloud scheduler jobs delete fitbit-token-refresh \
  --location=europe-north1
```

## Security Notes

- The `/refresh-token` endpoint is protected by the same X-API-Key authentication as other API routes
- Cloud Scheduler uses OIDC authentication with a service account
- Service account must have `roles/run.invoker` permission
- Refreshed tokens are stored securely in Google Secret Manager
- All communication happens over HTTPS
