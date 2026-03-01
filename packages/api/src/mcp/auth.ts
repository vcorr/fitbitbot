import crypto from "node:crypto";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

// Express Response type — use `any` to avoid conflicts between @types/express v4 (API) and v5 (MCP SDK)
type ExpressResponse = { type(t: string): ExpressResponse; send(body: string): void };

const MCP_AUTH_PASSWORD = process.env.MCP_AUTH_PASSWORD;

// --- In-memory stores ---

const clients = new Map<string, OAuthClientInformationFull>();

const authCodes = new Map<string, {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number;
}>();

const accessTokens = new Map<string, {
  clientId: string;
  scopes: string[];
  expiresAt: number;
}>();

const refreshTokens = new Map<string, {
  clientId: string;
  scopes: string[];
  expiresAt: number;
}>();

interface PendingAuthRequest {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expiresAt: number;
}

const pendingAuthRequests = new Map<string, PendingAuthRequest>();

// --- Helpers ---

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function verifyPassword(input: string, expected: string): boolean {
  const inputBuf = Buffer.from(input.normalize("NFC"));
  const expectedBuf = Buffer.from(expected.normalize("NFC"));
  if (inputBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// --- Client store ---

const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId: string) {
    return clients.get(clientId);
  },

  async registerClient(clientData) {
    const clientId = crypto.randomUUID();
    const clientSecret = generateToken();
    const fullClient: OAuthClientInformationFull = {
      ...clientData,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    };
    clients.set(clientId, fullClient);
    console.log(`[MCP Auth] Registered client: ${clientId} (${fullClient.client_name || "unnamed"})`);
    return fullClient;
  },
};

// --- OAuth Provider ---

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: ExpressResponse) {
    const requestId = crypto.randomUUID();
    pendingAuthRequests.set(requestId, {
      client,
      params,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const clientName = escapeHtml(client.client_name || "Unknown app");
    res.type("html").send(`<!DOCTYPE html>
<html><head>
<title>Fitbit MCP - Authorize</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 20px; color: #333; }
  h2 { margin-bottom: 8px; }
  .info { color: #666; font-size: 14px; margin-bottom: 24px; }
  label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
  input[type="password"] { display: block; width: 100%; padding: 10px; margin-bottom: 16px; box-sizing: border-box;
    border: 1px solid #ccc; border-radius: 6px; font-size: 16px; }
  button { display: block; width: 100%; padding: 12px; background: #0066cc; color: white;
    border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
  button:hover { background: #0052a3; }
  .error { color: #cc0000; font-size: 14px; margin-bottom: 12px; }
</style>
</head><body>
<h2>Fitbit MCP</h2>
<p class="info"><strong>${clientName}</strong> wants read-only access to your Fitbit health data.</p>
<form method="POST" action="/mcp-approve">
  <input type="hidden" name="request_id" value="${requestId}">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autofocus>
  <button type="submit">Authorize</button>
</form>
</body></html>`);
  },

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string) {
    const codeData = authCodes.get(authorizationCode);
    if (!codeData) throw new Error("Unknown authorization code");
    return codeData.codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
  ): Promise<OAuthTokens> {
    const codeData = authCodes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    if (Date.now() > codeData.expiresAt) {
      authCodes.delete(authorizationCode);
      throw new Error("Authorization code expired");
    }
    if (codeData.clientId !== client.client_id) {
      throw new Error("Client mismatch");
    }

    authCodes.delete(authorizationCode);

    const accessToken = generateToken();
    const refreshToken = generateToken();
    const accessExpiresIn = 3600;
    const refreshExpiresIn = 7 * 24 * 3600;

    accessTokens.set(accessToken, {
      clientId: client.client_id,
      scopes: ["read"],
      expiresAt: Math.floor(Date.now() / 1000) + accessExpiresIn,
    });

    refreshTokens.set(refreshToken, {
      clientId: client.client_id,
      scopes: ["read"],
      expiresAt: Math.floor(Date.now() / 1000) + refreshExpiresIn,
    });

    console.log(`[MCP Auth] Issued tokens for client ${client.client_id}`);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessExpiresIn,
      refresh_token: refreshToken,
    };
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
  ): Promise<OAuthTokens> {
    const tokenData = refreshTokens.get(refreshToken);
    if (!tokenData) throw new Error("Invalid refresh token");
    if (Date.now() / 1000 > tokenData.expiresAt) {
      refreshTokens.delete(refreshToken);
      throw new Error("Refresh token expired");
    }
    if (tokenData.clientId !== client.client_id) {
      throw new Error("Client mismatch");
    }

    refreshTokens.delete(refreshToken);

    const newAccessToken = generateToken();
    const newRefreshToken = generateToken();
    const accessExpiresIn = 3600;
    const refreshExpiresIn = 7 * 24 * 3600;

    accessTokens.set(newAccessToken, {
      clientId: client.client_id,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + accessExpiresIn,
    });

    refreshTokens.set(newRefreshToken, {
      clientId: client.client_id,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + refreshExpiresIn,
    });

    console.log(`[MCP Auth] Refreshed tokens for client ${client.client_id}`);

    return {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: accessExpiresIn,
      refresh_token: newRefreshToken,
    };
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = accessTokens.get(token);
    if (!tokenData) throw new Error("Invalid access token");

    return {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: tokenData.expiresAt,
    };
  },
};

// --- Login form approval handler ---

export function approveAuthRequest(
  requestId: string,
  password: string,
): { redirectUrl: string } | { error: string } {
  const pending = pendingAuthRequests.get(requestId);
  if (!pending) return { error: "Invalid or expired authorization request." };
  if (Date.now() > pending.expiresAt) {
    pendingAuthRequests.delete(requestId);
    return { error: "Authorization request expired. Please try again." };
  }

  if (!MCP_AUTH_PASSWORD) {
    return { error: "Server not configured for MCP authentication (MCP_AUTH_PASSWORD not set)." };
  }

  if (!verifyPassword(password, MCP_AUTH_PASSWORD)) {
    return { error: "Invalid password." };
  }

  pendingAuthRequests.delete(requestId);

  const code = generateToken();
  authCodes.set(code, {
    clientId: pending.client.client_id,
    codeChallenge: pending.params.codeChallenge,
    redirectUri: pending.params.redirectUri,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  const redirectUrl = new URL(pending.params.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (pending.params.state) {
    redirectUrl.searchParams.set("state", pending.params.state);
  }

  console.log(`[MCP Auth] Authorization approved, redirecting to ${redirectUrl.origin}`);

  return { redirectUrl: redirectUrl.toString() };
}
