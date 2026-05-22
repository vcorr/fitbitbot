import { Router, Request, Response } from "express";
import { getHealthClient } from "../health-client.js";
import { type SleepEntrySchema } from "../fitbit-schemas.js";
import { formatDate, daysAgo } from "../utils.js";
import { type z } from "zod";

export const sleepRouter = Router();

type SleepEntry = z.infer<typeof SleepEntrySchema>;

interface SleepStages {
  deep: number | null;
  deep_percent: number | null;
  light: number | null;
  light_percent: number | null;
  rem: number | null;
  rem_percent: number | null;
  wake: number | null;
}

interface SleepRecord {
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_hours: number | null;
  time_in_bed_minutes: number | null;
  minutes_asleep: number | null;
  minutes_awake: number | null;
  efficiency: number | null;
  stages: SleepStages | null;
  is_main_sleep: boolean;
}

export function parseSleepRecord(entry: SleepEntry): SleepRecord {
  let stages: SleepStages | null = null;

  const summary = entry.levels?.summary;
  if (summary) {
    const deep = summary.deep?.minutes ?? null;
    const light = summary.light?.minutes ?? null;
    const rem = summary.rem?.minutes ?? null;
    const wake = summary.wake?.minutes ?? null;

    const totalSleep = (deep || 0) + (light || 0) + (rem || 0);

    stages = {
      deep,
      deep_percent: deep && totalSleep ? Math.round((deep / totalSleep) * 1000) / 10 : null,
      light,
      light_percent: light && totalSleep ? Math.round((light / totalSleep) * 1000) / 10 : null,
      rem,
      rem_percent: rem && totalSleep ? Math.round((rem / totalSleep) * 1000) / 10 : null,
      wake,
    };
  }

  const minutesAsleep = entry.minutesAsleep ?? 0;
  const durationHours = minutesAsleep ? Math.round((minutesAsleep / 60) * 100) / 100 : null;

  return {
    date: entry.dateOfSleep ?? "",
    start_time: entry.startTime ?? null,
    end_time: entry.endTime ?? null,
    duration_hours: durationHours,
    time_in_bed_minutes: entry.timeInBed ?? null,
    minutes_asleep: entry.minutesAsleep ?? null,
    minutes_awake: entry.minutesAwake ?? null,
    efficiency: entry.efficiency ?? null,
    stages,
    is_main_sleep: entry.isMainSleep ?? true,
  };
}

// GET /sleep/last-night
sleepRouter.get("/last-night", async (_req: Request, res: Response) => {
  const client = getHealthClient();
  const today = formatDate(new Date());

  const rawData = await client.getSleepByDate(today);
  const sleepArray = rawData.sleep || [];

  let sleepRecord: SleepRecord | null = null;
  for (const entry of sleepArray) {
    if (entry.isMainSleep) {
      sleepRecord = parseSleepRecord(entry);
      break;
    }
  }
  if (!sleepRecord && sleepArray.length > 0) {
    sleepRecord = parseSleepRecord(sleepArray[0]);
  }

  res.json({
    sleep: sleepRecord,
    raw_data: rawData,
    insights: [],
  });
});

// GET /sleep/history
sleepRouter.get("/history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const client = getHealthClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(daysAgo(1));

  const rawData = await client.getSleepRange(startDate, endDate);
  const sleepArray = rawData.sleep || [];

  const records: SleepRecord[] = [];
  for (const entry of sleepArray) {
    if (entry.isMainSleep) {
      records.push(parseSleepRecord(entry));
    }
  }

  // Sort by date descending
  records.sort((a, b) => b.date.localeCompare(a.date));

  // Calculate averages
  const durations = records.filter((r) => r.duration_hours).map((r) => r.duration_hours!);
  const efficiencies = records.filter((r) => r.efficiency).map((r) => r.efficiency!);

  const averages = {
    duration_hours: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100 : null,
    efficiency: efficiencies.length ? Math.round((efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length) * 10) / 10 : null,
  };

  res.json({
    days_requested: days,
    records,
    averages,
    raw_data: rawData,
    insights: [],
  });
});

// GET /sleep/stages-history (flat format for Grafana)
sleepRouter.get("/stages-history", async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 30);
  const client = getHealthClient();

  const startDate = formatDate(daysAgo(days));
  const endDate = formatDate(new Date());

  const rawData = await client.getSleepRange(startDate, endDate);
  const sleepArray = rawData.sleep || [];

  const records: Array<{
    date: string;
    deep: number;
    light: number;
    rem: number;
    wake: number;
    total_sleep: number;
    efficiency: number | null;
  }> = [];

  for (const entry of sleepArray) {
    if (entry.isMainSleep) {
      const summary = entry.levels?.summary || {};
      records.push({
        date: entry.dateOfSleep ?? "",
        deep: summary.deep?.minutes ?? 0,
        light: summary.light?.minutes ?? 0,
        rem: summary.rem?.minutes ?? 0,
        wake: summary.wake?.minutes ?? 0,
        total_sleep: entry.minutesAsleep ?? 0,
        efficiency: entry.efficiency ?? null,
      });
    }
  }

  // Sort by date ascending for chart display
  records.sort((a, b) => a.date.localeCompare(b.date));

  res.json({ records });
});
