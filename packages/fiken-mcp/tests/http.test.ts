import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authorizationMatches, listenMcpHttp } from "../src/mcp-http.js";

describe("MCP HTTP bearer", () => {
  it("rejects a malformed request target without crashing the HTTP server", async () => {
    const { close, port } = await listenMcpHttp({ name: "test", token: "s3cret", port: 0, createServer: () => new McpServer({ name: "test", version: "0.0.0" }) });
    try {
      await expect(fetch("http://127.0.0.1:" + port + "//[", { signal: AbortSignal.timeout(500) })).resolves.toMatchObject({ status: 400 });
      expect((await fetch("http://127.0.0.1:" + port + "/healthz")).status).toBe(200);
    } finally { close(); }
  });

  it.each([undefined, "https://trusted.example"])("serves authenticated initialize for an allowed client origin %s", async (origin) => {
    const { close, port } = await listenMcpHttp({
      name: "test", token: "s3cret", port: 0, allowedOrigins: ["https://trusted.example"],
      createServer: () => new McpServer({ name: "test", version: "0.0.0" }),
    });
    try {
      const headers: Record<string, string> = { authorization: "Bearer wrong", "content-type": "application/json", accept: "application/json, text/event-stream" };
      if (origin) headers.origin = origin;
      const denied = await fetch("http://127.0.0.1:" + port + "/mcp", { method: "POST", headers, body: "{}" });
      expect(denied.status).toBe(401);
      headers.authorization = "Bearer s3cret";
      const response = await fetch("http://127.0.0.1:" + port + "/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } } }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin ?? null);
      const body = await response.text();
      expect(body).toContain("protocolVersion");
      expect(body).not.toContain("s3cret");
    } finally { close(); }
  });

  it("keeps internal failures out of HTTP responses", async () => {
    const { close, port } = await listenMcpHttp({
      name: "test", token: "s3cret", port: 0,
      createServer: () => { throw new Error("synthetic-private-credential"); },
    });
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/mcp", {
        method: "POST", headers: { authorization: "Bearer s3cret" },
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null});
    } finally { close(); }
  });

  it("rejects untrusted browser origins before authentication or MCP work", async () => {
    let calls = 0;
    const { close, port } = await listenMcpHttp({
      name: "test", token: "s3cret", port: 0,
      createServer: () => { calls += 1; return new McpServer({ name: "t", version: "0.0.0" }); },
    });
    try {
      for (const method of ["OPTIONS", "POST", "GET"]) {
        const response = await fetch("http://127.0.0.1:" + port + "/mcp", {
          method, headers: { origin: "https://untrusted.example", authorization: "Bearer s3cret" },
        });
        expect(response.status).toBe(403);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
      expect(calls).toBe(0);
    } finally { close(); }
  });

  it("accepts a matching Bearer token", () => {
    expect(authorizationMatches("Bearer secret", "secret")).toBe(true);
    expect(authorizationMatches("Bearer other", "secret")).toBe(false);
    expect(authorizationMatches(undefined, "secret")).toBe(false);
  });

  it("serves /healthz and rejects /mcp without a token", async () => {
    const mcp = new McpServer({ name: "t", version: "0.0.0" });
    const { close, port } = await listenMcpHttp({
      name: "test",
      token: "s3cret",
      port: 0,
      createServer: () => mcp,
    });
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");
      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(denied.status).toBe(401);
    } finally {
      close();
    }
  });
});
