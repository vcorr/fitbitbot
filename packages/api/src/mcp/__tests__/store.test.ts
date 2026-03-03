import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub Firestore so store.ts uses in-memory only
vi.mock("@google-cloud/firestore", () => ({ Firestore: class {} }));

describe("tokenStore — in-memory layer", () => {
  let tokenStore: typeof import("../store.js").tokenStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../store.js");
    tokenStore = mod.tokenStore;
  });

  // --- Clients ---

  describe("clients", () => {
    it("set and get a client", async () => {
      const client = { client_id: "c1", client_name: "App" } as any;
      await tokenStore.setClient("c1", client);
      expect(await tokenStore.getClient("c1")).toEqual(client);
    });

    it("missing client returns undefined", async () => {
      expect(await tokenStore.getClient("nonexistent")).toBeUndefined();
    });
  });

  // --- Access Tokens ---

  describe("access tokens", () => {
    it("set, get, and delete", async () => {
      const data = { clientId: "c1", scopes: ["read"], expiresAt: Math.floor(Date.now() / 1000) + 3600 };
      await tokenStore.setAccessToken("at1", data);
      expect(await tokenStore.getAccessToken("at1")).toEqual(data);

      await tokenStore.deleteAccessToken("at1");
      expect(await tokenStore.getAccessToken("at1")).toBeUndefined();
    });

    it("expired token is evicted on get", async () => {
      const data = { clientId: "c1", scopes: ["read"], expiresAt: Math.floor(Date.now() / 1000) - 10 };
      await tokenStore.setAccessToken("at-expired", data);
      expect(await tokenStore.getAccessToken("at-expired")).toBeUndefined();
    });

    it("missing token returns undefined", async () => {
      expect(await tokenStore.getAccessToken("nope")).toBeUndefined();
    });
  });

  // --- Refresh Tokens ---

  describe("refresh tokens", () => {
    it("set, get, and delete", async () => {
      const data = { clientId: "c1", scopes: ["read"], expiresAt: Math.floor(Date.now() / 1000) + 86400 };
      await tokenStore.setRefreshToken("rt1", data);
      expect(await tokenStore.getRefreshToken("rt1")).toEqual(data);

      await tokenStore.deleteRefreshToken("rt1");
      expect(await tokenStore.getRefreshToken("rt1")).toBeUndefined();
    });

    it("expired refresh token is evicted on get", async () => {
      const data = { clientId: "c1", scopes: ["read"], expiresAt: Math.floor(Date.now() / 1000) - 10 };
      await tokenStore.setRefreshToken("rt-expired", data);
      expect(await tokenStore.getRefreshToken("rt-expired")).toBeUndefined();
    });

    it("missing refresh token returns undefined", async () => {
      expect(await tokenStore.getRefreshToken("nope")).toBeUndefined();
    });
  });
});
