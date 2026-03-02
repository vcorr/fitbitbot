import { Router, Request, Response } from "express";
import { z } from "zod";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const cardioFitnessRouter = Router();

const HistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

interface CardioScoreEntry {
  dateTime: string;
  value: {
    vo2Max?: string;
  };
}

/**
 * Parse VO2 Max value which may be a range string like "42-46" or a single number.
 * Returns { low, high } for ranges or { low: n, high: n } for single values.
 */
function parseVo2Max(value: string | undefined): { low: number; high: number } | null {
  if (!value) return null;
  if (value.includes("-")) {
    const [low, high] = value.split("-").map(Number);
    if (!isNaN(low) && !isNaN(high)) return { low, high };
  }
  const num = Number(value);
  if (!isNaN(num)) return { low: num, high: num };
  return null;
}

// GET /cardio-fitness/today
cardioFitnessRouter.get("/today", async (_req: Request, res: Response) => {
  const client = getFitbitClient();
  const today = formatDate(new Date());

  const rawData = await client.getCardioFitnessByDate(today) as {
    cardioScore?: CardioScoreEntry[];
  };

  const entries = rawData.cardioScore || [];
  const latest = entries[entries.length - 1] || null;
  const vo2Max = latest ? parseVo2Max(latest.value?.vo2Max) : null;

  res.json({
    success: true,
    data: {
      date: today,
      vo2_max: vo2Max,
      raw_data: rawData,
    },
  });
});

// GET /cardio-fitness/history?days=N
cardioFitnessRouter.get("/history", async (req: Request, res: Response) => {
  const { days } = HistoryQuerySchema.parse(req.query);
  const client = getFitbitClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(new Date());

  const rawData = await client.getCardioFitnessRange(startDate, endDate) as {
    cardioScore?: CardioScoreEntry[];
  };

  const entries = rawData.cardioScore || [];
  const records = entries.map((entry) => {
    const vo2Max = parseVo2Max(entry.value?.vo2Max);
    return {
      date: entry.dateTime,
      vo2_max: vo2Max,
    };
  });

  // Sort by date descending
  records.sort((a, b) => b.date.localeCompare(a.date));

  // Compute averages using midpoint of ranges
  const midpoints = records
    .map((r) => r.vo2_max ? (r.vo2_max.low + r.vo2_max.high) / 2 : null)
    .filter((v): v is number => v !== null);

  const averages = {
    vo2_max_midpoint: midpoints.length
      ? Math.round((midpoints.reduce((a, b) => a + b, 0) / midpoints.length) * 10) / 10
      : null,
  };

  res.json({
    success: true,
    data: {
      days_requested: days,
      records,
      averages,
      raw_data: rawData,
    },
  });
});
