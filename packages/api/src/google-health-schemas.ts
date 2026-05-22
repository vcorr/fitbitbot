/**
 * Zod schemas for raw Google Health API v4 responses.
 * These are internal to GoogleHealthClient — route files never see these shapes.
 * All schemas use .passthrough() so unknown fields don't break parsing while the
 * API stabilises (GA from end of May 2026; minor shape changes remain possible).
 */
import { z } from "zod";

const DataSourceSchema = z.object({
  dataStreamId: z.string().optional(),
  dataStreamName: z.string().optional(),
}).passthrough();

const BaseDataPointSchema = z.object({
  dataType: z.string().optional(),
  dataSource: DataSourceSchema.optional(),
}).passthrough();

/** Wraps every Google Health list/reconcile/dailyRollUp response. */
const makeResponse = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    dataPoints: z.array(schema).optional(),
    nextPageToken: z.string().optional(),
  }).passthrough();

// ── Sleep ────────────────────────────────────────────────────────────────────

const GHSleepStagesSchema = z.object({
  deep:  z.object({ minutes: z.number() }).passthrough().optional(),
  light: z.object({ minutes: z.number() }).passthrough().optional(),
  rem:   z.object({ minutes: z.number() }).passthrough().optional(),
  wake:  z.object({ minutes: z.number() }).passthrough().optional(),
}).passthrough();

export const GHSleepResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    sleep: z.object({
      startTime:     z.string().optional(),
      endTime:       z.string().optional(),
      efficiency:    z.number().optional(),
      minutesAsleep: z.number().optional(),
      minutesAwake:  z.number().optional(),
      timeInBed:     z.number().optional(),
      stages:        GHSleepStagesSchema.optional(),
    }).passthrough().optional(),
    date:        z.string().optional(),
    isMainSleep: z.boolean().optional(),
  })
);

// ── Daily Heart Rate Variability ─────────────────────────────────────────────

export const GHDailyHrvResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    dailyHeartRateVariability: z.object({
      date:       z.string().optional(),
      dailyRmssd: z.number().optional(),
      deepRmssd:  z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Daily Resting Heart Rate ─────────────────────────────────────────────────

export const GHRestingHrResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    dailyRestingHeartRate: z.object({
      date:              z.string().optional(),
      restingHeartRate:  z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Daily Oxygen Saturation (SpO2) ────────────────────────────────────────────

export const GHSpO2ResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    dailyOxygenSaturation: z.object({
      date: z.string().optional(),
      avg:  z.number().optional(),
      min:  z.number().optional(),
      max:  z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Steps (daily roll-up) ─────────────────────────────────────────────────────

export const GHStepsResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    steps: z.object({ value: z.number().optional() }).passthrough().optional(),
    date:  z.string().optional(),
  })
);

// ── Active Zone Minutes (daily roll-up) ───────────────────────────────────────

export const GHAzmResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    activeZoneMinutes: z.object({
      activeZoneMinutes:          z.number().optional(),
      fatBurnActiveZoneMinutes:   z.number().optional(),
      cardioActiveZoneMinutes:    z.number().optional(),
      peakActiveZoneMinutes:      z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Exercise / Workouts ───────────────────────────────────────────────────────

export const GHExerciseResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    exercise: z.object({
      activityType:     z.string().optional(),
      activityName:     z.string().optional(),
      startTime:        z.string().optional(),
      endTime:          z.string().optional(),
      // Google returns duration in seconds; converted to ms in the client to match Fitbit shape.
      activeDurationSeconds: z.number().optional(),
      calories:         z.number().optional(),
      steps:            z.number().optional(),
      distance:         z.number().optional(),
      distanceUnit:     z.string().optional(),
      averageHeartRate: z.number().optional(),
      maxHeartRate:     z.number().optional(),
      heartRateZones: z.array(z.object({
        name:        z.string().optional(),
        minutes:     z.number().optional(),
        caloriesOut: z.number().optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
  })
);

// ── Daily VO2 Max ─────────────────────────────────────────────────────────────

export const GHVo2MaxResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    dailyVo2Max: z.object({
      date:   z.string().optional(),
      vo2Max: z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Intraday Heart Rate ───────────────────────────────────────────────────────

export const GHHeartRateIntradayResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    heartRate: z.object({
      time:            z.string().optional(),
      beatsPerMinute:  z.number().optional(),
    }).passthrough().optional(),
  })
);

// ── Respiratory Rate Sleep Summary (breathing rate) ──────────────────────────

export const GHBreathingRateResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    respiratoryRateSleepSummary: z.object({
      date:                 z.string().optional(),
      breathingRate:        z.number().optional(),
      averageBreathingRate: z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Daily Sleep Temperature Derivations ──────────────────────────────────────

export const GHSleepTempResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    dailySleepTemperatureDerivations: z.object({
      date:            z.string().optional(),
      nightlyRelative: z.number().optional(),
      deviation:       z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
  })
);

// ── Body Weight ───────────────────────────────────────────────────────────────
// Assumed endpoint: body-weight:dailyRollUp — verify against API docs.

export const GHWeightResponseSchema = makeResponse(
  BaseDataPointSchema.extend({
    bodyWeight: z.object({
      date:    z.string().optional(),
      weight:  z.number().optional(),
      bmi:     z.number().optional(),
      bodyFat: z.number().optional(),
    }).passthrough().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
  })
);
