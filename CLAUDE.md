# CLAUDE.md

## Project Overview

FastAPI backend serving Fitbit health data for an AI coaching application. The API provides **data only** - the consuming AI agent (Gemini) interprets data and generates recommendations.

## Quick Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server (with auto-reload)
uvicorn api.main:app --reload

# API docs at http://localhost:8000/docs

# Initial OAuth authentication (opens browser)
python -m auth
```

## Project Structure

```
api/                          # FastAPI application
├── main.py                   # App entry point, router registration
├── fitbit_client.py          # Fitbit API wrapper with OAuth token management
├── models.py                 # Pydantic response models
└── routers/                  # API endpoints
    ├── sleep.py              # Sleep duration, efficiency, stages
    ├── activity.py           # Steps, calories, active minutes
    ├── exercise.py           # Logged workouts
    ├── heart_rate.py         # Resting HR, zones, intraday
    ├── recovery.py           # HRV, SpO2, breathing, temperature
    ├── summary.py            # Aggregated endpoints (morning-report)
    └── trends.py             # Trend analysis

auth/                         # OAuth2 browser-based authentication
output/                       # Token storage (.token.json) - gitignored
```

## Key Endpoints

| Endpoint | Purpose | API Calls |
|----------|---------|-----------|
| `GET /summary/morning-report` | **Main endpoint** - complete AI coaching context | ~11 |
| `GET /recovery/today` | HRV, SpO2, breathing, temperature | ~5 |
| `GET /sleep/last-night` | Most recent sleep with stages | 1 |
| `GET /activity/today` | Today's steps, calories, zones | 1 |

## Architecture Notes

**FitbitClient** (`api/fitbit_client.py`):
- Handles all Fitbit API calls with auto token refresh
- 30-second timeout on all requests
- Raises `FitbitAPIError` (general) and `FitbitRateLimitError` (429)
- Singleton via `get_fitbit_client()` dependency

**Response Design**:
- All responses include `raw_data` for transparency
- `insights` list with computed comparisons to baselines
- Factual classifications only - no recommendations
- Missing data returns `null`, not errors

**Rate Limiting**: 150 Fitbit API requests/hour. Rate limit errors return HTTP 429.

## Adding New Functionality

1. Add Fitbit API method to `api/fitbit_client.py`
2. Add Pydantic models to `api/models.py`
3. Create/update router in `api/routers/`
4. Register new routers in `api/main.py`

## Environment Variables

Local development uses `.env` file. Cloud Run uses Secret Manager.

| Variable | Purpose |
|----------|---------|
| `CLIENT_ID` | Fitbit OAuth client ID |
| `CLIENT_SECRET` | Fitbit OAuth client secret |
| `FITBIT_TOKEN` | JSON with access_token/refresh_token (Cloud Run only) |

## Git Workflow

Never commit directly to `main`. Use feature branches and PRs.

## Known Issues (from AGENTS.md)

- CORS allows all origins (`allow_origins=["*"]`) - should restrict in production
- Duplicate parse functions across routers could be extracted
- No timezone-aware datetime handling
