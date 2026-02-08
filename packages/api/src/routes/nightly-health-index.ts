import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo, zScores } from "../utils.js";
import { parseSleepRecord } from "./sleep.js";

export const nightlyHealthIndexRouter = Router();

interface HrvEntry {
  dateTime: string;
  value: { dailyRmssd?: number; deepRmssd?: number };
}

interface HeartRateEntry {
  dateTime: string;
  value: { restingHeartRate?: number };
}

interface Spo2Entry {
  dateTime?: string;
  value?: { avg?: number; min?: number; max?: number };
}

interface BrEntry {
  dateTime: string;
  value: { breathingRate?: number };
}

interface TempEntry {
  dateTime: string;
  value: { nightlyRelative?: number };
}

// GET /nightly-health-index?days=30
nightlyHealthIndexRouter.get("/", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  // Fetch all 6 metrics in parallel — failures are isolated
  // TODO: Add caching layer to avoid redundant Fitbit API calls
  const [hrvResult, rhrResult, sleepResult, spo2Result, brResult, tempResult] =
    await Promise.allSettled([
      client.getHrvRange(startDate, endDate) as Promise<{ hrv?: HrvEntry[] }>,
      client.getHeartRateRange(startDate, endDate) as Promise<{
        "activities-heart"?: HeartRateEntry[];
      }>,
      client.getSleepRange(startDate, endDate) as Promise<{ sleep?: Record<string, unknown>[] }>,
      client.getSpo2Range(startDate, endDate) as unknown as Promise<Spo2Entry[]>,
      client.getBreathingRateRange(startDate, endDate) as Promise<{ br?: BrEntry[] }>,
      client.getTemperatureRange(startDate, endDate) as Promise<{ tempSkin?: TempEntry[] }>,
    ]);

  // Build date-keyed maps for each metric
  const hrvMap = new Map<string, number>();
  if (hrvResult.status === "fulfilled") {
    for (const entry of hrvResult.value.hrv || []) {
      if (entry.value?.dailyRmssd != null) {
        hrvMap.set(entry.dateTime, entry.value.dailyRmssd);
      }
    }
  }

  const rhrMap = new Map<string, number>();
  if (rhrResult.status === "fulfilled") {
    for (const entry of rhrResult.value["activities-heart"] || []) {
      if (entry.value?.restingHeartRate != null) {
        rhrMap.set(entry.dateTime, entry.value.restingHeartRate);
      }
    }
  }

  const sleepHoursMap = new Map<string, number>();
  const sleepEfficiencyMap = new Map<string, number>();
  if (sleepResult.status === "fulfilled") {
    for (const entry of sleepResult.value.sleep || []) {
      if (entry.isMainSleep) {
        const parsed = parseSleepRecord(entry);
        if (parsed.duration_hours != null) {
          sleepHoursMap.set(parsed.date, parsed.duration_hours);
        }
        if (parsed.efficiency != null) {
          sleepEfficiencyMap.set(parsed.date, parsed.efficiency);
        }
      }
    }
  }

  const spo2Map = new Map<string, number>();
  if (spo2Result.status === "fulfilled") {
    const entries = Array.isArray(spo2Result.value) ? spo2Result.value : [];
    for (const entry of entries) {
      if (entry.dateTime && entry.value?.avg != null) {
        spo2Map.set(entry.dateTime, entry.value.avg);
      }
    }
  }

  const brMap = new Map<string, number>();
  if (brResult.status === "fulfilled") {
    for (const entry of brResult.value.br || []) {
      if (entry.value?.breathingRate != null) {
        brMap.set(entry.dateTime, entry.value.breathingRate);
      }
    }
  }

  const tempMap = new Map<string, number>();
  if (tempResult.status === "fulfilled") {
    for (const entry of tempResult.value.tempSkin || []) {
      if (entry.value?.nightlyRelative != null) {
        tempMap.set(entry.dateTime, entry.value.nightlyRelative);
      }
    }
  }

  // Collect all unique dates and sort ascending
  const allDates = [
    ...new Set([
      ...hrvMap.keys(),
      ...rhrMap.keys(),
      ...sleepHoursMap.keys(),
      ...sleepEfficiencyMap.keys(),
      ...spo2Map.keys(),
      ...brMap.keys(),
      ...tempMap.keys(),
    ]),
  ].sort();

  if (allDates.length === 0) {
    res.status(503).json({
      error: "Unable to retrieve any health metrics. Please try again later.",
    });
    return;
  }

  // Build aligned arrays for z-score computation
  const hrvValues = allDates.map((d) => hrvMap.get(d) ?? null);
  const rhrValues = allDates.map((d) => rhrMap.get(d) ?? null);
  const sleepHoursValues = allDates.map((d) => sleepHoursMap.get(d) ?? null);
  const sleepEffValues = allDates.map((d) => sleepEfficiencyMap.get(d) ?? null);
  const spo2Values = allDates.map((d) => spo2Map.get(d) ?? null);
  const brValues = allDates.map((d) => brMap.get(d) ?? null);
  const tempValues = allDates.map((d) => tempMap.get(d) ?? null);

  // Compute z-scores (invert for metrics where lower = better)
  const hrvZ = zScores(hrvValues);
  const rhrZ = zScores(rhrValues, true);
  const sleepHoursZ = zScores(sleepHoursValues);
  const sleepEffZ = zScores(sleepEffValues);
  const spo2Z = zScores(spo2Values);
  const brZ = zScores(brValues, true);
  const tempZ = zScores(tempValues, true);

  // Build output records
  const records = allDates.map((date, i) => {
    const scores = [hrvZ[i], rhrZ[i], sleepHoursZ[i], sleepEffZ[i], spo2Z[i], brZ[i], tempZ[i]];
    const validScores = scores.filter((s): s is number => s !== null);
    const composite =
      validScores.length > 0
        ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100) / 100
        : null;

    return {
      date,
      hrv_z: hrvZ[i],
      rhr_z: rhrZ[i],
      sleep_hours_z: sleepHoursZ[i],
      sleep_eff_z: sleepEffZ[i],
      spo2_z: spo2Z[i],
      br_z: brZ[i],
      temp_z: tempZ[i],
      composite,
    };
  });

  const rawValues = allDates.map((date, i) => ({
    date,
    hrv: hrvValues[i],
    rhr: rhrValues[i],
    sleep_hours: sleepHoursValues[i],
    sleep_efficiency: sleepEffValues[i],
    spo2: spo2Values[i],
    breathing_rate: brValues[i],
    temp_deviation: tempValues[i],
  }));

  res.json({
    days_requested: days,
    records,
    raw_values: rawValues,
  });
});
