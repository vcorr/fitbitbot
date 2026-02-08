#!/usr/bin/env node

/**
 * Snapshot all API endpoints to local JSON fixtures.
 *
 * Usage:
 *   node scripts/snapshot-api.js
 *
 * Environment variables:
 *   FITBIT_API_URL  - API base URL (default: https://fitbit-api-594114799065.europe-north1.run.app)
 *   FITBIT_API_KEY  - API key for X-API-Key header (optional for local dev)
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

const BASE_URL =
  process.env.FITBIT_API_URL ||
  "https://fitbit-api-594114799065.europe-north1.run.app";

const API_KEY = process.env.FITBIT_API_KEY;

const ENDPOINTS = [
  // Agent endpoints
  { path: "/summary/morning-report", file: "summary-morning-report.json" },
  { path: "/summary/week", file: "summary-week.json" },
  { path: "/sleep/last-night", file: "sleep-last-night.json" },
  { path: "/recovery/today", file: "recovery-today.json" },
  // Grafana / history endpoints
  { path: "/summary/grafana-snapshot", file: "summary-grafana-snapshot.json" },
  { path: "/nightly-health-index?days=30", file: "nightly-health-index.json" },
  { path: "/sleep/history?days=30", file: "sleep-history.json" },
  { path: "/sleep/stages-history?days=30", file: "sleep-stages-history.json" },
  { path: "/recovery/history?days=30", file: "recovery-history.json" },
  { path: "/activity/history?days=14", file: "activity-history.json" },
  { path: "/activity/today", file: "activity-today.json" },
  { path: "/heart-rate/today", file: "heart-rate-today.json" },
  { path: "/heart-rate/resting/history?days=30", file: "heart-rate-resting-history.json" },
];

async function fetchEndpoint(path) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const timestamp = new Date().toISOString();
  console.log(`Snapshotting ${ENDPOINTS.length} endpoints from ${BASE_URL}`);
  console.log(`Timestamp: ${timestamp}\n`);

  let succeeded = 0;
  let failed = 0;

  for (const { path, file } of ENDPOINTS) {
    process.stdout.write(`  ${path} ... `);
    try {
      const data = await fetchEndpoint(path);
      const output = { _snapshot: { timestamp, endpoint: path }, ...data };
      writeFileSync(join(FIXTURES_DIR, file), JSON.stringify(output, null, 2) + "\n");
      console.log("ok");
      succeeded++;
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} saved, ${failed} failed → fixtures/`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
