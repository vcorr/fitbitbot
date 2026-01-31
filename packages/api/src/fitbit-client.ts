/**
 * Fitbit API Client
 * Centralized client for all Fitbit API calls with automatic token refresh.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, "..", "..", "..", "output", ".token.json");
const TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const BASE_URL = "https://api.fitbit.com";
const REQUEST_TIMEOUT = 30000; // 30 seconds

export class FitbitAPIError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(`HTTP ${statusCode}: ${message}`);
    this.name = "FitbitAPIError";
  }
}

export class FitbitRateLimitError extends FitbitAPIError {
  constructor(message = "Rate limit exceeded. Try again later.") {
    super(429, message);
    this.name = "FitbitRateLimitError";
  }
}

interface TokenData {
  access_token: string;
  refresh_token: string;
}

export class FitbitClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private clientId: string | undefined;
  private clientSecret: string | undefined;

  constructor() {
    this.clientId = process.env.CLIENT_ID;
    this.clientSecret = process.env.CLIENT_SECRET;
    this.loadToken();
  }

  private loadToken(): void {
    // Try environment variable first (for Cloud Run)
    const tokenEnv = process.env.FITBIT_TOKEN;
    if (tokenEnv) {
      try {
        const tokenData = JSON.parse(tokenEnv) as TokenData;
        if (tokenData.access_token && tokenData.refresh_token) {
          this.accessToken = tokenData.access_token;
          this.refreshToken = tokenData.refresh_token;
          console.log("Loaded tokens from FITBIT_TOKEN environment variable");
          return;
        }
      } catch (e) {
        console.warn("Failed to parse FITBIT_TOKEN env var:", e);
      }
    }

    // Fall back to local file (for local development)
    if (existsSync(TOKEN_FILE)) {
      try {
        const tokenData = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as TokenData;
        this.accessToken = tokenData.access_token;
        this.refreshToken = tokenData.refresh_token;
        console.log("Loaded tokens from", TOKEN_FILE);
      } catch (e) {
        console.warn("Failed to parse token file:", e);
      }
    } else {
      console.log("Token file not found at", TOKEN_FILE, "- Run authentication first.");
    }
  }

  private async saveToken(tokenData: TokenData): Promise<void> {
    this.accessToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token;

    // Cloud deployment: persist to Secret Manager
    if (process.env.FITBIT_TOKEN) {
      await this.saveTokenToSecretManager(tokenData);
    } else {
      // Local development: save to file
      try {
        const dir = dirname(TOKEN_FILE);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
        console.log("Saved tokens to", TOKEN_FILE);
      } catch (e) {
        console.warn("Failed to save token file:", e);
      }
    }
  }

  private async saveTokenToSecretManager(tokenData: TokenData): Promise<void> {
    try {
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      if (!projectId) {
        console.warn("Could not determine project ID for Secret Manager");
        return;
      }

      const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
      const client = new SecretManagerServiceClient();
      const secretName = `projects/${projectId}/secrets/fitbit-token`;

      await client.addSecretVersion({
        parent: secretName,
        payload: { data: Buffer.from(JSON.stringify(tokenData)) },
      });
      console.log("Persisted refreshed token to Secret Manager");
    } catch (e) {
      console.warn("Failed to persist token to Secret Manager:", e);
    }
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      console.warn("Cannot refresh token: missing refresh_token, client_id, or client_secret");
      return false;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (response.ok) {
        const tokenData = (await response.json()) as TokenData;
        await this.saveToken(tokenData);
        console.log("Successfully refreshed access token");
        return true;
      } else {
        console.error("Token refresh failed:", response.status, await response.text());
        return false;
      }
    } catch (e) {
      console.error("Token refresh request failed:", e);
      return false;
    }
  }

  private async request<T = Record<string, unknown>>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    if (!this.accessToken) {
      throw new FitbitAPIError(401, "No access token available. Run authentication first.");
    }

    const url = new URL(`${BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const makeRequest = async (): Promise<Response> => {
      return fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
    };

    let response: Response;
    try {
      response = await makeRequest();
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new FitbitAPIError(504, `Request timed out after ${REQUEST_TIMEOUT / 1000} seconds`);
      }
      throw new FitbitAPIError(503, `Request failed: ${e}`);
    }

    // Handle token expiration
    if (response.status === 401) {
      console.log("Access token expired, attempting refresh");
      if (await this.refreshAccessToken()) {
        try {
          response = await makeRequest();
        } catch (e) {
          if (e instanceof Error && e.name === "TimeoutError") {
            throw new FitbitAPIError(504, `Request timed out after ${REQUEST_TIMEOUT / 1000} seconds`);
          }
          throw new FitbitAPIError(503, `Request failed: ${e}`);
        }
      } else {
        throw new FitbitAPIError(401, "Token expired and refresh failed. Re-authenticate.");
      }
    }

    if (response.status === 429) {
      throw new FitbitRateLimitError("Fitbit API rate limit exceeded (150 requests/hour). Try again later.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new FitbitAPIError(response.status, text.slice(0, 200));
    }

    return response.json() as Promise<T>;
  }

  // =========================================================================
  // Sleep Endpoints
  // =========================================================================

  getSleepByDate(date: string) {
    return this.request(`/1.2/user/-/sleep/date/${date}.json`);
  }

  getSleepRange(startDate: string, endDate: string) {
    return this.request(`/1.2/user/-/sleep/date/${startDate}/${endDate}.json`);
  }

  getSleepList(beforeDate: string, limit = 7) {
    return this.request("/1.2/user/-/sleep/list.json", {
      beforeDate,
      sort: "desc",
      limit: String(limit),
      offset: "0",
    });
  }

  // =========================================================================
  // Activity Endpoints
  // =========================================================================

  getActivityByDate(date: string) {
    return this.request(`/1/user/-/activities/date/${date}.json`);
  }

  getActivityTimeSeries(resource: string, startDate: string, endDate: string) {
    return this.request(`/1/user/-/activities/${resource}/date/${startDate}/${endDate}.json`);
  }

  // =========================================================================
  // Exercise/Logged Activities
  // =========================================================================

  getActivityLogs(beforeDate: string, limit = 20) {
    return this.request("/1/user/-/activities/list.json", {
      beforeDate,
      sort: "desc",
      limit: String(limit),
      offset: "0",
    });
  }

  // =========================================================================
  // Heart Rate Endpoints
  // =========================================================================

  getHeartRateByDate(date: string, detailLevel = "1min") {
    return this.request(`/1/user/-/activities/heart/date/${date}/1d/${detailLevel}.json`);
  }

  getHeartRateRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/activities/heart/date/${startDate}/${endDate}.json`);
  }

  // =========================================================================
  // Recovery Endpoints (HRV, SpO2, Breathing, Temperature)
  // =========================================================================

  getHrvByDate(date: string) {
    return this.request(`/1/user/-/hrv/date/${date}.json`);
  }

  getHrvRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/hrv/date/${startDate}/${endDate}.json`);
  }

  getSpo2ByDate(date: string) {
    return this.request(`/1/user/-/spo2/date/${date}.json`);
  }

  getSpo2Range(startDate: string, endDate: string) {
    return this.request(`/1/user/-/spo2/date/${startDate}/${endDate}.json`);
  }

  getBreathingRateByDate(date: string) {
    return this.request(`/1/user/-/br/date/${date}.json`);
  }

  getBreathingRateRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/br/date/${startDate}/${endDate}.json`);
  }

  getTemperatureByDate(date: string) {
    return this.request(`/1/user/-/temp/skin/date/${date}.json`);
  }

  getTemperatureRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/temp/skin/date/${startDate}/${endDate}.json`);
  }

  getCardioFitnessByDate(date: string) {
    return this.request(`/1/user/-/cardioscore/date/${date}.json`);
  }

  getCardioFitnessRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/cardioscore/date/${startDate}/${endDate}.json`);
  }

  // =========================================================================
  // Active Zone Minutes
  // =========================================================================

  getActiveZoneMinutesByDate(date: string) {
    return this.request(`/1/user/-/activities/active-zone-minutes/date/${date}/1d.json`);
  }

  getActiveZoneMinutesRange(startDate: string, endDate: string) {
    return this.request(`/1/user/-/activities/active-zone-minutes/date/${startDate}/${endDate}.json`);
  }
}

// Singleton instance
let client: FitbitClient | null = null;

export function getFitbitClient(): FitbitClient {
  if (!client) {
    client = new FitbitClient();
  }
  return client;
}
