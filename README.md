# Fitbitbot

AI fitness coach powered by Fitbit data.

## Structure

```
packages/
├── api/      # Fitbit data API (TypeScript/Express)
├── agent/    # AI coaching agent (Google ADK)
└── web/      # Frontend (coming soon)
```

## Services

- **API**: Fetches and transforms Fitbit health data (sleep, HRV, activity, heart rate)
- **Agent**: AI coach that interprets your data and provides personalized advice
- **Grafana**: Dashboard for visualizing health trends

## Deployment

Both API and Agent run on Google Cloud Run (europe-north1).
