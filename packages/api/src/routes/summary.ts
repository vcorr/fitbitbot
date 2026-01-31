import { Router, Request, Response } from "express";
import { getFitbitClient, FitbitAPIError } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";
import { parseSleepRecord } from "./sleep.js";

export const summaryRouter = Router();

// GET /summary/grafana-snapshot - Flat data for Grafana
summaryRouter.get("/grafana-snapshot", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());
  const weekAgo = formatDate(daysAgo(7));
  const yesterday = formatDate(daysAgo(1));

  const result: Record<string, unknown> = {
    date: today,
    sleep_hours: null,
    sleep_efficiency: null,
    sleep_deep_min: null,
    sleep_light_min: null,
    sleep_rem_min: null,
    sleep_wake_min: null,
    hrv_rmssd: null,
    hrv_vs_baseline_pct: null,
    spo2_avg: null,
    breathing_rate: null,
    temp_deviation: null,
    resting_hr: null,
  };

  // Sleep
  try {
    const sleepRaw = await client.getSleepByDate(today) as { sleep?: Array<Record<string, unknown>> };
    for (const entry of sleepRaw.sleep || []) {
      if (entry.isMainSleep) {
        result.sleep_hours = Math.round(((entry.minutesAsleep as number) || 0) / 60 * 100) / 100;
        result.sleep_efficiency = entry.efficiency;
        const levels = entry.levels as Record<string, unknown> | undefined;
        const summary = (levels?.summary as Record<string, { minutes?: number }>) || {};
        result.sleep_deep_min = summary.deep?.minutes || null;
        result.sleep_light_min = summary.light?.minutes || null;
        result.sleep_rem_min = summary.rem?.minutes || null;
        result.sleep_wake_min = summary.wake?.minutes || null;
        break;
      }
    }
  } catch (e) { /* ignore */ }

  // HRV with baseline
  try {
    const hrvRaw = await client.getHrvByDate(today) as { hrv?: Array<{ value: { dailyRmssd?: number } }> };
    if (hrvRaw.hrv?.[0]) {
      result.hrv_rmssd = hrvRaw.hrv[0].value?.dailyRmssd || null;

      // Calculate baseline
      const hrvHistory = await client.getHrvRange(weekAgo, yesterday) as { hrv?: Array<{ value: { dailyRmssd?: number } }> };
      const hrvValues = (hrvHistory.hrv || [])
        .filter((e) => e.value?.dailyRmssd)
        .map((e) => e.value.dailyRmssd!);

      if (hrvValues.length && result.hrv_rmssd) {
        const avg = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
        result.hrv_vs_baseline_pct = Math.round((((result.hrv_rmssd as number) - avg) / avg) * 1000) / 10;
      }
    }
  } catch (e) { /* ignore */ }

  // SpO2
  try {
    const spo2Raw = await client.getSpo2ByDate(today) as { value?: { avg?: number } };
    result.spo2_avg = spo2Raw.value?.avg || null;
  } catch (e) { /* ignore */ }

  // Breathing rate
  try {
    const brRaw = await client.getBreathingRateByDate(today) as { br?: Array<{ value: { breathingRate?: number } }> };
    result.breathing_rate = brRaw.br?.[0]?.value?.breathingRate || null;
  } catch (e) { /* ignore */ }

  // Temperature
  try {
    const tempRaw = await client.getTemperatureByDate(today) as { tempSkin?: Array<{ value: { nightlyRelative?: number } }> };
    result.temp_deviation = tempRaw.tempSkin?.[0]?.value?.nightlyRelative || null;
  } catch (e) { /* ignore */ }

  // Resting HR
  try {
    const hrRaw = await client.getHeartRateByDate(today) as { "activities-heart"?: Array<{ value: { restingHeartRate?: number } }> };
    result.resting_hr = hrRaw["activities-heart"]?.[0]?.value?.restingHeartRate || null;
  } catch (e) { /* ignore */ }

  res.json(result);
});

// GET /summary/morning-report - Comprehensive AI coaching context
summaryRouter.get("/morning-report", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const now = new Date();
  const today = formatDate(now);
  const yesterday = formatDate(daysAgo(1));
  const weekAgo = formatDate(daysAgo(7));

  const insights: Array<{ metric: string; current_value: unknown; baseline_average?: number; comparison?: string; percent_difference?: number; note?: string }> = [];

  // Fetch cached data upfront
  let cachedSleepHistory: { sleep?: Array<Record<string, unknown>> } | null = null;
  let cachedHrvHistory: { hrv?: Array<{ dateTime: string; value: { dailyRmssd?: number } }> } | null = null;

  try {
    cachedSleepHistory = await client.getSleepRange(weekAgo, yesterday) as typeof cachedSleepHistory;
  } catch (e) { /* ignore */ }

  try {
    cachedHrvHistory = await client.getHrvRange(weekAgo, yesterday) as typeof cachedHrvHistory;
  } catch (e) { /* ignore */ }

  // Last night's sleep
  let lastNightSleep = null;
  let sleepComparison = null;

  try {
    const sleepRaw = await client.getSleepByDate(today) as { sleep?: Array<Record<string, unknown>> };
    for (const entry of sleepRaw.sleep || []) {
      if (entry.isMainSleep) {
        lastNightSleep = parseSleepRecord(entry);
        break;
      }
    }

    if (lastNightSleep && cachedSleepHistory?.sleep) {
      const historyRecords = cachedSleepHistory.sleep
        .filter((s) => s.isMainSleep && s.dateOfSleep !== lastNightSleep!.date)
        .map((s) => parseSleepRecord(s));

      if (historyRecords.length) {
        const durations = historyRecords.filter((r) => r.duration_hours).map((r) => r.duration_hours!);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const efficiencies = historyRecords.filter((r) => r.efficiency).map((r) => r.efficiency!);
        const avgEfficiency = efficiencies.length ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;

        sleepComparison = {
          vs_7day_avg_duration_hours: Math.round(avgDuration * 100) / 100,
          vs_7day_avg_efficiency: avgEfficiency ? Math.round(avgEfficiency * 10) / 10 : null,
          duration_diff_hours: lastNightSleep.duration_hours ? Math.round((lastNightSleep.duration_hours - avgDuration) * 100) / 100 : null,
          efficiency_diff: lastNightSleep.efficiency && avgEfficiency ? Math.round((lastNightSleep.efficiency - avgEfficiency) * 10) / 10 : null,
        };
      }
    }
  } catch (e) { /* ignore */ }

  // Yesterday's activity
  let yesterdayActivity = null;
  try {
    const activityRaw = await client.getActivityByDate(yesterday) as { summary?: Record<string, unknown>; goals?: Record<string, unknown> };
    const summary = activityRaw.summary || {};
    yesterdayActivity = {
      date: yesterday,
      steps: summary.steps || null,
      calories_out: summary.caloriesOut || null,
      fairly_active_minutes: summary.fairlyActiveMinutes || null,
      very_active_minutes: summary.veryActiveMinutes || null,
      active_zone_minutes: null as { total: number | null; fat_burn: number | null; cardio: number | null; peak: number | null } | null,
    };

    // Fetch AZM
    try {
      const azmRaw = await client.getActiveZoneMinutesByDate(yesterday) as { "activities-active-zone-minutes"?: Array<{ value: Record<string, unknown> }> };
      const azmData = azmRaw["activities-active-zone-minutes"]?.[0]?.value || {};
      yesterdayActivity.active_zone_minutes = {
        total: (azmData.activeZoneMinutes as number) || null,
        fat_burn: (azmData.fatBurnActiveZoneMinutes as number) || null,
        cardio: (azmData.cardioActiveZoneMinutes as number) || null,
        peak: (azmData.peakActiveZoneMinutes as number) || null,
      };
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }

  // Recovery
  let recovery = null;
  let hrvData = null;

  try {
    const hrvRaw = await client.getHrvByDate(today) as { hrv?: Array<{ dateTime: string; value: { dailyRmssd?: number; deepRmssd?: number } }> };
    if (hrvRaw.hrv?.[0]) {
      const entry = hrvRaw.hrv[0];
      let vsBaselinePercent = null;

      if (cachedHrvHistory?.hrv) {
        const hrvValues = cachedHrvHistory.hrv
          .filter((e) => e.value?.dailyRmssd)
          .map((e) => e.value.dailyRmssd!);
        if (hrvValues.length && entry.value?.dailyRmssd) {
          const avg = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
          vsBaselinePercent = Math.round(((entry.value.dailyRmssd - avg) / avg) * 1000) / 10;
        }
      }

      hrvData = {
        date: entry.dateTime || today,
        daily_rmssd: entry.value?.dailyRmssd || null,
        deep_rmssd: entry.value?.deepRmssd || null,
        vs_baseline_percent: vsBaselinePercent,
      };
    }
  } catch (e) { /* ignore */ }

  recovery = { hrv: hrvData };

  // Resting HR
  let restingHeartRate = null;
  try {
    const hrRaw = await client.getHeartRateByDate(today) as { "activities-heart"?: Array<{ value: { restingHeartRate?: number } }> };
    restingHeartRate = hrRaw["activities-heart"]?.[0]?.value?.restingHeartRate || null;
  } catch (e) { /* ignore */ }

  // Trends
  let trends = null;
  try {
    const sleepDurations: number[] = [];
    const hrvValues: number[] = [];

    if (cachedSleepHistory?.sleep) {
      for (const entry of cachedSleepHistory.sleep) {
        if (entry.isMainSleep && entry.minutesAsleep) {
          sleepDurations.push((entry.minutesAsleep as number) / 60);
        }
      }
    }

    if (cachedHrvHistory?.hrv) {
      for (const entry of cachedHrvHistory.hrv) {
        if (entry.value?.dailyRmssd) {
          hrvValues.push(entry.value.dailyRmssd);
        }
      }
    }

    trends = {
      days_of_data: Math.max(sleepDurations.length, hrvValues.length, 1),
      sleep_avg_duration_hours: sleepDurations.length ? Math.round((sleepDurations.reduce((a, b) => a + b, 0) / sleepDurations.length) * 100) / 100 : null,
      hrv_avg: hrvValues.length ? Math.round((hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length) * 10) / 10 : null,
    };
  } catch (e) { /* ignore */ }

  res.json({
    report_generated_at: now.toISOString(),
    last_night_sleep: lastNightSleep,
    sleep_comparison: sleepComparison,
    yesterday_activity: yesterdayActivity,
    recovery,
    resting_heart_rate: restingHeartRate,
    trends,
    insights,
    data_summary: {
      day_of_week: now.toLocaleDateString("en-US", { weekday: "long" }),
      is_weekend: now.getDay() === 0 || now.getDay() === 6,
    },
  });
});
