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

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/vcorr/fitbitbot?utm_source=oss&utm_medium=github&utm_campaign=vcorr%2Ffitbitbot&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)