# Fitbit Personal AI Coach API

## Overview

This project provides a FastAPI backend that serves Fitbit health data for an AI coaching application. The API is designed to be consumed by an AI agent that generates personalized health coaching messages.

**Key principle:** The API provides **data only**, not coaching advice. The AI agent consuming this API is responsible for interpreting the data and generating recommendations.

## Architecture

```
fitbit-explorer/
├── api/                      # FastAPI application
│   ├── main.py              # App entry point, router registration
│   ├── fitbit_client.py     # Fitbit API wrapper with auth
│   ├── models.py            # Pydantic response models
│   └── routers/             # Endpoint modules
│       ├── sleep.py         # Sleep endpoints
│       ├── activity.py      # Activity/steps endpoints
│       ├── exercise.py      # Logged workouts
│       ├── heart_rate.py    # Heart rate data
│       ├── recovery.py      # HRV, SpO2, breathing, temp
│       ├── summary.py       # Aggregated endpoints
│       └── trends.py        # Trend analysis
├── auth/                    # OAuth2 authentication module
│   └── __init__.py          # Token management, refresh flow
├── endpoints/               # Legacy direct API explorers
├── output/                  # Token storage (.token.json)
└── .env                     # Credentials (CLIENT_ID, CLIENT_SECRET)
```

## Running the Server

```bash
# Install dependencies
pip install -r requirements.txt

# Start development server (auto-reload)
uvicorn api.main:app --reload

# API docs available at http://localhost:8000/docs
```

## Key API Endpoints

### Primary Endpoint for AI Coach

**`GET /summary/morning-report`** - The main endpoint for AI coaching context.

Returns:
- Last night's sleep with 7-day comparison
- Yesterday's activity (full day, not today's partial)
- Today's recovery metrics (HRV, SpO2, breathing rate, temperature)
- Recent exercise summary
- 7-day trends
- Factual `data_summary` classifications for AI context

**API calls per request:** ~11 (optimized with caching)

### Other Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /sleep/last-night` | Most recent sleep record |
| `GET /sleep/history?days=30` | Sleep trends |
| `GET /activity/today` | Today's steps, calories, HR zones |
| `GET /activity/history?days=30` | Activity trends |
| `GET /exercises/recent?days=7` | Logged workouts |
| `GET /heart-rate/today` | Resting HR and zones |
| `GET /heart-rate/resting/history?days=30` | Resting HR trend |
| `GET /recovery/today` | HRV, SpO2, breathing, temperature |
| `GET /recovery/history?days=30` | Recovery trends |
| `GET /summary/today` | All today's data combined |
| `GET /summary/week` | 7-day summary |
| `GET /trends/analysis?days=30` | Trend analysis with data availability |

## Rate Limiting

**Fitbit API limit:** 150 requests per hour per user

- Rate limit resets at the top of each hour
- The `/summary/morning-report` endpoint uses ~11 API calls
- Safe to call morning report ~13 times per hour
- On rate limit, API returns HTTP 429 with clear error message:

```json
{
  "detail": {
    "error": "rate_limit_exceeded",
    "message": "Fitbit API rate limit exceeded (150 requests/hour). Try again later.",
    "retry_after": "Wait until the top of the hour for quota reset."
  }
}
```

## Error Handling

- `FitbitAPIError` - General API errors (auth failures, invalid requests)
- `FitbitRateLimitError` - Specific 429 rate limit errors (bubbles up to HTTP 429)
- Non-rate-limit errors are caught silently for optional data (insights, trends)
- Rate limit errors always propagate and return proper HTTP 429

## Data Models

Key response models in `api/models.py`:

- `SleepRecord` - Sleep duration, efficiency, stages (deep/light/REM/wake)
- `ActivitySummary` - Steps, calories, active minutes, goals, HR zones
- `ExerciseRecord` - Logged workouts with duration, calories, HR
- `HRVData` - Heart rate variability (daily_rmssd, deep_rmssd)
- `RecoveryTodayResponse` - HRV, SpO2, breathing rate, temperature, cardio fitness
- `MorningReportResponse` - Aggregated data for AI coaching
- `Insight` - Computed insight comparing current value to baseline

## Data Sources

The user wears a Fitbit watch constantly. Available data:

| Metric | Source | Notes |
|--------|--------|-------|
| Sleep stages | Watch | Deep, light, REM, wake minutes |
| Steps | Watch + Phone | Phone app may have longer history |
| Heart rate | Watch | Resting HR, zones, intraday |
| HRV | Watch | Requires sleep, reflects recovery |
| SpO2 | Watch | Blood oxygen during sleep |
| Breathing rate | Watch | Breaths per minute during sleep |
| Skin temperature | Watch | Relative to baseline |
| Cardio fitness | Watch | VO2 Max estimate |

**Not used:** Food logging, weight (no smart scale)

## Caching Strategy

The morning report caches these API calls to avoid duplicates:
- `sleep_range(week_ago, yesterday)` - Used for sleep comparison AND trends
- `hrv_range(week_ago, yesterday)` - Used for HRV insight AND trends

## Known Issues / TODOs

From code review (PR #1):

### Must Fix (COMPLETED)
- [x] Initialize `_refresh_token` attribute in FitbitClient.__init__
- [x] Add request timeouts to all HTTP calls (30 second timeout)
- [x] Add logging for caught exceptions (using Python logging module)

### Should Fix
- [ ] Extract duplicate parse functions to shared module
- [ ] Add timezone-aware datetime handling
- [ ] Fix potential division-by-zero in average calculations
- [ ] Improve CORS configuration (currently allows all origins)

### Nice to Have
- [ ] Add integration tests
- [ ] Complete type hints throughout
- [ ] Add file locking for token storage

## Cloud Run Deployment

### Prerequisites

1. Google Cloud project with Cloud Run API enabled
2. `gcloud` CLI installed and authenticated
3. Fitbit OAuth tokens (run local auth first)

### Deploy Steps

```bash
# Set your project
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Build and push container
gcloud builds submit --tag gcr.io/$PROJECT_ID/fitbit-api

# Create secrets in Secret Manager (first time only)
echo -n "your-client-id" | gcloud secrets create fitbit-client-id --data-file=-
echo -n "your-client-secret" | gcloud secrets create fitbit-client-secret --data-file=-
cat output/.token.json | jq -c . | gcloud secrets create fitbit-token --data-file=-

# Deploy to Cloud Run (uses Secret Manager for security)
gcloud run deploy fitbit-api \
  --image gcr.io/$PROJECT_ID/fitbit-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --set-secrets "CLIENT_ID=fitbit-client-id:latest" \
  --set-secrets "CLIENT_SECRET=fitbit-client-secret:latest" \
  --set-secrets "FITBIT_TOKEN=fitbit-token:latest"
```

### Updating Secrets

```bash
# Update token if needed (e.g., after re-authentication)
cat output/.token.json | jq -c . | gcloud secrets versions add fitbit-token --data-file=-
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLIENT_ID` | Fitbit OAuth client ID |
| `CLIENT_SECRET` | Fitbit OAuth client secret |
| `FITBIT_TOKEN` | JSON string with access_token and refresh_token |

### Token Refresh

- Tokens are refreshed automatically when expired
- In Cloud Run, refreshed tokens persist in memory for container lifetime
- If container restarts, it uses `FITBIT_TOKEN` env var (refresh_token should still be valid)
- For long-term reliability, periodically update `FITBIT_TOKEN` with fresh tokens

### Cost Estimate

With `min-instances=1`: ~$1-3/month for minimal usage.

## Authentication

OAuth2 flow with automatic token refresh:

1. Initial auth: Run `python -m auth` to get tokens via browser
2. Tokens stored in `output/.token.json`
3. `FitbitClient` auto-refreshes expired tokens
4. Credentials in `.env`: `CLIENT_ID`, `CLIENT_SECRET`

## Code Review with CodeRabbit CLI

CodeRabbit CLI is installed for AI-powered code reviews.

### Basic Usage

```bash
# Review committed changes against main branch
coderabbit review --type committed --base main --plain

# Review uncommitted changes
coderabbit review --type uncommitted --plain

# Minimal output for AI agent processing
coderabbit review --prompt-only

# Review specific commits (compare against a base commit)
coderabbit review --base-commit <commit-hash> --plain
```

### Best Practices

1. Run after completing a feature or fix, before pushing
2. Use `--plain` for readable output, `--prompt-only` for minimal AI-friendly output
3. Can take 7-30+ minutes for large changes
4. Rate limits: 2-8 reviews/hour depending on plan

### When to Use

- Before creating a PR
- After significant refactoring
- To catch security issues, bugs, and best practice violations

## Development Notes

### Git Workflow

**Never commit directly to `main`.** Always:
1. Create a feature branch: `git checkout -b feature/description`
2. Make changes and commit to the branch
3. Push and create a PR
4. Merge via PR after review

### Adding New Endpoints

1. Add Fitbit API method to `api/fitbit_client.py`
2. Add Pydantic models to `api/models.py`
3. Create router in `api/routers/` or add to existing router
4. Register router in `api/main.py` if new file

### Response Design Principles

- Include `raw_data` for debugging/transparency
- Add `insights` list for computed comparisons
- Use factual classifications, not recommendations
- Handle missing data gracefully (return null, not error)
- Always include date context
