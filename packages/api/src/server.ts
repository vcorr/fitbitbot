import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { getFitbitClient, FitbitAPIError, FitbitRateLimitError } from "./fitbit-client.js";

// Import routes
import { sleepRouter } from "./routes/sleep.js";
import { recoveryRouter } from "./routes/recovery.js";
import { activityRouter } from "./routes/activity.js";
import { heartRateRouter } from "./routes/heart-rate.js";
import { summaryRouter } from "./routes/summary.js";

const app = express();
app.use(express.json());

// API Key middleware
const API_KEY = process.env.API_KEY;
const PUBLIC_PATHS = ["/", "/health", "/docs"];

app.use((req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }

  // Skip auth if no API_KEY configured (local dev)
  if (!API_KEY) {
    return next();
  }

  const providedKey = req.headers["x-api-key"];
  if (!providedKey || providedKey !== API_KEY) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
    return;
  }

  next();
});

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fitbit-api" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fitbit-api" });
});

// Mount routes
app.use("/sleep", sleepRouter);
app.use("/recovery", recoveryRouter);
app.use("/activity", activityRouter);
app.use("/heart-rate", heartRateRouter);
app.use("/summary", summaryRouter);

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error:", err);

  if (err instanceof FitbitRateLimitError) {
    res.status(429).json({
      error: "rate_limit_exceeded",
      message: err.message,
      retry_after: "Wait until the top of the hour for quota reset (150 requests/hour limit).",
    });
    return;
  }

  if (err instanceof FitbitAPIError) {
    res.status(err.statusCode).json({
      error: "fitbit_api_error",
      message: err.message,
    });
    return;
  }

  res.status(500).json({
    error: "internal_error",
    message: err.message,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Fitbit API running on port ${PORT}`);
});

export { app, getFitbitClient };
