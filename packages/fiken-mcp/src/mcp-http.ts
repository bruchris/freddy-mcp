import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export function authorizationMatches(header: string | undefined, expected: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix) || !expected) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function corsHeaders(origin?: string): Record<string, string> {
  return {
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}

export function listenMcpHttp(options: {
  name: string;
  token: string;
  port: number;
  host?: string;
  allowedOrigins?: string[];
  createServer: () => McpServer | Promise<McpServer>;
}): Promise<{ close: () => void; port: number }> {
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try { url = new URL(req.url ?? "/", "http://127.0.0.1"); } catch {
      res.writeHead(400).end("bad request target");
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !options.allowedOrigins?.includes(origin)) {
      res.writeHead(403).end("forbidden origin");
      return;
    }
    for (const [key, value] of Object.entries(corsHeaders(origin))) res.setHeader(key, value);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin)).end();
      return;
    }
    if (!authorizationMatches(req.headers.authorization, options.token)) {
      res.writeHead(401, { "www-authenticate": "Bearer", ...corsHeaders(origin) }).end("unauthorized");
      return;
    }
    try {
      const mcp = await options.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      const message = "Internal server error";
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message }, id: null }),
        );
      }
    }
  });
  return new Promise((resolve, reject) => {
    http.on("error", reject);
    const host = options.host ?? "127.0.0.1";
    http.listen(options.port, host, () => {
      const addr = http.address();
      const port = typeof addr === "object" && addr ? addr.port : options.port;
      process.stderr.write(
        `[${options.name}] HTTP MCP on ${host}:${port} (POST/GET /mcp, GET /healthz)\n`,
      );
      resolve({
        port,
        close: () => http.close(),
      });
    });
  });
}

export function requireMcpAuthToken(): string {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "MCP_AUTH_TOKEN must be set to serve over HTTP. Never expose /mcp without a bearer token.",
    );
  }
  return token;
}
