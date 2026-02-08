import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";

export const refreshRouter = Router();

// Rate limiting: Prevent excessive refresh requests
let lastRefreshTime = 0;
const MIN_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * POST /refresh-token
 * Manually triggers a Fitbit access token refresh
 * Intended to be called by Cloud Scheduler to keep tokens fresh before expiration
 *
 * @security Protected by X-API-Key middleware (configured in server.ts)
 * @see server.ts lines 17-38 for API key authentication
 */
refreshRouter.post("/", async (_req: Request, res: Response) => {
  console.log("[Token Refresh] Refresh endpoint called");

  // Rate limiting check
  const now = Date.now();
  if (now - lastRefreshTime < MIN_REFRESH_INTERVAL) {
    console.warn("[Token Refresh] Rate limit exceeded - token was recently refreshed");
    return res.status(429).json({
      success: false,
      error: "Token was recently refreshed. Please wait before retrying.",
    });
  }

  const client = getFitbitClient();

  try {
    const success = await client.refreshAccessToken();

    if (success) {
      lastRefreshTime = now;
      console.log("[Token Refresh] Successfully refreshed Fitbit access token via /refresh-token endpoint");
      res.json({
        success: true,
        message: "Token refreshed successfully",
      });
    } else {
      console.error("[Token Refresh] Failed to refresh token - check credentials");
      res.status(500).json({
        success: false,
        error: "Token refresh failed. Check server logs for details.",
      });
    }
  } catch (error) {
    // Log full error for debugging, but return generic message to client
    console.error("[Token Refresh] Error during token refresh:", error);
    res.status(500).json({
      success: false,
      error: "Token refresh failed. Check server logs for details.",
    });
  }
});
