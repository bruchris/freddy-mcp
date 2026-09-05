#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fikenClientFromEnv, loadEnvFiles } from "./env.js";
import { createServer } from "./server.js";

async function main() {
  loadEnvFiles();
  const fiken = await fikenClientFromEnv();
  const server = createServer(fiken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
