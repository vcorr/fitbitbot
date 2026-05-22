/**
 * Google Health API v4 Client
 *
 * Drop-in replacement for FitbitClient — every public method returns the same
 * internal data shape so route handlers need no changes when the feature flag
 * USE_GOOGLE_HEALTH_API=true is set.
 *
 * Assumptions about the Google Health API v4 (GA end of May 2026):
 *  - Base URL:       https://health.googleapis.com
 *  - Endpoint path:  /v4/users/-/dataTypes/{type}:{method}
 *  - Daily filters:  start_date=YYYY-MM-DD  end_date=YYYY-MM-DD
 *  - Pagination:     page_size + page_token / nextPageToken
 *  - Prefer :reconcile for dashboard metrics (merges device + manual sources)
 *  - Exercise duration is in seconds (converted to ms to match Fitbit shape)
 *  - Refresh tokens are long-lived and NOT rotated on use (unlike Fitbit)
 *
 * Verify scope URIs and exact field names against
 * https://developers.google.com/health/data-types once the API is testable.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { type ZodType } from "zod";
import { FitbitAPIError, FitbitRateLimitError } from "./fitbit-client.js";
import {
  GHAzmResponseSchema,
  GHBreathingRateResponseSchema,
  GHDailyHrvResponseSchema,
  GHExerciseResponseSchema,
  GHHeartRateIntradayResponseSchema,
  GHRestingHrResponseSchema,
  GHSleepResponseSchema,
  GHSleepTempResponseSchema,
  GHSpO2ResponseSchema,
  GHStepsResponseSchema,
  GHVo2MaxResponseSchema,
  GHWeightResponseSchema,
} from "./google-health-schemas.js";
import {
  type ActivityLogsResponseSchema,
  type ActivityResponseSchema,
  type AzmResponseSchema,
  type BreathingRateResponseSchema,
  type CardioFitnessResponseSchema,
  type HeartRateResponseSchema,
  type HrvResponseSchema,
  type SleepResponseSchema,
  type Spo2DayResponseSchema,
  type Spo2RangeResponseSchema,
  type StepsTimeSeriesSchema,
  type TemperatureResponseSchema,
  type WeightResponseSchema,
} from "./fitbit-schemas.js";
import { type z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, "..", "..", "..", "output", ".google-token.json");

const BASE_URL = "https://health.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT = 30000;

// Google refresh tokens are long-lived and not rotated — only update access_token;
// include refresh_token in the saved object if present in the refresh response.
interface TokenData {
  access_token: string;
  refresh_token: string;
}

// Google Health API v4 scopes — verify exact URIs at
// https://developers.google.com/health/setup
export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/health.activity_and_fitness",
  "https://www.googleapis.com/auth/health.health_metrics_and_measurements",
  "https://www.googleapis.com/auth/health.sleep",
];

// Extend Fitbit error classes so existing instanceof checks in route files
// continue to work transparently after the client switch.
export class GoogleHealthAPIError extends FitbitAPIError {
  constructor(statusCode: number, message: string) {
    super(statusCode, message);
    this.name = "GoogleHealthAPIError";
  }
}

export class GoogleHealthRateLimitError extends FitbitRateLimitError {
  constructor(message = "Google Health API rate limit exceeded. Try again later.") {
    super(message);
    this.name = "GoogleHealthRateLimitError";
  }
}

export class GoogleHealthClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private refreshPromise: Promise<boolean> | null = null;
  private cachedProjectId: string | null = null;

  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.loadToken();
  }

  private loadToken(): void {
    const tokenEnv = process.env.GOOGLE_HEALTH_TOKEN;
    if (tokenEnv) {
      try {
        const tokenData = JSON.parse(tokenEnv) as TokenData;
        if (tokenData.access_token && tokenData.refresh_token) {
          this.accessToken = tokenData.access_token;
          this.refreshToken = tokenData.refresh_token;
          console.log("Loaded Google Health tokens from GOOGLE_HEALTH_TOKEN env var");
          return;
        }
      } catch (e) {
        console.warn("Failed to parse GOOGLE_HEALTH_TOKEN env var:", e);
      }
    }

    if (existsSync(TOKEN_FILE)) {
      try {
        const tokenData = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as TokenData;
        this.accessToken = tokenData.access_token;
        this.refreshToken = tokenData.refresh_token;
        console.log("Loaded Google Health tokens from", TOKEN_FILE);
      } catch (e) {
        console.warn("Failed to parse Google token file:", e);
      }
    } else {
      console.log("Google token file not found at", TOKEN_FILE, "- Run refresh-google-auth.js first.");
    }
  }

  private async saveToken(tokenData: TokenData): Promise<void> {
    this.accessToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token;

    if (process.env.GOOGLE_HEALTH_TOKEN) {
      await this.saveTokenToSecretManager(tokenData);
    } else {
      try {
        const dir = dirname(TOKEN_FILE);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
        console.log("Saved Google Health tokens to", TOKEN_FILE);
      } catch (e) {
        console.warn("Failed to save Google token file:", e);
      }
    }
  }

  private async getProjectId(): Promise<string | null> {
    if (this.cachedProjectId) return this.cachedProjectId;
    const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
    if (envProjectId) {
      this.cachedProjectId = envProjectId;
      return envProjectId;
    }
    try {
      const response = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/project/project-id",
        { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(2000) }
      );
      if (response.ok) {
        this.cachedProjectId = await response.text();
        return this.cachedProjectId;
      }
    } catch {
      // Not running on GCP
    }
    return null;
  }

  private async saveTokenToSecretManager(tokenData: TokenData): Promise<void> {
    const projectId = await this.getProjectId();
    if (!projectId) {
      throw new Error(
        "CRITICAL: Cannot determine GCP project ID. " +
          "Set GOOGLE_CLOUD_PROJECT env var or run on GCP."
      );
    }
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    const secretName = `projects/${projectId}/secrets/google-health-token`;
    await client.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(JSON.stringify(tokenData)) },
    });
    console.log("Persisted refreshed Google Health token to Secret Manager");
  }

  public async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      console.warn("Cannot refresh Google token: missing refresh_token, client_id, or client_secret");
      return false;
    }
    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (response.ok) {
        const fresh = (await response.json()) as Partial<TokenData>;
        const tokenData: TokenData = {
          access_token: fresh.access_token ?? this.accessToken!,
          // Google may omit refresh_token in the response if it hasn't changed
          refresh_token: fresh.refresh_token ?? this.refreshToken,
        };
        await this.saveToken(tokenData);
        console.log("Successfully refreshed Google Health access token");
        return true;
      } else {
        console.error("Google token refresh failed:", response.status, await response.text());
        return false;
      }
    } catch (e) {
      console.error("Google token refresh request failed:", e);
      return false;
    }
  }

  private async request<T = Record<string, unknown>>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    if (!this.accessToken) {
      throw new GoogleHealthAPIError(401, "No Google Health access token. Run refresh-google-auth.js first.");
    }

    const url = new URL(`${BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const makeRequest = async (): Promise<Response> =>
      fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

    let response: Response;
    try {
      response = await makeRequest();
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new GoogleHealthAPIError(504, `Request timed out after ${REQUEST_TIMEOUT / 1000}s`);
      }
      throw new GoogleHealthAPIError(503, `Request failed: ${e}`);
    }

    if (response.status === 401) {
      console.log("Google access token expired, attempting refresh");
      if (await this.refreshAccessToken()) {
        try {
          response = await makeRequest();
        } catch (e) {
          if (e instanceof Error && e.name === "TimeoutError") {
            throw new GoogleHealthAPIError(504, `Request timed out after ${REQUEST_TIMEOUT / 1000}s`);
          }
          throw new GoogleHealthAPIError(503, `Request failed: ${e}`);
        }
      } else {
        throw new GoogleHealthAPIError(401, "Token expired and refresh failed. Re-authenticate via refresh-google-auth.js.");
      }
    }

    if (response.status === 429) {
      throw new GoogleHealthRateLimitError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new GoogleHealthAPIError(response.status, text.slice(0, 200));
    }

    return response.json() as Promise<T>;
  }

  private async requestValidated<T>(
    schema: ZodType<T>,
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    const raw = await this.request(endpoint, params);
    return schema.parse(raw);
  }

  // Helper: build the path for a data-type endpoint
  private dt(type: string, method: string): string {
    return `/v4/users/-/dataTypes/${type}:${method}`;
  }

  // =========================================================================
  // Sleep Endpoints
  // =========================================================================

  async getSleepByDate(date: string): Promise<z.infer<typeof SleepResponseSchema>> {
    const raw = await this.requestValidated(GHSleepResponseSchema, this.dt("sleep", "reconcile"), {
      start_date: date,
      end_date: date,
    });
    return {
      sleep: (raw.dataPoints ?? []).map((dp) => ({
        dateOfSleep: dp.date ?? date,
        startTime: dp.sleep?.startTime,
        endTime: dp.sleep?.endTime,
        duration: dp.sleep?.minutesAsleep != null ? dp.sleep.minutesAsleep * 60 * 1000 : undefined,
        efficiency: dp.sleep?.efficiency,
        minutesAsleep: dp.sleep?.minutesAsleep,
        minutesAwake: dp.sleep?.minutesAwake,
        timeInBed: dp.sleep?.timeInBed,
        isMainSleep: dp.isMainSleep ?? true,
        levels: dp.sleep?.stages ? {
          summary: {
            deep:  { minutes: dp.sleep.stages.deep?.minutes ?? 0 },
            light: { minutes: dp.sleep.stages.light?.minutes ?? 0 },
            rem:   { minutes: dp.sleep.stages.rem?.minutes ?? 0 },
            wake:  { minutes: dp.sleep.stages.wake?.minutes ?? 0 },
          },
        } : undefined,
      })),
    };
  }

  async getSleepRange(startDate: string, endDate: string): Promise<z.infer<typeof SleepResponseSchema>> {
    const raw = await this.requestValidated(GHSleepResponseSchema, this.dt("sleep", "reconcile"), {
      start_date: startDate,
      end_date: endDate,
    });
    return {
      sleep: (raw.dataPoints ?? []).map((dp) => ({
        dateOfSleep: dp.date ?? startDate,
        startTime: dp.sleep?.startTime,
        endTime: dp.sleep?.endTime,
        duration: dp.sleep?.minutesAsleep != null ? dp.sleep.minutesAsleep * 60 * 1000 : undefined,
        efficiency: dp.sleep?.efficiency,
        minutesAsleep: dp.sleep?.minutesAsleep,
        minutesAwake: dp.sleep?.minutesAwake,
        timeInBed: dp.sleep?.timeInBed,
        isMainSleep: dp.isMainSleep ?? true,
        levels: dp.sleep?.stages ? {
          summary: {
            deep:  { minutes: dp.sleep.stages.deep?.minutes ?? 0 },
            light: { minutes: dp.sleep.stages.light?.minutes ?? 0 },
            rem:   { minutes: dp.sleep.stages.rem?.minutes ?? 0 },
            wake:  { minutes: dp.sleep.stages.wake?.minutes ?? 0 },
          },
        } : undefined,
      })),
    };
  }

  async getSleepList(beforeDate: string, limit = 7): Promise<z.infer<typeof SleepResponseSchema>> {
    const raw = await this.requestValidated(GHSleepResponseSchema, this.dt("sleep", "list"), {
      end_date: beforeDate,
      page_size: String(limit),
      sort: "desc",
    });
    return {
      sleep: (raw.dataPoints ?? []).map((dp) => ({
        dateOfSleep: dp.date ?? beforeDate,
        startTime: dp.sleep?.startTime,
        endTime: dp.sleep?.endTime,
        efficiency: dp.sleep?.efficiency,
        minutesAsleep: dp.sleep?.minutesAsleep,
        minutesAwake: dp.sleep?.minutesAwake,
        timeInBed: dp.sleep?.timeInBed,
        isMainSleep: dp.isMainSleep ?? true,
        levels: dp.sleep?.stages ? {
          summary: {
            deep:  { minutes: dp.sleep.stages.deep?.minutes ?? 0 },
            light: { minutes: dp.sleep.stages.light?.minutes ?? 0 },
            rem:   { minutes: dp.sleep.stages.rem?.minutes ?? 0 },
            wake:  { minutes: dp.sleep.stages.wake?.minutes ?? 0 },
          },
        } : undefined,
      })),
    };
  }

  // =========================================================================
  // Activity Endpoints
  // =========================================================================

  async getActivityByDate(date: string): Promise<z.infer<typeof ActivityResponseSchema>> {
    // No single "daily summary" endpoint in Google Health API; combine steps + AZM.
    const [stepsRaw, azmRaw] = await Promise.allSettled([
      this.requestValidated(GHStepsResponseSchema, this.dt("steps", "dailyRollUp"), {
        start_date: date,
        end_date: date,
      }),
      this.requestValidated(GHAzmResponseSchema, this.dt("active-zone-minutes", "dailyRollUp"), {
        start_date: date,
        end_date: date,
      }),
    ]);

    const steps = stepsRaw.status === "fulfilled"
      ? (stepsRaw.value.dataPoints?.[0]?.steps?.value ?? null)
      : null;

    const azm = azmRaw.status === "fulfilled"
      ? azmRaw.value.dataPoints?.[0]?.activeZoneMinutes
      : null;

    return {
      summary: {
        steps: steps ?? undefined,
        caloriesOut: undefined,       // not in a single Google Health endpoint
        floors: undefined,            // no equivalent in Google Health API v4
        sedentaryMinutes: undefined,  // sedentary-period:list returns intervals, not a total
        lightlyActiveMinutes: azm?.fatBurnActiveZoneMinutes,
        fairlyActiveMinutes: azm?.cardioActiveZoneMinutes,
        veryActiveMinutes: azm?.peakActiveZoneMinutes,
      },
    };
  }

  async getActivityTimeSeries(
    resource: string,
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof StepsTimeSeriesSchema>> {
    // Only "steps" is supported via dailyRollUp; other resources fall back to empty.
    if (resource !== "steps") {
      return { "activities-steps": [] };
    }
    const raw = await this.requestValidated(GHStepsResponseSchema, this.dt("steps", "dailyRollUp"), {
      start_date: startDate,
      end_date: endDate,
    });
    return {
      "activities-steps": (raw.dataPoints ?? [])
        .filter((dp) => dp.date)
        .map((dp) => ({
          dateTime: dp.date!,
          value: String(dp.steps?.value ?? 0),
        })),
    };
  }

  // =========================================================================
  // Exercise / Logged Activities
  // =========================================================================

  async getActivityLogs(
    beforeDate: string,
    limit = 20
  ): Promise<z.infer<typeof ActivityLogsResponseSchema>> {
    const raw = await this.requestValidated(
      GHExerciseResponseSchema,
      this.dt("exercise", "list"),
      {
        end_time: `${beforeDate}T23:59:59Z`,
        page_size: String(limit),
        sort: "desc",
      }
    );
    return {
      activities: (raw.dataPoints ?? [])
        .filter((dp) => dp.exercise)
        .map((dp) => {
          const ex = dp.exercise!;
          return {
            activityName: ex.activityName ?? ex.activityType ?? "Unknown",
            startTime: ex.startTime ?? "",
            originalStartTime: ex.startTime,
            // Google duration is in seconds; Fitbit shape expects milliseconds
            activeDuration: (ex.activeDurationSeconds ?? 0) * 1000,
            calories: ex.calories ?? 0,
            steps: ex.steps,
            distance: ex.distance,
            distanceUnit: ex.distanceUnit,
            averageHeartRate: ex.averageHeartRate,
            heartRateZones: ex.heartRateZones?.map((z) => ({
              name: z.name ?? "",
              minutes: z.minutes ?? 0,
              caloriesOut: z.caloriesOut,
            })),
          };
        }),
    };
  }

  // =========================================================================
  // Heart Rate Endpoints
  // =========================================================================

  async getHeartRateByDate(
    date: string,
    _detailLevel = "1min"
  ): Promise<z.infer<typeof HeartRateResponseSchema>> {
    const raw = await this.requestValidated(
      GHRestingHrResponseSchema,
      this.dt("daily-resting-heart-rate", "reconcile"),
      { start_date: date, end_date: date }
    );
    return {
      "activities-heart": (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyRestingHeartRate?.date ?? dp.date ?? date,
        value: {
          restingHeartRate: dp.dailyRestingHeartRate?.restingHeartRate,
          heartRateZones: [], // intraday zones not in daily-resting-heart-rate endpoint
        },
      })),
    };
  }

  async getHeartRateRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof HeartRateResponseSchema>> {
    const raw = await this.requestValidated(
      GHRestingHrResponseSchema,
      this.dt("daily-resting-heart-rate", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return {
      "activities-heart": (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyRestingHeartRate?.date ?? dp.date ?? startDate,
        value: {
          restingHeartRate: dp.dailyRestingHeartRate?.restingHeartRate,
          heartRateZones: [],
        },
      })),
    };
  }

  // =========================================================================
  // Recovery Endpoints (HRV, SpO2, Breathing, Temperature)
  // =========================================================================

  async getHrvByDate(date: string): Promise<z.infer<typeof HrvResponseSchema>> {
    const raw = await this.requestValidated(
      GHDailyHrvResponseSchema,
      this.dt("daily-heart-rate-variability", "reconcile"),
      { start_date: date, end_date: date }
    );
    return {
      hrv: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyHeartRateVariability?.date ?? dp.date ?? date,
        value: {
          dailyRmssd: dp.dailyHeartRateVariability?.dailyRmssd,
          deepRmssd: dp.dailyHeartRateVariability?.deepRmssd,
        },
      })),
    };
  }

  async getHrvRange(startDate: string, endDate: string): Promise<z.infer<typeof HrvResponseSchema>> {
    const raw = await this.requestValidated(
      GHDailyHrvResponseSchema,
      this.dt("daily-heart-rate-variability", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return {
      hrv: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyHeartRateVariability?.date ?? dp.date ?? startDate,
        value: {
          dailyRmssd: dp.dailyHeartRateVariability?.dailyRmssd,
          deepRmssd: dp.dailyHeartRateVariability?.deepRmssd,
        },
      })),
    };
  }

  async getSpo2ByDate(date: string): Promise<z.infer<typeof Spo2DayResponseSchema>> {
    const raw = await this.requestValidated(
      GHSpO2ResponseSchema,
      this.dt("daily-oxygen-saturation", "reconcile"),
      { start_date: date, end_date: date }
    );
    const dp = raw.dataPoints?.[0];
    return {
      dateTime: dp?.dailyOxygenSaturation?.date ?? dp?.date ?? date,
      value: dp?.dailyOxygenSaturation
        ? {
            avg: dp.dailyOxygenSaturation.avg,
            min: dp.dailyOxygenSaturation.min,
            max: dp.dailyOxygenSaturation.max,
          }
        : undefined,
    };
  }

  async getSpo2Range(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof Spo2RangeResponseSchema>> {
    const raw = await this.requestValidated(
      GHSpO2ResponseSchema,
      this.dt("daily-oxygen-saturation", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return (raw.dataPoints ?? []).map((dp) => ({
      dateTime: dp.dailyOxygenSaturation?.date ?? dp.date ?? startDate,
      value: dp.dailyOxygenSaturation
        ? {
            avg: dp.dailyOxygenSaturation.avg,
            min: dp.dailyOxygenSaturation.min,
            max: dp.dailyOxygenSaturation.max,
          }
        : undefined,
    }));
  }

  async getBreathingRateByDate(
    date: string
  ): Promise<z.infer<typeof BreathingRateResponseSchema>> {
    const raw = await this.requestValidated(
      GHBreathingRateResponseSchema,
      this.dt("respiratory-rate-sleep-summary", "reconcile"),
      { start_date: date, end_date: date }
    );
    return {
      br: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.respiratoryRateSleepSummary?.date ?? dp.date ?? date,
        value: {
          breathingRate:
            dp.respiratoryRateSleepSummary?.breathingRate ??
            dp.respiratoryRateSleepSummary?.averageBreathingRate,
        },
      })),
    };
  }

  async getBreathingRateRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof BreathingRateResponseSchema>> {
    const raw = await this.requestValidated(
      GHBreathingRateResponseSchema,
      this.dt("respiratory-rate-sleep-summary", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return {
      br: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.respiratoryRateSleepSummary?.date ?? dp.date ?? startDate,
        value: {
          breathingRate:
            dp.respiratoryRateSleepSummary?.breathingRate ??
            dp.respiratoryRateSleepSummary?.averageBreathingRate,
        },
      })),
    };
  }

  async getTemperatureByDate(
    date: string
  ): Promise<z.infer<typeof TemperatureResponseSchema>> {
    const raw = await this.requestValidated(
      GHSleepTempResponseSchema,
      this.dt("daily-sleep-temperature-derivations", "reconcile"),
      { start_date: date, end_date: date }
    );
    return {
      tempSkin: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailySleepTemperatureDerivations?.date ?? dp.date ?? date,
        value: {
          nightlyRelative:
            dp.dailySleepTemperatureDerivations?.nightlyRelative ??
            dp.dailySleepTemperatureDerivations?.deviation,
        },
      })),
    };
  }

  async getTemperatureRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof TemperatureResponseSchema>> {
    const raw = await this.requestValidated(
      GHSleepTempResponseSchema,
      this.dt("daily-sleep-temperature-derivations", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return {
      tempSkin: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailySleepTemperatureDerivations?.date ?? dp.date ?? startDate,
        value: {
          nightlyRelative:
            dp.dailySleepTemperatureDerivations?.nightlyRelative ??
            dp.dailySleepTemperatureDerivations?.deviation,
        },
      })),
    };
  }

  async getCardioFitnessByDate(
    date: string
  ): Promise<z.infer<typeof CardioFitnessResponseSchema>> {
    const raw = await this.requestValidated(
      GHVo2MaxResponseSchema,
      this.dt("daily-vo2-max", "reconcile"),
      { start_date: date, end_date: date }
    );
    return {
      cardioScore: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyVo2Max?.date ?? dp.date ?? date,
        value: {
          // Fitbit returned a range string like "42-46"; Google returns a single number.
          // Convert to string to match the existing Fitbit schema shape.
          vo2Max: dp.dailyVo2Max?.vo2Max != null ? String(dp.dailyVo2Max.vo2Max) : undefined,
        },
      })),
    };
  }

  async getCardioFitnessRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof CardioFitnessResponseSchema>> {
    const raw = await this.requestValidated(
      GHVo2MaxResponseSchema,
      this.dt("daily-vo2-max", "reconcile"),
      { start_date: startDate, end_date: endDate }
    );
    return {
      cardioScore: (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.dailyVo2Max?.date ?? dp.date ?? startDate,
        value: {
          vo2Max: dp.dailyVo2Max?.vo2Max != null ? String(dp.dailyVo2Max.vo2Max) : undefined,
        },
      })),
    };
  }

  // =========================================================================
  // Active Zone Minutes
  // =========================================================================

  async getActiveZoneMinutesByDate(
    date: string
  ): Promise<z.infer<typeof AzmResponseSchema>> {
    const raw = await this.requestValidated(GHAzmResponseSchema, this.dt("active-zone-minutes", "dailyRollUp"), {
      start_date: date,
      end_date: date,
    });
    return {
      "activities-active-zone-minutes": (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.date ?? date,
        value: {
          activeZoneMinutes:        dp.activeZoneMinutes?.activeZoneMinutes,
          fatBurnActiveZoneMinutes: dp.activeZoneMinutes?.fatBurnActiveZoneMinutes,
          cardioActiveZoneMinutes:  dp.activeZoneMinutes?.cardioActiveZoneMinutes,
          peakActiveZoneMinutes:    dp.activeZoneMinutes?.peakActiveZoneMinutes,
        },
      })),
    };
  }

  async getActiveZoneMinutesRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof AzmResponseSchema>> {
    const raw = await this.requestValidated(GHAzmResponseSchema, this.dt("active-zone-minutes", "dailyRollUp"), {
      start_date: startDate,
      end_date: endDate,
    });
    return {
      "activities-active-zone-minutes": (raw.dataPoints ?? []).map((dp) => ({
        dateTime: dp.date ?? startDate,
        value: {
          activeZoneMinutes:        dp.activeZoneMinutes?.activeZoneMinutes,
          fatBurnActiveZoneMinutes: dp.activeZoneMinutes?.fatBurnActiveZoneMinutes,
          cardioActiveZoneMinutes:  dp.activeZoneMinutes?.cardioActiveZoneMinutes,
          peakActiveZoneMinutes:    dp.activeZoneMinutes?.peakActiveZoneMinutes,
        },
      })),
    };
  }

  // =========================================================================
  // Body Weight & Composition
  // Assumed endpoint: body-weight:dailyRollUp — verify against API docs.
  // =========================================================================

  async getWeightByDate(date: string): Promise<z.infer<typeof WeightResponseSchema>> {
    const raw = await this.requestValidated(GHWeightResponseSchema, this.dt("body-weight", "dailyRollUp"), {
      start_date: date,
      end_date: date,
    });
    return {
      weight: (raw.dataPoints ?? [])
        .filter((dp) => dp.bodyWeight?.weight != null)
        .map((dp) => ({
          date: dp.bodyWeight?.date ?? dp.date ?? date,
          time: dp.time,
          weight: dp.bodyWeight!.weight!,
          bmi: dp.bodyWeight?.bmi,
          fat: dp.bodyWeight?.bodyFat,
        })),
    };
  }

  async getWeightRange(
    startDate: string,
    endDate: string
  ): Promise<z.infer<typeof WeightResponseSchema>> {
    const raw = await this.requestValidated(GHWeightResponseSchema, this.dt("body-weight", "dailyRollUp"), {
      start_date: startDate,
      end_date: endDate,
    });
    return {
      weight: (raw.dataPoints ?? [])
        .filter((dp) => dp.bodyWeight?.weight != null)
        .map((dp) => ({
          date: dp.bodyWeight?.date ?? dp.date ?? startDate,
          time: dp.time,
          weight: dp.bodyWeight!.weight!,
          bmi: dp.bodyWeight?.bmi,
          fat: dp.bodyWeight?.bodyFat,
        })),
    };
  }

  // =========================================================================
  // Intraday Heart Rate (not yet wired to a route — available for future use)
  // =========================================================================

  async getHeartRateIntraday(startTime: string, endTime: string) {
    return this.requestValidated(
      GHHeartRateIntradayResponseSchema,
      this.dt("heart-rate", "list"),
      { start_time: startTime, end_time: endTime }
    );
  }
}

let client: GoogleHealthClient | null = null;

export function getGoogleHealthClient(): GoogleHealthClient {
  if (!client) {
    client = new GoogleHealthClient();
  }
  return client;
}
