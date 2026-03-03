import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// Stub the Firestore import so store.ts never tries to connect
vi.mock("@google-cloud/firestore", () => ({ Firestore: class {} }));

// We need to control MCP_AUTH_PASSWORD via env before importing auth
const TEST_PASSWORD = "test-secret-password";

function makeClient(overrides: Partial<OAuthClientInformationFull> = {}): OAuthClientInformationFull {
  return {
    client_id: crypto.randomUUID(),
    client_secret: crypto.randomBytes(32).toString("hex"),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: ["https://example.com/callback"],
    client_name: "Test App",
    ...overrides,
  } as OAuthClientInformationFull;
}

describe("OAuth Provider — auth.ts", () => {
  let oauthProvider: typeof import("../auth.js").oauthProvider;
  let approveAuthRequest: typeof import("../auth.js").approveAuthRequest;
  let tokenStore: typeof import("../store.js").tokenStore;

  beforeEach(async () => {
    vi.stubEnv("MCP_AUTH_PASSWORD", TEST_PASSWORD);
    // Fresh modules each test to reset in-memory maps
    vi.resetModules();
    const authMod = await import("../auth.js");
    const storeMod = await import("../store.js");
    oauthProvider = authMod.oauthProvider;
    approveAuthRequest = authMod.approveAuthRequest;
    tokenStore = storeMod.tokenStore;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- Client registration ---

  describe("clientsStore.registerClient", () => {
    it("generates UUID client_id and stores client", async () => {
      const registered = await oauthProvider.clientsStore.registerClient!({
        redirect_uris: ["https://example.com/callback"],
        client_name: "My App",
      } as OAuthClientInformationFull);

      expect(registered.client_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(registered.client_secret).toBeDefined();
      expect(registered.client_secret!.length).toBe(64); // 32 bytes hex
      expect(registered.client_name).toBe("My App");

      // Verify it was persisted in the store
      const fetched = await oauthProvider.clientsStore.getClient(registered.client_id);
      expect(fetched).toEqual(registered);
    });
  });

  // --- authorize + approveAuthRequest flow ---

  describe("authorize → approveAuthRequest flow", () => {
    function captureAuthorize(client: OAuthClientInformationFull, state?: string) {
      let sentHtml = "";
      const fakeRes = {
        type: () => fakeRes,
        send: (html: string) => {
          sentHtml = html;
        },
      };

      const params = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        state: state ?? "test-state",
      };

      return oauthProvider
        .authorize(client, params as Parameters<typeof oauthProvider.authorize>[1], fakeRes as any)
        .then(() => {
          // Extract request_id from the hidden input in the HTML
          const match = sentHtml.match(/name="request_id" value="([^"]+)"/);
          return { html: sentHtml, requestId: match?.[1] ?? "" };
        });
    }

    it("valid password → returns redirect URL with code + state", async () => {
      const client = makeClient();
      const { requestId } = await captureAuthorize(client, "my-state");
      expect(requestId).toBeTruthy();

      const result = approveAuthRequest(requestId, TEST_PASSWORD);
      expect("redirectUrl" in result).toBe(true);
      if ("redirectUrl" in result) {
        const url = new URL(result.redirectUrl);
        expect(url.searchParams.get("code")).toBeTruthy();
        expect(url.searchParams.get("state")).toBe("my-state");
        expect(url.origin).toBe("https://example.com");
      }
    });

    it("wrong password → returns error and allows retry", async () => {
      const client = makeClient();
      const { requestId } = await captureAuthorize(client);

      const result = approveAuthRequest(requestId, "wrong-password");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("Invalid password");
      }

      // Should still be able to retry with the correct password
      const result2 = approveAuthRequest(requestId, TEST_PASSWORD);
      expect("redirectUrl" in result2).toBe(true);
    });

    it("5 failed attempts → deletes request, returns too-many error", async () => {
      const client = makeClient();
      const { requestId } = await captureAuthorize(client);

      for (let i = 0; i < 4; i++) {
        const r = approveAuthRequest(requestId, "wrong");
        expect("error" in r).toBe(true);
      }

      // 5th attempt triggers lockout
      const final = approveAuthRequest(requestId, "wrong");
      expect("error" in final).toBe(true);
      if ("error" in final) {
        expect(final.error).toContain("Too many failed attempts");
      }

      // Request should now be deleted — even correct password fails
      const afterLockout = approveAuthRequest(requestId, TEST_PASSWORD);
      expect("error" in afterLockout).toBe(true);
      if ("error" in afterLockout) {
        expect(afterLockout.error).toContain("Invalid or expired");
      }
    });

    it("invalid request_id → returns error", () => {
      const result = approveAuthRequest("00000000-0000-0000-0000-000000000000", TEST_PASSWORD);
      expect("error" in result).toBe(true);
    });

    it("MCP_AUTH_PASSWORD not set → returns config error", async () => {
      vi.stubEnv("MCP_AUTH_PASSWORD", "");
      vi.resetModules();
      const { oauthProvider: freshProvider, approveAuthRequest: freshApprove } = await import("../auth.js");

      const client = makeClient();
      let requestId = "";
      const fakeRes = {
        type: () => fakeRes,
        send: (html: string) => {
          const m = html.match(/name="request_id" value="([^"]+)"/);
          requestId = m?.[1] ?? "";
        },
      };
      await freshProvider.authorize(
        client,
        { redirectUri: "https://example.com/callback", codeChallenge: "c", state: "s" } as any,
        fakeRes as any,
      );

      const result = freshApprove(requestId, "anything");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("not configured");
      }
    });
  });

  // --- exchangeAuthorizationCode ---

  describe("exchangeAuthorizationCode", () => {
    async function getValidCode(client: OAuthClientInformationFull) {
      let requestId = "";
      const fakeRes = {
        type: () => fakeRes,
        send: (html: string) => {
          const m = html.match(/name="request_id" value="([^"]+)"/);
          requestId = m?.[1] ?? "";
        },
      };
      await oauthProvider.authorize(
        client,
        { redirectUri: "https://example.com/callback", codeChallenge: "test-challenge", state: "s" } as any,
        fakeRes as any,
      );
      const result = approveAuthRequest(requestId, TEST_PASSWORD);
      if (!("redirectUrl" in result)) throw new Error("Expected redirect");
      const url = new URL(result.redirectUrl);
      return url.searchParams.get("code")!;
    }

    it("valid code → returns access + refresh tokens, deletes code", async () => {
      const client = makeClient();
      const code = await getValidCode(client);

      const tokens = await oauthProvider.exchangeAuthorizationCode(
        client,
        code,
        undefined,
        "https://example.com/callback",
      );

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.expires_in).toBe(3600);

      // Code should be consumed — second use fails
      await expect(
        oauthProvider.exchangeAuthorizationCode(client, code, undefined, "https://example.com/callback"),
      ).rejects.toThrow("Invalid authorization code");
    });

    it("client mismatch → throws error", async () => {
      const client = makeClient();
      const code = await getValidCode(client);

      const otherClient = makeClient();
      await expect(
        oauthProvider.exchangeAuthorizationCode(otherClient, code, undefined, "https://example.com/callback"),
      ).rejects.toThrow("Client mismatch");
    });

    it("redirect URI mismatch → throws error", async () => {
      const client = makeClient();
      const code = await getValidCode(client);

      await expect(
        oauthProvider.exchangeAuthorizationCode(client, code, undefined, "https://evil.com/callback"),
      ).rejects.toThrow("Redirect URI mismatch");
    });

    it("unknown code → throws error", async () => {
      const client = makeClient();
      await expect(
        oauthProvider.exchangeAuthorizationCode(client, "nonexistent-code"),
      ).rejects.toThrow("Invalid authorization code");
    });
  });

  // --- exchangeRefreshToken ---

  describe("exchangeRefreshToken", () => {
    async function getTokens(client: OAuthClientInformationFull) {
      let requestId = "";
      const fakeRes = {
        type: () => fakeRes,
        send: (html: string) => {
          const m = html.match(/name="request_id" value="([^"]+)"/);
          requestId = m?.[1] ?? "";
        },
      };
      await oauthProvider.authorize(
        client,
        { redirectUri: "https://example.com/callback", codeChallenge: "c", state: "s" } as any,
        fakeRes as any,
      );
      const result = approveAuthRequest(requestId, TEST_PASSWORD);
      if (!("redirectUrl" in result)) throw new Error("Expected redirect");
      const code = new URL(result.redirectUrl).searchParams.get("code")!;
      return oauthProvider.exchangeAuthorizationCode(client, code, undefined, "https://example.com/callback");
    }

    it("valid refresh token → returns new tokens, old refresh deleted", async () => {
      const client = makeClient();
      const tokens = await getTokens(client);

      const newTokens = await oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!);

      expect(newTokens.access_token).toBeTruthy();
      expect(newTokens.refresh_token).toBeTruthy();
      expect(newTokens.access_token).not.toBe(tokens.access_token);
      expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);

      // Old refresh token should be gone
      await expect(
        oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!),
      ).rejects.toThrow("Invalid refresh token");
    });

    it("client mismatch → throws error", async () => {
      const client = makeClient();
      const tokens = await getTokens(client);

      const otherClient = makeClient();
      await expect(
        oauthProvider.exchangeRefreshToken(otherClient, tokens.refresh_token!),
      ).rejects.toThrow("Client mismatch");
    });

    it("invalid refresh token → throws error", async () => {
      const client = makeClient();
      await expect(
        oauthProvider.exchangeRefreshToken(client, "nonexistent-token"),
      ).rejects.toThrow("Invalid refresh token");
    });
  });

  // --- verifyAccessToken ---

  describe("verifyAccessToken", () => {
    async function issueAccessToken(client: OAuthClientInformationFull) {
      let requestId = "";
      const fakeRes = {
        type: () => fakeRes,
        send: (html: string) => {
          const m = html.match(/name="request_id" value="([^"]+)"/);
          requestId = m?.[1] ?? "";
        },
      };
      await oauthProvider.authorize(
        client,
        { redirectUri: "https://example.com/callback", codeChallenge: "c", state: "s" } as any,
        fakeRes as any,
      );
      const result = approveAuthRequest(requestId, TEST_PASSWORD);
      if (!("redirectUrl" in result)) throw new Error("Expected redirect");
      const code = new URL(result.redirectUrl).searchParams.get("code")!;
      return oauthProvider.exchangeAuthorizationCode(client, code, undefined, "https://example.com/callback");
    }

    it("valid token → returns AuthInfo", async () => {
      const client = makeClient();
      const tokens = await issueAccessToken(client);

      const authInfo = await oauthProvider.verifyAccessToken(tokens.access_token);
      expect(authInfo.token).toBe(tokens.access_token);
      expect(authInfo.clientId).toBe(client.client_id);
      expect(authInfo.scopes).toEqual(["read"]);
      expect(authInfo.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("expired token → throws error", async () => {
      const client = makeClient();
      const tokens = await issueAccessToken(client);

      // Manually expire the token in the store.
      // Note: the store evicts expired tokens on get(), so verifyAccessToken
      // receives undefined and throws "Invalid access token" (same end result).
      await tokenStore.setAccessToken(tokens.access_token, {
        clientId: client.client_id,
        scopes: ["read"],
        expiresAt: Math.floor(Date.now() / 1000) - 10,
      });

      await expect(oauthProvider.verifyAccessToken(tokens.access_token)).rejects.toThrow(
        "Invalid access token",
      );
    });

    it("unknown token → throws error", async () => {
      await expect(oauthProvider.verifyAccessToken("nonexistent")).rejects.toThrow(
        "Invalid access token",
      );
    });
  });
});
