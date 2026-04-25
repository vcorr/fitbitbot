import { z } from "zod";

// ── Sleep (v1.2) ──────────────────────────────────────────────────────────────

const SleepStageSchema = z.object({ minutes: z.number().optional() }).passthrough();

export const SleepEntrySchema = z.object({
  dateOfSleep: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  efficiency: z.number().optional(),
  minutesAsleep: z.number().optional(),
  minutesAwake: z.number().optional(),
  timeInBed: z.number().optional(),
  isMainSleep: z.boolean().optional(),
  levels: z
    .object({
      summary: z
        .object({
          deep: SleepStageSchema.optional(),
          light: SleepStageSchema.optional(),
          rem: SleepStageSchema.optional(),
          wake: SleepStageSchema.optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export const SleepResponseSchema = z.object({
  sleep: z.array(SleepEntrySchema).optional(),
}).passthrough();

// ── Activity ──────────────────────────────────────────────────────────────────

export const ActivityResponseSchema = z.object({
  summary: z
    .object({
      steps: z.number().optional(),
      caloriesOut: z.number().optional(),
      floors: z.number().optional(),
      sedentaryMinutes: z.number().optional(),
      lightlyActiveMinutes: z.number().optional(),
      fairlyActiveMinutes: z.number().optional(),
      veryActiveMinutes: z.number().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export const StepsTimeSeriesSchema = z.object({
  "activities-steps": z
    .array(z.object({ dateTime: z.string(), value: z.string() }).passthrough())
    .optional(),
}).passthrough();

// ── Heart Rate ────────────────────────────────────────────────────────────────

const HeartRateZoneSchema = z.object({
  name: z.string(),
  minutes: z.number(),
  caloriesOut: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).passthrough();

export const HeartRateResponseSchema = z.object({
  "activities-heart": z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({
          restingHeartRate: z.number().optional(),
          heartRateZones: z.array(HeartRateZoneSchema).optional(),
        }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── HRV ───────────────────────────────────────────────────────────────────────

export const HrvResponseSchema = z.object({
  hrv: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({
          dailyRmssd: z.number().optional(),
          deepRmssd: z.number().optional(),
        }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── SpO2 ──────────────────────────────────────────────────────────────────────

const Spo2ValueSchema = z.object({
  avg: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).passthrough();

export const Spo2DayResponseSchema = z.object({
  dateTime: z.string().optional(),
  value: Spo2ValueSchema.optional(),
}).passthrough();

export const Spo2RangeResponseSchema = z.array(
  z.object({
    dateTime: z.string().optional(),
    value: Spo2ValueSchema.optional(),
  }).passthrough()
);

// ── Breathing Rate ────────────────────────────────────────────────────────────

export const BreathingRateResponseSchema = z.object({
  br: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ breathingRate: z.number().optional() }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── Skin Temperature ──────────────────────────────────────────────────────────

export const TemperatureResponseSchema = z.object({
  tempSkin: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ nightlyRelative: z.number().optional() }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── Cardio Fitness (VO2 Max) ──────────────────────────────────────────────────

export const CardioFitnessResponseSchema = z.object({
  cardioScore: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ vo2Max: z.string().optional() }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── Active Zone Minutes ───────────────────────────────────────────────────────

export const AzmResponseSchema = z.object({
  "activities-active-zone-minutes": z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({
          activeZoneMinutes: z.number().optional(),
          fatBurnActiveZoneMinutes: z.number().optional(),
          cardioActiveZoneMinutes: z.number().optional(),
          peakActiveZoneMinutes: z.number().optional(),
        }).passthrough(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── Body Weight ───────────────────────────────────────────────────────────────

export const WeightResponseSchema = z.object({
  weight: z
    .array(
      z.object({
        date: z.string(),
        time: z.string().optional(),
        weight: z.number(),
        bmi: z.number().optional(),
        fat: z.number().optional(),
        // logId can exceed JS Number.MAX_SAFE_INTEGER — accept both number and string
        logId: z.union([z.number(), z.string()]).optional(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

// ── Activity Logs (Workouts) ──────────────────────────────────────────────────

export const ActivityLogsResponseSchema = z.object({
  activities: z
    .array(
      z.object({
        activityName: z.string(),
        startTime: z.string(),
        activeDuration: z.number(),
        calories: z.number().optional(),
        steps: z.number().optional(),
        distance: z.number().optional(),
        distanceUnit: z.string().optional(),
        averageHeartRate: z.number().optional(),
        heartRateZones: z
          .array(
            z.object({
              name: z.string(),
              minutes: z.number(),
              caloriesOut: z.number().optional(),
            }).passthrough()
          )
          .optional(),
        originalStartTime: z.string().optional(),
      }).passthrough()
    )
    .optional(),
}).passthrough();
