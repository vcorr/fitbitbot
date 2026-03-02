import crypto from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

interface TokenData {
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

type FirestoreDb = import("@google-cloud/firestore").Firestore;

let db: FirestoreDb | null = null;
let firestoreInitAttempted = false;

async function getDb(): Promise<FirestoreDb | null> {
  if (db) return db;
  if (!firestoreInitAttempted) {
    firestoreInitAttempted = true;
    try {
      const { Firestore } = await import("@google-cloud/firestore");
      db = new Firestore();
      // Test connectivity with a simple operation
      await db.collection("mcp_clients").limit(1).get();
      console.log("[MCP Store] Firestore connected");
      return db;
    } catch (err) {
      console.log(`[MCP Store] Firestore unavailable, using in-memory only: ${(err as Error).message}`);
      db = null;
      return null;
    }
  }
  return db;
}

// --- In-memory caches ---
const clientsCache = new Map<string, OAuthClientInformationFull>();
const accessTokensCache = new Map<string, TokenData>();
const refreshTokensCache = new Map<string, TokenData>();

export const tokenStore = {
  // --- Clients ---

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const cached = clientsCache.get(clientId);
    if (cached) return cached;

    const firestore = await getDb();
    if (!firestore) return undefined;

    try {
      const doc = await firestore.collection("mcp_clients").doc(clientId).get();
      if (!doc.exists) return undefined;
      const client = doc.data()!.data as OAuthClientInformationFull;
      clientsCache.set(clientId, client);
      return client;
    } catch (err) {
      console.error(`[MCP Store] Firestore read error (clients): ${(err as Error).message}`);
      return undefined;
    }
  },

  async setClient(clientId: string, client: OAuthClientInformationFull): Promise<void> {
    clientsCache.set(clientId, client);

    const firestore = await getDb();
    if (!firestore) return;

    try {
      await firestore.collection("mcp_clients").doc(clientId).set({
        data: client,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error(`[MCP Store] Firestore write error (clients): ${(err as Error).message}`);
    }
  },

  // --- Access Tokens ---

  async getAccessToken(token: string): Promise<TokenData | undefined> {
    const cached = accessTokensCache.get(token);
    if (cached) {
      if (Math.floor(Date.now() / 1000) >= cached.expiresAt) {
        accessTokensCache.delete(token);
        return undefined;
      }
      return cached;
    }

    const firestore = await getDb();
    if (!firestore) return undefined;

    try {
      const hash = sha256(token);
      const doc = await firestore.collection("mcp_access_tokens").doc(hash).get();
      if (!doc.exists) return undefined;
      const data = doc.data()!;
      const tokenData: TokenData = {
        clientId: data.clientId,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
      };
      accessTokensCache.set(token, tokenData);
      return tokenData;
    } catch (err) {
      console.error(`[MCP Store] Firestore read error (access_tokens): ${(err as Error).message}`);
      return undefined;
    }
  },

  async setAccessToken(token: string, data: TokenData): Promise<void> {
    accessTokensCache.set(token, data);

    const firestore = await getDb();
    if (!firestore) return;

    try {
      const hash = sha256(token);
      await firestore.collection("mcp_access_tokens").doc(hash).set({
        clientId: data.clientId,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        expireTime: new Date(data.expiresAt * 1000),
      });
    } catch (err) {
      console.error(`[MCP Store] Firestore write error (access_tokens): ${(err as Error).message}`);
    }
  },

  async deleteAccessToken(token: string): Promise<void> {
    accessTokensCache.delete(token);

    const firestore = await getDb();
    if (!firestore) return;

    try {
      const hash = sha256(token);
      await firestore.collection("mcp_access_tokens").doc(hash).delete();
    } catch (err) {
      console.error(`[MCP Store] Firestore delete error (access_tokens): ${(err as Error).message}`);
    }
  },

  // --- Refresh Tokens ---

  async getRefreshToken(token: string): Promise<TokenData | undefined> {
    const cached = refreshTokensCache.get(token);
    if (cached) {
      if (Math.floor(Date.now() / 1000) >= cached.expiresAt) {
        refreshTokensCache.delete(token);
        return undefined;
      }
      return cached;
    }

    const firestore = await getDb();
    if (!firestore) return undefined;

    try {
      const hash = sha256(token);
      const doc = await firestore.collection("mcp_refresh_tokens").doc(hash).get();
      if (!doc.exists) return undefined;
      const data = doc.data()!;
      const tokenData: TokenData = {
        clientId: data.clientId,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
      };
      refreshTokensCache.set(token, tokenData);
      return tokenData;
    } catch (err) {
      console.error(`[MCP Store] Firestore read error (refresh_tokens): ${(err as Error).message}`);
      return undefined;
    }
  },

  async setRefreshToken(token: string, data: TokenData): Promise<void> {
    refreshTokensCache.set(token, data);

    const firestore = await getDb();
    if (!firestore) return;

    try {
      const hash = sha256(token);
      await firestore.collection("mcp_refresh_tokens").doc(hash).set({
        clientId: data.clientId,
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        expireTime: new Date(data.expiresAt * 1000),
      });
    } catch (err) {
      console.error(`[MCP Store] Firestore write error (refresh_tokens): ${(err as Error).message}`);
    }
  },

  async deleteRefreshToken(token: string): Promise<void> {
    refreshTokensCache.delete(token);

    const firestore = await getDb();
    if (!firestore) return;

    try {
      const hash = sha256(token);
      await firestore.collection("mcp_refresh_tokens").doc(hash).delete();
    } catch (err) {
      console.error(`[MCP Store] Firestore delete error (refresh_tokens): ${(err as Error).message}`);
    }
  },
};
