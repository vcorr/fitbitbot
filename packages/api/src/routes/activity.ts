import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const activityRouter = Router();

// GET /activity/today
activityRouter.get("/today", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());

  const rawData = await client.getActivityByDate(today) as { summary?: Record<string, unknown>; goals?: Record<string, unknown> };
  const summary = rawData.summary || {};

  res.json({
    date: today,
    steps: summary.steps || null,
    calories_out: summary.caloriesOut || null,
    floors: summary.floors || null,
    distance_km: null,
    sedentary_minutes: summary.sedentaryMinutes || null,
    lightly_active_minutes: summary.lightlyActiveMinutes || null,
    fairly_active_minutes: summary.fairlyActiveMinutes || null,
    very_active_minutes: summary.veryActiveMinutes || null,
    raw_data: rawData,
    insights: [],
  });
});

// GET /activity/history
activityRouter.get("/history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 90);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  const stepsRaw = await client.getActivityTimeSeries("steps", startDate, endDate) as { "activities-steps"?: Array<{ dateTime: string; value: string }> };

  const records = (stepsRaw["activities-steps"] || []).map((entry) => ({
    date: entry.dateTime,
    steps: parseInt(entry.value) || 0,
  }));

  // Sort by date descending
  records.sort((a, b) => b.date.localeCompare(a.date));

  const stepsValues = records.map((r) => r.steps);
  const averages = {
    steps: stepsValues.length ? Math.round(stepsValues.reduce((a, b) => a + b, 0) / stepsValues.length) : null,
  };

  res.json({
    days_requested: days,
    records,
    averages,
    raw_data: stepsRaw,
    insights: [],
  });
});
