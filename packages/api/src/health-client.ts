/**
 * Feature-flag-aware health data client factory.
 *
 * Routes import getHealthClient() from here instead of getFitbitClient() from
 * fitbit-client.ts.  Setting USE_GOOGLE_HEALTH_API=true in the environment
 * switches to the Google Health API v4 client without changing any route logic.
 *
 * Both clients implement identical method signatures and return the same
 * internal data shapes, so route files are completely unaffected by the switch.
 */
import { FitbitClient, getFitbitClient } from "./fitbit-client.js";
import { GoogleHealthClient, getGoogleHealthClient } from "./google-health-client.js";

export type HealthDataClient = FitbitClient | GoogleHealthClient;

export function getHealthClient(): HealthDataClient {
  if (process.env.USE_GOOGLE_HEALTH_API === "true") {
    return getGoogleHealthClient();
  }
  return getFitbitClient();
}

// Re-export error classes so routes only need one import location.
export { FitbitAPIError, FitbitRateLimitError } from "./fitbit-client.js";
export { GoogleHealthAPIError, GoogleHealthRateLimitError } from "./google-health-client.js";
