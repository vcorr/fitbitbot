import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const heartRateRouter = Router();

// GET /heart-rate/today
heartRateRouter.get("/today", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());

  const rawData = await client.getHeartRateByDate(today) as {
    "activities-heart"?: Array<{
      dateTime: string;
      value: {
        restingHeartRate?: number;
        heartRateZones?: Array<{ name: string; minutes: number; caloriesOut?: number; min?: number; max?: number }>;
      };
    }>;
  };

  let restingHeartRate = null;
  const zones: Array<{ name: string; minutes: number; calories_out: number | null; min_hr: number | null; max_hr: number | null }> = [];

  if (rawData["activities-heart"]?.[0]) {
    const hrData = rawData["activities-heart"][0].value;
    restingHeartRate = hrData.restingHeartRate || null;

    for (const zone of hrData.heartRateZones || []) {
      zones.push({
        name: zone.name,
        minutes: zone.minutes,
        calories_out: zone.caloriesOut || null,
        min_hr: zone.min || null,
        max_hr: zone.max || null,
      });
    }
  }

  res.json({
    date: today,
    resting_heart_rate: restingHeartRate,
    zones,
    raw_data: rawData,
    insights: [],
  });
});

// GET /heart-rate/resting/history
heartRateRouter.get("/resting/history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  const rawData = await client.getHeartRateRange(startDate, endDate) as {
    "activities-heart"?: Array<{
      dateTime: string;
      value: { restingHeartRate?: number };
    }>;
  };

  const records: Array<{ date: string; value: number | null }> = [];
  const values: number[] = [];

  for (const entry of rawData["activities-heart"] || []) {
    const rhr = entry.value?.restingHeartRate || null;
    records.push({
      date: entry.dateTime,
      value: rhr,
    });
    if (rhr) values.push(rhr);
  }

  // Sort by date descending
  records.sort((a, b) => b.date.localeCompare(a.date));

  res.json({
    days_requested: days,
    records,
    average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null,
    min_value: values.length ? Math.min(...values) : null,
    max_value: values.length ? Math.max(...values) : null,
    raw_data: rawData,
    insights: [],
  });
});
