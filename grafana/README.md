# Grafana Setup for Fitbit Health Data

Simple setup using Grafana Cloud + Infinity plugin to visualize your Fitbit data.

## Prerequisites

- Grafana Cloud account (free tier is fine)
- Your Fitbit API URL: `https://fitbit-api-594114799065.europe-north1.run.app`
- Your API key (stored in Secret Manager as `fitbit-api-key`)

## Setup Steps

### 1. Create Grafana Cloud Account

1. Go to [grafana.com/products/cloud](https://grafana.com/products/cloud/)
2. Sign up for free account
3. Create a stack (choose region closest to you)

### 2. Install Infinity Plugin

1. In Grafana, go to **Administration** > **Plugins**
2. Search for "Infinity"
3. Click **Install**

### 3. Add Data Source

1. Go to **Connections** > **Data sources** > **Add data source**
2. Search for "Infinity" and select it
3. Configure:
   - **Name**: `Fitbit API`
   - **Base URL**: `https://fitbit-api-594114799065.europe-north1.run.app`
4. Under **HTTP Headers**, add:
   - Header: `X-API-Key`
   - Value: Your API key
5. Click **Save & Test**

### 4. Import Dashboard

1. Go to **Dashboards** > **New** > **Import**
2. Upload `fitbit-dashboard.json` from this directory
3. Select "Fitbit API" as the data source
4. Click **Import**

## Dashboard Panels

| Panel | Data Source Endpoint | Metrics |
|-------|---------------------|---------|
| HRV Trend | `/recovery/history?days=30` | Daily RMSSD over 30 days |
| Sleep Duration | `/sleep/history?days=30` | Hours of sleep per night |
| Sleep Efficiency | `/sleep/history?days=30` | Efficiency percentage |
| Resting Heart Rate | `/heart-rate/resting/history?days=30` | RHR trend |
| Daily Steps | `/activity/history?days=30` | Steps per day |
| Active Zone Minutes | `/activity/history?days=30` | AZM breakdown |

## Usage Tips

- **Don't auto-refresh frequently** - Set to manual or 1-hour minimum to avoid rate limits
- **Viewing twice daily is fine** - Well within Fitbit's 150 requests/hour limit
- **Time range** - Dashboard defaults to 30 days, adjust as needed

## Updating the Dashboard

The dashboard JSON is version controlled. To modify:

1. Make changes in Grafana UI
2. Go to Dashboard Settings > JSON Model
3. Copy and save to `fitbit-dashboard.json`
4. Or ask Claude to modify the JSON directly

## Troubleshooting

**401 Unauthorized**: Check your API key in the data source config

**No data**:
- Verify the API is responding: `curl -H "X-API-Key: YOUR_KEY" https://fitbit-api-594114799065.europe-north1.run.app/health`
- Check Infinity plugin is parsing JSON correctly

**Rate limited**: Reduce refresh frequency, wait until top of hour
