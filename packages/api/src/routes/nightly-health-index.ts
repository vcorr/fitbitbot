import { Router, Request, Response } from "express";
import { z } from "zod";
import { getFitbitClient, FitbitRateLimitError } from "../fitbit-client.js";
import { formatDate, daysAgo, getDateChunks, zScores } from "../utils.js";
import { parseSleepRecord } from "./sleep.js";

export const nightlyHealthIndexRouter = Router();

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});


// GET /nightly-health-index?days=30
nightlyHealthIndexRouter.get("/", async (req: Request, res: Response) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid days parameter. Must be integer 1-90." });
    return;
  }
  const { days } = parsed.data;
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  // Fitbit HRV API only supports 30-day ranges; chunk larger requests
  const chunks = getDateChunks(startDate, endDate);
  type HrvResponse = Awaited<ReturnType<typeof client.getHrvRange>>;

  const fetchChunkedHrv = async (): Promise<HrvResponse> => {
    if (chunks.length === 1) {
      return client.getHrvRange(chunks[0].startDate, chunks[0].endDate);
    }
    const results = await Promise.allSettled(
      chunks.map((c) => client.getHrvRange(c.startDate, c.endDate)),
    );
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof FitbitRateLimitError) {
        throw r.reason;
      }
    }
    const allEntries: NonNullable<HrvResponse["hrv"]> = [];
    for (const r of results) {
      if (r.status === "fulfilled") allEntries.push(...(r.value.hrv || []));
    }
    return { hrv: allEntries };
  };

  // Fetch all 6 metrics in parallel — failures are isolated
  // TODO: Add caching layer to avoid redundant Fitbit API calls
  const [hrvResult, rhrResult, sleepResult, spo2Result, brResult, tempResult] =
    await Promise.allSettled([
      fetchChunkedHrv(),
      client.getHeartRateRange(startDate, endDate),
      client.getSleepRange(startDate, endDate),
      client.getSpo2Range(startDate, endDate),
      client.getBreathingRateRange(startDate, endDate),
      client.getTemperatureRange(startDate, endDate),
    ]);

  // Surface 429 rate-limit errors instead of silently swallowing them
  const results = [hrvResult, rhrResult, sleepResult, spo2Result, brResult, tempResult];
  const rateLimited = results.find(
    (r) => r.status === "rejected" && r.reason instanceof FitbitRateLimitError
  );
  if (rateLimited) {
    throw (rateLimited as PromiseRejectedResult).reason;
  }

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
    for (const entry of spo2Result.value) {
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
  const rhrZ = zScores(rhrValues, true); // lower RHR = better
  const sleepHoursZ = zScores(sleepHoursValues);
  const sleepEffZ = zScores(sleepEffValues);
  const spo2Z = zScores(spo2Values);
  const brZ = zScores(brValues, true); // lower breathing rate = better
  // Skin temp is a deviation metric — any deviation (positive or negative) is bad
  const tempAbsValues = tempValues.map((v) => (v !== null ? Math.abs(v) : null));
  const tempZ = zScores(tempAbsValues, true); // higher absolute deviation = worse

  // Build output records (require >= 3 metrics for a meaningful composite)
  const MIN_METRICS_FOR_COMPOSITE = 3;
  const records = allDates.map((date, i) => {
    const scores = [hrvZ[i], rhrZ[i], sleepHoursZ[i], sleepEffZ[i], spo2Z[i], brZ[i], tempZ[i]];
    const validScores = scores.filter((s): s is number => s !== null);
    const composite =
      validScores.length >= MIN_METRICS_FOR_COMPOSITE
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
      metrics_count: validScores.length,
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
