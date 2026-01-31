import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const recoveryRouter = Router();

// GET /recovery/today
recoveryRouter.get("/today", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());

  const rawData: Record<string, unknown> = {};
  let hrv = null;
  let spo2 = null;
  let breathingRate = null;
  let temperature = null;

  // HRV
  try {
    const hrvRaw = await client.getHrvByDate(today) as { hrv?: Array<{ dateTime: string; value: { dailyRmssd?: number; deepRmssd?: number } }> };
    rawData.hrv = hrvRaw;
    if (hrvRaw.hrv?.[0]) {
      const entry = hrvRaw.hrv[0];
      hrv = {
        date: entry.dateTime || today,
        daily_rmssd: entry.value?.dailyRmssd || null,
        deep_rmssd: entry.value?.deepRmssd || null,
        vs_baseline_percent: null,
      };
    }
  } catch (e) {
    console.log("HRV fetch failed:", e);
  }

  // SpO2
  try {
    const spo2Raw = await client.getSpo2ByDate(today) as { dateTime?: string; value?: { avg?: number; min?: number; max?: number } };
    rawData.spo2 = spo2Raw;
    if (spo2Raw.value) {
      spo2 = {
        date: spo2Raw.dateTime || today,
        avg: spo2Raw.value.avg || null,
        min: spo2Raw.value.min || null,
        max: spo2Raw.value.max || null,
      };
    }
  } catch (e) {
    console.log("SpO2 fetch failed:", e);
  }

  // Breathing rate
  try {
    const brRaw = await client.getBreathingRateByDate(today) as { br?: Array<{ dateTime: string; value: { breathingRate?: number } }> };
    rawData.breathing_rate = brRaw;
    if (brRaw.br?.[0]) {
      const entry = brRaw.br[0];
      breathingRate = {
        date: entry.dateTime || today,
        breathing_rate: entry.value?.breathingRate || null,
      };
    }
  } catch (e) {
    console.log("Breathing rate fetch failed:", e);
  }

  // Temperature
  try {
    const tempRaw = await client.getTemperatureByDate(today) as { tempSkin?: Array<{ dateTime: string; value: { nightlyRelative?: number } }> };
    rawData.temperature = tempRaw;
    if (tempRaw.tempSkin?.[0]) {
      const entry = tempRaw.tempSkin[0];
      temperature = {
        date: entry.dateTime || today,
        nightly_relative: entry.value?.nightlyRelative || null,
      };
    }
  } catch (e) {
    console.log("Temperature fetch failed:", e);
  }

  res.json({
    date: today,
    hrv,
    spo2,
    breathing_rate: breathingRate,
    temperature,
    cardio_fitness: null,
    raw_data: rawData,
    insights: [],
  });
});

// GET /recovery/history
recoveryRouter.get("/history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  const hrvRaw = await client.getHrvRange(startDate, endDate) as { hrv?: Array<{ dateTime: string; value: { dailyRmssd?: number; deepRmssd?: number } }> };

  const hrvRecords = (hrvRaw.hrv || []).map((entry) => ({
    date: entry.dateTime,
    daily_rmssd: entry.value?.dailyRmssd || null,
    deep_rmssd: entry.value?.deepRmssd || null,
  }));

  // Sort by date descending
  hrvRecords.sort((a, b) => b.date.localeCompare(a.date));

  const hrvValues = hrvRecords.filter((r) => r.daily_rmssd).map((r) => r.daily_rmssd!);
  const averages = {
    hrv_rmssd: hrvValues.length ? Math.round((hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length) * 10) / 10 : null,
  };

  res.json({
    days_requested: days,
    hrv_records: hrvRecords,
    spo2_records: [],
    breathing_rate_records: [],
    temperature_records: [],
    averages,
    raw_data: { hrv: hrvRaw },
    insights: [],
  });
});
