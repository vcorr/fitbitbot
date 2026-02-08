# Fitbitbot

AI fitness coach using Fitbit data + Google Gemini agent.

## Project Structure

- `packages/api/` - Fitbit data API (Express + TypeScript)
- `packages/agent/` - AI coaching agent (Google ADK)
- `packages/web/` - Frontend (coming soon)
- `.github/workflows/deploy-api.yml` - CI/CD

## Commands

```bash
npm install             # Install all workspace dependencies
npm run api             # Start API dev server
npm run agent           # Start agent server
npm run build           # Build all packages
npm run cli -w @fitbitbot/agent  # Test agent interactively
```

## Development Rules

### Always

- Use TypeScript strict mode
- Use ES modules (`import/export`), not CommonJS
- Use Zod for input validation
- Use `express-async-errors` for Express routes
- Read existing code before modifying
- Test locally before deploying

### Never

- Commit secrets to git (use `.env` locally, Secret Manager in production)
- Use `require()` - this project uses ES modules
- Skip error handling in API routes
- Give generic health advice - always fetch user's actual data first
- Commit to main directly, always use branches and pull requests

## Code Conventions

### API (`packages/api/`)

- One route file per domain: sleep, activity, recovery, summary
- All routes return: `{success: boolean, data?, error?}`
- 30-second timeout for Fitbit API calls
- Handle Fitbit 429 rate limits with user-friendly messages
- Register new routes in `packages/api/src/server.ts`

### Agent (`packages/agent/`)

- Coaching logic lives in `COACH_INSTRUCTION` in `src/index.ts`
- Function tools defined in `src/tools.ts` with clear descriptions + Zod schemas
- Tools must return structured `{success, data?, error?}` responses
- Always fetch data before coaching (never give generic advice)

### Health Metrics Context

When working with health data, understand these principles:

- **HRV vs_baseline_percent**: Negative = needs rest, Positive = ready for intensity
- **Sleep efficiency**: >85% is good, <85% indicates sleep issues
- **Sleep stages**: Target 15-20% deep, 20-25% REM
- **Active Zone Minutes**: More important than raw step counts
- **Coaching context**: Low HRV after hard workout is NORMAL (expected recovery)
- Always compare metrics to user's personal baseline, not population averages

## Deployment

- **Auto deploy**: Push to `main` → GitHub Actions deploys API to Cloud Run
- **Region**: europe-north1
- **Project**: ai-coach-485409
- **Secrets**: Stored in Google Secret Manager (CLIENT_ID, CLIENT_SECRET, FITBIT_TOKEN, API_KEY)
- **Authentication**: API requires `X-API-Key` header, services not publicly accessible
- **Token Refresh**: Cloud Scheduler automatically refreshes Fitbit tokens every 7 hours (see `docs/token-refresh-setup.md`)

### Token Refresh

Fitbit access tokens expire after 8 hours. Production uses Cloud Scheduler to automatically refresh tokens every 7 hours.

**IMPORTANT**: NEVER refresh tokens manually from your local environment. This can:
- Overwrite production tokens with stale local versions
- Cause authentication failures in production
- Trigger unnecessary Fitbit API rate limits

**To check token refresh status:**
```bash
# View scheduler job status
gcloud scheduler jobs describe fitbit-token-refresh --location=europe-north1

# Check token refresh logs
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'Token Refresh'" --limit=10

# Verify new token versions in Secret Manager
gcloud secrets versions list fitbit-token --limit=5
```

See `docs/token-refresh-setup.md` for complete setup and troubleshooting instructions.

## Important Context

- Node.js >=22.0.0 required
- Fitbit API has hourly rate limits (agent handles 429s gracefully)
- This is a personal project (single user, no multi-tenant concerns yet)
- Grafana dashboard in `grafana/` directory for health visualization
