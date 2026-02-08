import { FunctionTool } from "@google/adk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "fixtures");

const USE_FIXTURES = process.env.USE_FIXTURES === "true";

const FITBIT_API_BASE =
  process.env.FITBIT_API_URL ||
  "https://fitbit-api-594114799065.europe-north1.run.app";

const FITBIT_API_KEY = process.env.FITBIT_API_KEY;

/**
 * Mapping from API endpoint paths (without query params) to fixture filenames.
 */
const FIXTURE_MAP: Record<string, string> = {
  "/summary/morning-report": "summary-morning-report.json",
  "/sleep/last-night": "sleep-last-night.json",
  "/recovery/today": "recovery-today.json",
  "/summary/grafana-snapshot": "summary-grafana-snapshot.json",
  "/nightly-health-index": "nightly-health-index.json",
  "/sleep/history": "sleep-history.json",
  "/sleep/stages-history": "sleep-stages-history.json",
  "/recovery/history": "recovery-history.json",
  "/activity/history": "activity-history.json",
  "/activity/today": "activity-today.json",
  "/heart-rate/today": "heart-rate-today.json",
  "/heart-rate/resting/history": "heart-rate-resting-history.json",
};

/**
 * Read fixture JSON for a given endpoint, stripping snapshot metadata.
 */
function readFixture(
  endpoint: string
): { success: boolean; data?: unknown; error?: string } {
  const path = endpoint.split("?")[0];
  const filename = FIXTURE_MAP[path];
  if (!filename) {
    return { success: false, error: `No fixture found for endpoint: ${path}` };
  }
  try {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, filename), "utf-8"));
    const { _snapshot, ...rest } = raw;
    const data = Array.isArray(raw.data) && Object.keys(rest).length === 1 ? raw.data : rest;
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read fixture ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

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
  if (USE_FIXTURES) return readFixture(endpoint);

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
 * Composes data from three endpoints; gracefully degrades if any fail.
 */
export const getWeeklySummary = new FunctionTool({
  name: "get_weekly_summary",
  description: `Fetches 7-day summary with trends for weekly check-ins. Includes:
- Sleep history (duration, efficiency, stages per night)
- Activity history (steps, calories, active zone minutes per day)
- Recovery history (HRV, resting heart rate, SpO2 per day)

Each section may be present or absent independently — partial data is still useful.

Use this for weekly coaching reviews or when user asks about their week.`,
  parameters: z.object({}),
  execute: async () => {
    const [sleep, activity, recovery] = await Promise.all([
      fetchFromFitbitApi("/sleep/history?days=7"),
      fetchFromFitbitApi("/activity/history?days=7"),
      fetchFromFitbitApi("/recovery/history?days=7"),
    ]);

    const data: Record<string, unknown> = {};
    if (sleep.success) data.sleep = sleep.data;
    if (activity.success) data.activity = activity.data;
    if (recovery.success) data.recovery = recovery.data;

    if (Object.keys(data).length === 0) {
      const errors = [
        sleep.error && `sleep: ${sleep.error}`,
        activity.error && `activity: ${activity.error}`,
        recovery.error && `recovery: ${recovery.error}`,
      ]
        .filter(Boolean)
        .join("; ");
      return {
        success: false,
        error: `Failed to fetch weekly data from all sources. ${errors}`,
      };
    }
    return { success: true, data };
  },
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

/**
 * Get today's activity data.
 */
export const getActivityToday = new FunctionTool({
  name: "get_activity_today",
  description: `Fetches today's activity metrics including:
- Steps, calories burned, floors climbed
- Active minutes breakdown (lightly, fairly, very active)
- Active Zone Minutes with heart rate zone distribution (fat_burn, cardio, peak)
- Distance and sedentary minutes

Use when user asks about today's activity, steps, exercise, or calorie burn.`,
  parameters: z.object({}),
  execute: async () => fetchFromFitbitApi("/activity/today"),
});

/**
 * Get multi-day trends for pattern analysis.
 */
export const getTrends = new FunctionTool({
  name: "get_trends",
  description: `Fetches multi-day trend data for pattern analysis. Returns parallel data from:
- Sleep history (duration, efficiency, stages per night)
- Activity history (steps, calories, active zone minutes per day)
- Recovery history (HRV daily_rmssd, vs_baseline_percent, SpO2)
- Resting heart rate history

Each section may be present or absent independently — partial data is still useful.

Use for questions like "how's my week been?", "show me my HRV trend", or "am I sleeping better lately?".`,
  parameters: z.object({
    days: z
      .number()
      .min(7)
      .max(30)
      .describe("Number of days of history to fetch (7-30)"),
  }),
  execute: async ({ days }) => {
    const [sleep, activity, recovery, restingHr] = await Promise.all([
      fetchFromFitbitApi(`/sleep/history?days=${days}`),
      fetchFromFitbitApi(`/activity/history?days=${days}`),
      fetchFromFitbitApi(`/recovery/history?days=${days}`),
      fetchFromFitbitApi(`/heart-rate/resting/history?days=${days}`),
    ]);

    const data: Record<string, unknown> = {};
    if (sleep.success) data.sleep = sleep.data;
    if (activity.success) data.activity = activity.data;
    if (recovery.success) data.recovery = recovery.data;
    if (restingHr.success) data.resting_heart_rate = restingHr.data;

    if (Object.keys(data).length === 0) {
      const errors = [
        sleep.error && `sleep: ${sleep.error}`,
        activity.error && `activity: ${activity.error}`,
        recovery.error && `recovery: ${recovery.error}`,
        restingHr.error && `resting_hr: ${restingHr.error}`,
      ]
        .filter(Boolean)
        .join("; ");
      return {
        success: false,
        error: `Failed to fetch trend data from all sources. ${errors}`,
      };
    }
    return { success: true, data };
  },
});

export const allTools = [
  getMorningReport,
  getWeeklySummary,
  getLastNightSleep,
  getRecoveryMetrics,
  getActivityToday,
  getTrends,
];
