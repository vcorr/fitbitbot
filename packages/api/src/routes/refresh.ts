import { Router, Request, Response } from "express";
import { getFitbitClient } from "../fitbit-client.js";

export const refreshRouter = Router();

/**
 * POST /refresh-token
 * Manually triggers a Fitbit access token refresh
 * Intended to be called by Cloud Scheduler to keep tokens fresh before expiration
 */
refreshRouter.post("/", async (_req: Request, res: Response) => {
  const client = getFitbitClient();

  try {
    const success = await client.refreshAccessToken();

    if (success) {
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
    console.error("[Token Refresh] Error during token refresh:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during token refresh",
    });
  }
});
