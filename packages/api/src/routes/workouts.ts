import { Router, Request, Response } from "express";
import { z } from "zod";
import { getFitbitClient } from "../fitbit-client.js";
import { formatDate, daysAgo } from "../utils.js";

export const workoutsRouter = Router();

const MS_PER_DAY = 86_400_000;

const WorkoutsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

interface HeartRateZone {
  name: string;
  minutes: number;
  caloriesOut?: number;
}

interface ActivityLogEntry {
  activityName: string;
  startTime: string;
  activeDuration: number; // milliseconds
  calories: number;
  steps?: number;
  distance?: number;
  distanceUnit?: string;
  averageHeartRate?: number;
  heartRateZones?: HeartRateZone[];
  originalStartTime: string;
}

// GET /workouts?days=N
workoutsRouter.get("/", async (req: Request, res: Response) => {
  const { days } = WorkoutsQuerySchema.parse(req.query);
  const client = getFitbitClient();

  const cutoffDate = formatDate(daysAgo(days));
  // Fetch from tomorrow (to include today) with a generous limit
  const beforeDate = formatDate(new Date(Date.now() + MS_PER_DAY));

  const rawData = await client.getActivityLogs(beforeDate, 100) as {
    activities?: ActivityLogEntry[];
  };

  const allActivities = rawData.activities || [];

  // Filter to only activities within the requested date range
  const activities = allActivities.filter((a) => {
    const activityDate = a.originalStartTime?.slice(0, 10) || a.startTime?.slice(0, 10);
    return activityDate >= cutoffDate;
  });

  const workouts = activities.map((a) => ({
    name: a.activityName,
    start_time: a.originalStartTime || a.startTime,
    duration_minutes: Math.round(a.activeDuration / 60000),
    calories: a.calories || 0,
    steps: a.steps || null,
    distance_km: a.distance
      ? Math.round((a.distanceUnit === "Mile" ? a.distance * 1.60934 : a.distance) * 100) / 100
      : null,
    average_heart_rate: a.averageHeartRate || null,
    heart_rate_zones: a.heartRateZones
      ? a.heartRateZones
          .filter((z) => z.minutes > 0)
          .map((z) => ({ name: z.name, minutes: z.minutes }))
      : null,
  }));

  const summary = {
    total_workouts: workouts.length,
    total_minutes: workouts.reduce((sum, w) => sum + w.duration_minutes, 0),
    total_calories: workouts.reduce((sum, w) => sum + w.calories, 0),
  };

  res.json({
    success: true,
    data: {
      days_requested: days,
      workouts,
      summary,
      raw_data: rawData,
    },
  });
});
