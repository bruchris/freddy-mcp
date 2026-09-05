#!/usr/bin/env node
import { createServer } from "./server.js";
import { folioClientFromEnv, loadEnvFiles } from "./env.js";
import { listenMcpHttp, requireMcpAuthToken } from "./mcp-http.js";

async function main() {
  loadEnvFiles();
  const token = requireMcpAuthToken();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const folio = await folioClientFromEnv();
  await listenMcpHttp({
    name: "folio-mcp",
    token,
    host,
    port,
    createServer: () => createServer(folio, { allowLocalFiles: false }),
    allowedOrigins: process.env.MCP_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
