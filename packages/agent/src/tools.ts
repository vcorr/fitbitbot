import { FunctionTool } from "@google/adk";
import { z } from "zod";

const FITBIT_API_BASE =
  process.env.FITBIT_API_URL ||
  "https://fitbit-api-594114799065.europe-north1.run.app";

const FITBIT_API_KEY = process.env.FITBIT_API_KEY;

/**
 * Get headers for Fitbit API requests.
 */
function getApiHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (FITBIT_API_KEY) {
    headers["X-API-Key"] = FITBIT_API_KEY;
  }
  return headers;
}

const FETCH_TIMEOUT_MS = 30000;

/**
 * Fetch from Fitbit API with timeout and consistent error handling.
 */
async function fetchFromFitbitApi(
  endpoint: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${FITBIT_API_BASE}${endpoint}`, {
      headers: getApiHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 429) {
      return {
        success: false,
        error:
          "Fitbit API rate limit exceeded. Try again at the top of the hour.",
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `API request failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: "Request timed out. Please try again.",
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Fetch morning report with sleep, activity, recovery, and trends.
 * This is the primary data source for coaching insights.
 */
export const getMorningReport = new FunctionTool({
  name: "get_morning_report",
  description: `Fetches comprehensive morning health data including:

**Sleep (last night):**
- Duration in hours, efficiency percentage
- Sleep stages with percentages (deep_percent, light_percent, rem_percent)
- Comparison to 7-day average (duration_diff_hours, efficiency_diff)

**Activity (yesterday):**
- Steps, calories, distance
- Active Zone Minutes breakdown (total, fat_burn, cardio, peak)
- Goals met summary

**Recovery (today):**
- HRV with baseline comparison (daily_rmssd, vs_baseline_percent)
- Resting heart rate (resting_heart_rate field)
- SpO2 (avg, min, max), breathing rate, skin temperature

**Exercise (recent):**
- Yesterday's workouts with intensity classification (low/moderate/high)
- Past week count, total minutes, total calories

**Trends (7-day):**
- Averages for sleep duration, efficiency, steps, HRV, resting HR
- Comparison indicators (sleep_vs_avg, hrv_vs_avg, activity_vs_avg)

**Insights:**
- Pre-computed observations about current vs baseline values

Use this tool to get the full picture of the user's health status for coaching.`,
  parameters: z.object({}),
  execute: async () => fetchFromFitbitApi("/summary/morning-report"),
});

/**
 * Get weekly summary with aggregated trends.
 */
export const getWeeklySummary = new FunctionTool({
  name: "get_weekly_summary",
  description: `Fetches 7-day summary with trends for weekly check-ins. Includes:
- Sleep history with averages
- Activity history with step and calorie trends
- Resting heart rate history
- HRV history

Use this for weekly coaching reviews or when user asks about their week.`,
  parameters: z.object({}),
  execute: async () => fetchFromFitbitApi("/summary/week"),
});

/**
 * Get just last night's sleep data.
 */
export const getLastNightSleep = new FunctionTool({
  name: "get_last_night_sleep",
  description: `Fetches last night's sleep data including:
- Duration in hours (actual sleep time, not time in bed)
- Sleep efficiency percentage
- Time in bed vs time asleep (minutes_asleep, time_in_bed_minutes)
- Sleep stages with percentages (deep, deep_percent, light, light_percent, rem, rem_percent, wake)
- Time to fall asleep, minutes awake
- Comparison insights to historical baseline

Use when user asks specifically about their sleep.`,
  parameters: z.object({}),
  execute: async () => fetchFromFitbitApi("/sleep/last-night"),
});

/**
 * Get today's recovery metrics.
 */
export const getRecoveryMetrics = new FunctionTool({
  name: "get_recovery_metrics",
  description: `Fetches today's recovery metrics including:
- HRV (Heart Rate Variability) - daily_rmssd, deep_rmssd, vs_baseline_percent
- SpO2 (blood oxygen) - avg, min, max percentages
- Breathing rate (breaths per minute)
- Skin temperature deviation from baseline (nightly_relative in °C)
- Cardio fitness (VO2 max estimate if available)

Note: vs_baseline_percent shows how today's HRV compares to 7-day average.
Negative means lower than usual, positive means higher than usual.

Use when user asks about recovery, readiness, or HRV specifically.`,
  parameters: z.object({}),
  execute: async () => fetchFromFitbitApi("/recovery/today"),
});

export const allTools = [
  getMorningReport,
  getWeeklySummary,
  getLastNightSleep,
  getRecoveryMetrics,
];
