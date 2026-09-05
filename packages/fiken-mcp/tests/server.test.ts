import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { apiKeyAuth, FikenClient } from "../src/client.js";
import { createServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fiken MCP server", () => {
  it("requires the explicit Folio booking payment fields before a confirmed paid purchase", async () => {
    const bodies: unknown[] = [];
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201, headers: { location: "https://api.fiken.no/api/v2/companies/synthetic/purchases/1" } }); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    const proposal = { companySlug: "synthetic", date: "2026-01-01", currency: "USD", description: "Synthetic", vatType: "NONE", confirm: true };
    try {
      const denied = await client.callTool({ name: "fiken_create_purchase", arguments: proposal });
      expect(denied.isError).toBe(true);
      expect(bodies).toEqual([]);
      const booked = await client.callTool({ name: "fiken_create_purchase", arguments: { ...proposal, paymentDate: "2026-01-03", paymentAccount: "1920:1", paymentAmountInNok: 12345 } });
      expect(booked.isError).toBeFalsy();
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ date: "2026-01-01", paymentDate: "2026-01-03", paymentAmountInNok: 12345 });
      expect(bodies[0]).not.toHaveProperty("confirm");
    } finally { await client.close(); await mcp.close(); }
  });

  it("rejects server-local upload paths in remote mode even with confirmation", async () => {
    let requests = 0;
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor, { allowLocalFiles: false });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "fiken_attach_to_purchase", arguments: {"companySlug":"synthetic","purchaseId":1,"path":"synthetic.pdf","confirm":true} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Local file access is disabled");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });

  it("previews fiken_create_purchase without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "fiken_create_purchase", arguments: {"companySlug":"synthetic","date":"2026-01-01","currency":"NOK","description":"Synthetic","vatType":"NONE"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews fiken_create_contact without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "fiken_create_contact", arguments: {"companySlug":"synthetic","name":"Synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews fiken_delete_purchase without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "fiken_delete_purchase", arguments: {"companySlug":"synthetic","purchaseId":1,"description":"Synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews fiken_attach_to_purchase without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FikenClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "fiken_attach_to_purchase", arguments: {"companySlug":"synthetic","purchaseId":1,"path":"synthetic.pdf"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });

  it("marks list companies read-only and create purchase as a write", async () => {
    const fiken = new FikenClient({
      auth: apiKeyAuth("k"),
      fetch: async () => jsonResponse([]),
    });
    const mcp = createServer(fiken);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "fiken_list_companies")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "fiken_preview_purchase")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "fiken_create_purchase")?.annotations?.readOnlyHint).toBe(
      false,
    );
    expect(tools.find((t) => t.name === "fiken_list_contacts")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "fiken_get_purchase")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "fiken_delete_purchase")?.annotations?.destructiveHint).toBe(
      true,
    );
  });
});
