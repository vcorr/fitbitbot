import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const bodyWeightRouter = Router();

interface WeightEntry {
  date: string;
  time: string;
  weight: number;
  bmi: number;
  fat?: number;
  logId: number;
}

// GET /body-weight/today
bodyWeightRouter.get("/today", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());

  const rawData = await client.getWeightByDate(today) as {
    weight?: WeightEntry[];
  };

  const entries = rawData.weight || [];
  const latest = entries[entries.length - 1] || null;

  res.json({
    date: today,
    weight_kg: latest?.weight ?? null,
    bmi: latest?.bmi ?? null,
    body_fat_percent: latest?.fat ?? null,
    raw_data: rawData,
  });
});

// GET /body-weight/history?days=N
bodyWeightRouter.get("/history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(new Date());

  const rawData = await client.getWeightRange(startDate, endDate) as {
    weight?: WeightEntry[];
  };

  const entries = rawData.weight || [];
  const records = entries.map((entry) => ({
    date: entry.date,
    weight_kg: entry.weight,
    bmi: entry.bmi,
    body_fat_percent: entry.fat ?? null,
  }));

  // Sort by date descending
  records.sort((a, b) => b.date.localeCompare(a.date));

  const weights = records.map((r) => r.weight_kg).filter((v): v is number => v !== null);
  const bmis = records.map((r) => r.bmi).filter((v): v is number => v !== null);
  const fats = records.map((r) => r.body_fat_percent).filter((v): v is number => v !== null);

  const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

  const averages = {
    weight_kg: avg(weights),
    bmi: avg(bmis),
    body_fat_percent: avg(fats),
    min_weight_kg: weights.length ? Math.min(...weights) : null,
    max_weight_kg: weights.length ? Math.max(...weights) : null,
  };

  res.json({
    days_requested: days,
    records,
    averages,
    raw_data: rawData,
  });
});
