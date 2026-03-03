import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// Stub Firestore before any MCP module loads
vi.mock("@google-cloud/firestore", () => ({ Firestore: class {} }));

// Set env vars before importing routes
vi.stubEnv("MCP_AUTH_PASSWORD", "test-password");
vi.stubEnv("MCP_SERVER_URL", "http://localhost:9999");

import { createMcpRoutes } from "../routes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createMcpRoutes());
  return app;
}

describe("MCP HTTP routes", () => {
  // --- POST /mcp-approve ---

  describe("POST /mcp-approve", () => {
    it("invalid body → 400", async () => {
      const app = buildApp();
      const res = await request(app)
        .post("/mcp-approve")
        .type("form")
        .send({ request_id: "not-a-uuid", password: "" });

      expect(res.status).toBe(400);
      expect(res.text).toContain("Missing or invalid fields");
    });

    it("unknown request_id → 403", async () => {
      const app = buildApp();
      const res = await request(app)
        .post("/mcp-approve")
        .type("form")
        .send({
          request_id: "00000000-0000-0000-0000-000000000000",
          password: "anything",
        });

      expect(res.status).toBe(403);
      expect(res.text).toContain("Invalid or expired");
    });
  });

  // --- POST /mcp ---

  describe("POST /mcp", () => {
    it("without Bearer token → 401", async () => {
      const app = buildApp();
      const res = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      expect(res.status).toBe(401);
    });

    it("with unknown session ID → 404", async () => {
      const app = buildApp();

      // We need a valid access token to get past bearer auth.
      // Import the modules to create one directly.
      const { tokenStore } = await import("../store.js");
      const token = "test-access-token-post";
      await tokenStore.setAccessToken(token, {
        clientId: "c1",
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", "nonexistent-session")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain("Session not found");
    });

    it("non-initialize request without session → 400", async () => {
      const app = buildApp();

      const { tokenStore } = await import("../store.js");
      const token = "test-access-token-noinit";
      await tokenStore.setAccessToken(token, {
        clientId: "c1",
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("not an initialization request");
    });
  });

  // --- GET /mcp ---

  describe("GET /mcp", () => {
    it("without session → 400", async () => {
      const app = buildApp();

      const { tokenStore } = await import("../store.js");
      const token = "test-access-token-get";
      await tokenStore.setAccessToken(token, {
        clientId: "c1",
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app)
        .get("/mcp")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Missing session ID");
    });

    it("unknown session → 404", async () => {
      const app = buildApp();

      const { tokenStore } = await import("../store.js");
      const token = "test-access-token-get2";
      await tokenStore.setAccessToken(token, {
        clientId: "c1",
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app)
        .get("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", "nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain("Session not found");
    });
  });

  // --- DELETE /mcp ---

  describe("DELETE /mcp", () => {
    it("unknown session → 200 (graceful)", async () => {
      const app = buildApp();

      const { tokenStore } = await import("../store.js");
      const token = "test-access-token-del";
      await tokenStore.setAccessToken(token, {
        clientId: "c1",
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app)
        .delete("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .set("mcp-session-id", "nonexistent");

      expect(res.status).toBe(200);
    });
  });

  // --- CORS ---

  describe("CORS", () => {
    it("allowed origin gets CORS headers", async () => {
      const app = buildApp();
      const res = await request(app)
        .options("/mcp")
        .set("Origin", "https://claude.ai")
        .set("Access-Control-Request-Method", "POST");

      expect(res.headers["access-control-allow-origin"]).toBe("https://claude.ai");
    });

    it("disallowed origin does not get CORS headers", async () => {
      const app = buildApp();
      const res = await request(app)
        .options("/mcp")
        .set("Origin", "https://evil.com")
        .set("Access-Control-Request-Method", "POST");

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("mistral.ai is allowed", async () => {
      const app = buildApp();
      const res = await request(app)
        .options("/mcp")
        .set("Origin", "https://chat.mistral.ai")
        .set("Access-Control-Request-Method", "POST");

      expect(res.headers["access-control-allow-origin"]).toBe("https://chat.mistral.ai");
    });
  });
});
