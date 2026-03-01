import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const API_PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY;

async function callApi(path: string): Promise<unknown> {
  const url = `http://localhost:${API_PORT}${path}`;
  const headers: Record<string, string> = {};
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = (body as Record<string, string>).message || (body as Record<string, string>).error || `API error ${res.status}`;
    throw new Error(message);
  }

  return res.json();
}

function stripRawData(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const { raw_data, ...rest } = obj;
    return rest;
  }
  return data;
}

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(stripRawData(data), null, 2) }],
  };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "fitbit-mcp", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Fitbit health data MCP server. Provides read-only access to sleep, activity, heart rate, and recovery metrics. " +
        "Always fetch data before giving health advice. Compare metrics to the user's personal baseline, not population averages. " +
        "Low HRV after a hard workout is normal (expected recovery).",
    },
  );

  // --- Sleep tools ---

  server.registerTool(
    "get_last_night_sleep",
    {
      title: "Last Night's Sleep",
      description: "Get last night's sleep data including duration, efficiency, and sleep stage breakdown (deep, light, REM, wake).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/sleep/last-night");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_sleep_history",
    {
      title: "Sleep History",
      description: "Get sleep history over a period with duration and efficiency averages. Useful for identifying sleep trends.",
      inputSchema: z.object({
        days: z.number().min(1).max(90).describe("Number of days of history (1-90)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/sleep/history?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_sleep_stages_history",
    {
      title: "Sleep Stages History",
      description: "Get detailed sleep stages (deep, light, REM, wake minutes) per night. Good for analyzing sleep quality patterns.",
      inputSchema: z.object({
        days: z.number().min(1).max(30).describe("Number of days of history (1-30)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/sleep/stages-history?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Activity tools ---

  server.registerTool(
    "get_activity_today",
    {
      title: "Today's Activity",
      description: "Get today's activity data: steps, calories burned, floors, and active minutes breakdown.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/activity/today");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_activity_history",
    {
      title: "Activity History",
      description: "Get daily step counts over a period with average. Useful for tracking activity trends.",
      inputSchema: z.object({
        days: z.number().min(1).max(90).describe("Number of days of history (1-90)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/activity/history?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Heart rate tools ---

  server.registerTool(
    "get_heart_rate_today",
    {
      title: "Today's Heart Rate",
      description: "Get today's resting heart rate and heart rate zone breakdown (Out of Zone, Fat Burn, Cardio, Peak).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/heart-rate/today");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_resting_hr_history",
    {
      title: "Resting Heart Rate History",
      description: "Get resting heart rate trend over a period with min, max, and average statistics.",
      inputSchema: z.object({
        days: z.number().min(1).max(90).describe("Number of days of history (1-90)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/heart-rate/resting/history?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Recovery tools ---

  server.registerTool(
    "get_recovery_today",
    {
      title: "Today's Recovery Metrics",
      description:
        "Get today's recovery data: HRV (heart rate variability), SpO2 (blood oxygen), breathing rate, and skin temperature deviation. " +
        "Negative HRV vs baseline = needs rest. Low HRV after hard workout is normal.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/recovery/today");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_recovery_history",
    {
      title: "Recovery History",
      description: "Get HRV (heart rate variability) trend over a period with daily and deep sleep RMSSD values.",
      inputSchema: z.object({
        days: z.number().min(1).max(90).describe("Number of days of history (1-90)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/recovery/history?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Summary tools ---

  server.registerTool(
    "get_morning_report",
    {
      title: "Morning Report",
      description:
        "Comprehensive daily health snapshot: last night's sleep vs 7-day average, yesterday's activity with active zone minutes, " +
        "HRV with baseline comparison, resting heart rate, and weekly trends. Best tool for an overall health check.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/summary/morning-report");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_grafana_snapshot",
    {
      title: "Full Metrics Snapshot",
      description:
        "Flat snapshot of all key metrics in one response: sleep hours/efficiency/stages, HRV with baseline %, SpO2, breathing rate, " +
        "temperature deviation, and resting heart rate. Compact format good for dashboards or quick overviews.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await callApi("/summary/grafana-snapshot");
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Nightly Health Index ---

  server.registerTool(
    "get_nightly_health_index",
    {
      title: "Nightly Health Index",
      description:
        "Composite health score using z-score normalization across HRV, resting HR, sleep, SpO2, breathing rate, and temperature. " +
        "Positive composite = better than your average, negative = worse. Requires at least 3 metrics per night.",
      inputSchema: z.object({
        days: z.number().min(1).max(90).describe("Number of days of history (1-90)"),
      }),
    },
    async ({ days }) => {
      try {
        const data = await callApi(`/nightly-health-index?days=${days}`);
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
