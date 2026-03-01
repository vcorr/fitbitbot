import crypto from "node:crypto";
import express, { Request, Response, RequestHandler } from "express";
import cors from "cors";
import { z } from "zod";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { oauthProvider, approveAuthRequest } from "./auth.js";
import { createMcpServer } from "./server.js";

// The MCP SDK uses Express v5 types while this project uses Express v4.
// Cast middleware to RequestHandler to bridge the type gap (runtime API is compatible).
const asMiddleware = (fn: unknown) => fn as RequestHandler;

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || `http://localhost:${process.env.PORT || 8080}`;

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "method" in body &&
    (body as Record<string, unknown>).method === "initialize"
  );
}

export function createMcpRoutes(): express.Router {
  const router = express.Router();

  const issuerUrl = new URL(MCP_SERVER_URL);
  const mcpEndpointUrl = new URL("/mcp", MCP_SERVER_URL);

  // CORS for OAuth discovery and MCP endpoints
  const allowedOrigins = new Set(["https://claude.ai", "https://claude.com"]);
  const mcpCors = cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  });

  // --- OAuth routes ---

  router.use(
    mcpCors,
    asMiddleware(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl,
        resourceServerUrl: mcpEndpointUrl,
      }),
    ),
  );

  // --- Login form approval (POST from OAuth login page) ---

  router.use(express.urlencoded({ extended: false }));

  const ApproveBodySchema = z.object({
    request_id: z.string().uuid(),
    password: z.string().min(1),
  });

  router.post("/mcp-approve", (req: Request, res: Response) => {
    const parsed = ApproveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).type("html").send(errorPage("Missing or invalid fields."));
      return;
    }

    const { request_id, password } = parsed.data;

    const result = approveAuthRequest(request_id, password);

    if ("error" in result) {
      res.status(403).type("html").send(errorPage(result.error));
      return;
    }

    res.redirect(result.redirectUrl);
  });

  // --- MCP Streamable HTTP endpoint ---

  const bearerAuth = asMiddleware(
    requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpEndpointUrl),
    }),
  );

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handleMcpPost = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          console.log(`[MCP] Session created: ${sid}`);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          transports.delete(sid);
          console.log(`[MCP] Session closed: ${sid}`);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad request: missing session ID or not an initialization request" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };

  const handleMcpGet = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session ID" },
        id: null,
      });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  };

  const handleMcpDelete = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(200).end();
    }
  };

  router.post("/mcp", mcpCors, bearerAuth, handleMcpPost);
  router.get("/mcp", mcpCors, bearerAuth, handleMcpGet);
  router.delete("/mcp", mcpCors, bearerAuth, handleMcpDelete);

  return router;
}

function errorPage(message: string): string {
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html><head>
<title>Fitbit MCP - Error</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 20px; color: #333; }
  .error { color: #cc0000; background: #fff0f0; padding: 16px; border-radius: 6px; border: 1px solid #ffcccc; }
  a { color: #0066cc; }
</style>
</head><body>
<h2>Authorization Error</h2>
<p class="error">${escaped}</p>
<p><a href="javascript:history.back()">Go back</a></p>
</body></html>`;
}
