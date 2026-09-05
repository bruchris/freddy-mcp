import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { apiKeyAuth, FolioClient } from "../src/client.js";
import { createServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function connect(folio: FolioClient) {
  const mcp = createServer(folio);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcp };
}

describe("folio MCP server", () => {
  it("returns remote receipt bytes but refuses server-local download destinations", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return new Response("synthetic", { headers: { "content-type": "application/pdf" } }); } });
    const mcp = createServer(vendor, { allowLocalFiles: false });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    const destPath = join(tmpdir(), "freddy-remote-test-" + randomUUID() + ".pdf");
    try {
      const denied = await client.callTool({ name: "folio_download_attachment", arguments: { attachmentId: "synthetic", destPath } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).toContain("Local file access is disabled");
      expect(requests).toBe(0);
      const result = await client.callTool({ name: "folio_download_attachment", arguments: { attachmentId: "synthetic" } });
      expect(result.isError).toBeFalsy();
      expect(result.content.some((part) => part.type === "resource")).toBe(true);
    } finally { await client.close(); await mcp.close(); await rm(destPath, { force: true }); }
  });

  it("rejects server-local upload paths in remote mode even with confirmation", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor, { allowLocalFiles: false });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_upload_attachment", arguments: {"eventId":"synthetic","path":"synthetic.pdf","confirm":true} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Local file access is disabled");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });

  it("previews folio_update_event without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_update_event", arguments: {"eventId":"synthetic","purpose":"Synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews folio_complete_event without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_complete_event", arguments: {"eventId":"synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews folio_uncomplete_event without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_uncomplete_event", arguments: {"eventId":"synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews folio_upload_attachment without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_upload_attachment", arguments: {"eventId":"synthetic","path":"synthetic.pdf"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews folio_create_payment without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_create_payment", arguments: {"creditorName":"Synthetic","creditorAccountNumber":"00000000000","debtorAccountNumber":"00000000000","amount":"1","executionDate":"2026-01-01"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });
  it("previews folio_cancel_payment without a confirmation or side effects", async () => {
    let requests = 0;
    const vendor = new FolioClient({ auth: apiKeyAuth("k"), fetch: async () => { requests += 1; return jsonResponse({}); } });
    const mcp = createServer(vendor);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name: "folio_cancel_payment", arguments: {"paymentId":"synthetic"} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain("preview");
      expect(requests).toBe(0);
    } finally { await client.close(); await mcp.close(); }
  });

  it("marks list events read-only and upload as a write", async () => {
    const folio = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: async () => jsonResponse({ events: [], includes: {} }),
    });
    const { client } = await connect(folio);
    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === "folio_list_events");
    const upload = tools.find((t) => t.name === "folio_upload_attachment");
    expect(list?.annotations?.readOnlyHint).toBe(true);
    expect(upload?.annotations?.readOnlyHint).toBe(false);
    const accounts = tools.find((t) => t.name === "folio_list_accounts");
    const complete = tools.find((t) => t.name === "folio_complete_event");
    const update = tools.find((t) => t.name === "folio_update_event");
    expect(accounts?.annotations?.readOnlyHint).toBe(true);
    expect(complete?.annotations?.readOnlyHint).toBe(false);
    expect(update?.annotations?.readOnlyHint).toBe(false);
    const download = tools.find((t) => t.name === "folio_download_attachment");
    expect(download?.annotations?.readOnlyHint).toBe(true);
  });

  it("lists incomplete card events without receipt bytes", async () => {
    const folio = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: async () =>
        jsonResponse({
          events: [
            {
              id: "evt-openai",
              complete: false,
              time: "2026-04-20T10:00:00Z",
              cardAuthorization: { merchantName: "OPENAI" },
              transactions: [
                {
                  bookingDate: "2026-04-20",
                  transactionAmount: { amount: "934.37", currency: "NOK" },
                  currencyAmount: { amount: "97.04", currency: "USD" },
                },
              ],
              attachments: [],
            },
          ],
          includes: {},
        }),
    });
    const { client } = await connect(folio);
    const result = await client.callTool({
      name: "folio_list_events",
      arguments: { startDate: "2026-04-01", missingReceipt: true },
    });
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    expect(text).toContain("evt-openai");
    expect(text).toContain("OPENAI");
    expect(text).not.toContain("Bearer");
  });

  it("filters Folio complete=false when incomplete is true", async () => {
    const folio = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: async () =>
        jsonResponse({
          events: [
            { id: "done", complete: true, attachments: [{ id: "a" }], purpose: "x", ledgerCategory: { id: "c" } },
            { id: "open", complete: false, attachments: [], cardAuthorization: { merchantName: "Paypal" } },
          ],
          includes: {},
        }),
    });
    const { client } = await connect(folio);
    const result = await client.callTool({
      name: "folio_list_events",
      arguments: { startDate: "2026-04-01", incomplete: true },
    });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("open");
    expect(text).toContain("Paypal");
    expect(text).not.toContain("done");
  });

  it("returns receipt bytes as an embedded resource for the model to read", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const folio = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/attachments/att-1/")) {
          return new Response(pdf, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          });
        }
        return jsonResponse({
          event: {
            id: "evt-1",
            attachments: [{ id: "att-1", filename: "Receipt.pdf", mimeType: "application/pdf" }],
          },
        });
      },
    });
    const { client } = await connect(folio);
    const result = await client.callTool({
      name: "folio_download_attachment",
      arguments: { eventId: "evt-1" },
    });
    expect(result.isError).toBeFalsy();
    const resource = result.content.find((c) => c.type === "resource");
    expect(resource).toMatchObject({
      type: "resource",
      resource: { mimeType: "application/pdf" },
    });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("att-1");
    expect(text).toContain("Receipt.pdf");
    expect(text).not.toContain("Bearer");
  });

  it("passes Folio OCR text through without parsing invoice fields", async () => {
    const folio = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/categories/")) {
          return jsonResponse({ title: "Programvare (abonnement)", accountNumber: 6553 });
        }
        return jsonResponse({
          event: {
            id: "evt-1",
            complete: true,
            ledgerCategory: { id: "cat-1" },
            attachments: [
              {
                id: "att-1",
                filename: "Receipt.pdf",
                extractedText: "Invoice number 0D37C802-0038\nOpenAI OpCo, LLC",
              },
            ],
          },
        });
      },
    });
    const { client } = await connect(folio);
    const result = await client.callTool({
      name: "folio_get_event",
      arguments: { eventId: "evt-1" },
    });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("Invoice number 0D37C802-0038");
    expect(text).not.toContain("\"invoiceNumber\"");
    expect(text).not.toContain("lineDescription");
  });
});
