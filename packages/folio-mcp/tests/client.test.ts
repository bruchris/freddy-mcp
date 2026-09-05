import { describe, expect, it } from "vitest";
import { apiKeyAuth, eventGaps, FolioClient } from "../src/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FolioClient", () => {
  it.each(["rejected", "malformed", "network", "body", "download"])("does not disclose vendor data in %s errors", async (mode) => {
    const client = new FolioClient({
      auth: apiKeyAuth("SECR3T42"),
      fetch: async () => {
        if (mode === "network") throw new Error("SECR3T42");
        if (mode === "body" || mode === "download") return new Response(new ReadableStream({ start(controller) { controller.error(new Error("SECR3T42")); } }));
        return new Response("SECR3T42", { status: mode === "rejected" ? 400 : 200 });
      },
    });
    let caught: unknown;
    try { if (mode === "download") await client.downloadAttachment("synthetic"); else await client.listAccounts(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught) + JSON.stringify(caught)).not.toContain("SECR3T42");
  });

  it("sends a Bearer token from apiKey auth on listEvents", async () => {
    const headers: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const h = new Headers(init?.headers);
      headers.push(h.get("authorization") ?? "");
      return jsonResponse({ events: [], includes: {} });
    };

    const client = new FolioClient({
      auth: apiKeyAuth("secret-key"),
      fetch: fetchImpl,
    });
    await client.listEvents({ startDate: "2026-04-01" });

    expect(headers[0]).toBe("Bearer secret-key");
  });

  it("throws an actionable 401 error", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 401 });
    const client = new FolioClient({
      auth: apiKeyAuth("bad"),
      fetch: fetchImpl,
    });

    await expect(client.listEvents({ startDate: "2026-04-01" })).rejects.toMatchObject({
      name: "FolioApiError",
      status: 401,
    });
    await expect(client.listEvents({ startDate: "2026-04-01" })).rejects.toThrow(
      /FOLIO_API_KEY/,
    );
  });

  it("uploads attachment bytes with content-type and filename", async () => {
    let method = "";
    let url = "";
    let contentType = "";
    let contentDisposition = "";
    let bodyText = "";

    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      const h = new Headers(init?.headers);
      contentType = h.get("content-type") ?? "";
      contentDisposition = h.get("content-disposition") ?? "";
      bodyText = new TextDecoder().decode(init?.body as Uint8Array);
      return jsonResponse({ id: "att-1" });
    };

    const client = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    const result = await client.uploadAttachment("evt-1", {
      bytes: new TextEncoder().encode("%PDF"),
      filename: "receipt.pdf",
      contentType: "application/pdf",
    });

    expect(method).toBe("POST");
    expect(url).toBe("https://api.folio.no/v2/events/evt-1/attachments");
    expect(contentType).toBe("application/pdf");
    expect(contentDisposition).toContain("receipt.pdf");
    expect(bodyText).toBe("%PDF");
    expect(result.id).toBe("att-1");
  });

  it("unwraps getEvent payload from { event }", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        event: {
          id: "evt-1",
          complete: false,
          attachments: [{ id: "att-1", filename: "r.pdf" }],
        },
      });
    const client = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    const event = await client.getEvent("evt-1");
    expect(event.id).toBe("evt-1");
    expect(event.attachments?.[0]?.filename).toBe("r.pdf");
  });

  it("PATCHes ledgerCategoryId on an event", async () => {
    let method = "";
    let url = "";
    let body = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      body = String(init?.body ?? "");
      return new Response("", { status: 202 });
    };
    const client = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    await client.updateEvent("evt-1", { ledgerCategoryId: "cat-software" });
    expect(method).toBe("PATCH");
    expect(url).toBe("https://api.folio.no/v2/events/evt-1");
    expect(JSON.parse(body)).toEqual({ ledgerCategoryId: "cat-software" });
  });

  it("POSTs /complete to mark an event done", async () => {
    let method = "";
    let url = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      return new Response("", { status: 202 });
    };
    const client = new FolioClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    await client.markComplete("evt-1");
    expect(method).toBe("POST");
    expect(url).toBe("https://api.folio.no/v2/events/evt-1/complete");
  });

  it("lists accounts at GET /accounts", async () => {
    let url = "";
    const fetchImpl: typeof fetch = async (input) => {
      url = String(input);
      return jsonResponse({
        accounts: [{ accountNumber: "1", name: "Kort", type: "Card", balance: "10.00" }],
      });
    };
    const client = new FolioClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const data = await client.listAccounts();
    expect(url).toBe("https://api.folio.no/v2/accounts");
    expect(data.accounts[0]?.name).toBe("Kort");
  });

  it("POSTs a payment draft", async () => {
    let method = "";
    let url = "";
    let body = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      body = String(init?.body ?? "");
      return jsonResponse({ id: "pay-1", eventId: "evt-1" });
    };
    const client = new FolioClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const result = await client.createPayment({
      creditor: { name: "Ola", accountNumber: "123" },
      debtorAccountNumber: "456",
      currencyAmount: { amount: "10.00", currency: "NOK" },
      executionDate: "2026-05-18",
      message: "test",
    });
    expect(method).toBe("POST");
    expect(url).toBe("https://api.folio.no/v2/payments");
    expect(JSON.parse(body).message).toBe("test");
    expect(result.id).toBe("pay-1");
  });

  it("DELETEs /complete to mark an event incomplete", async () => {
    let method = "";
    let url = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      return new Response("", { status: 202 });
    };
    const client = new FolioClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    await client.markIncomplete("evt-1");
    expect(method).toBe("DELETE");
    expect(url).toBe("https://api.folio.no/v2/events/evt-1/complete");
  });

  it("GETs a ledger category by id", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://api.folio.no/v2/categories/cat-1");
      return jsonResponse({
        accountName: "Programvare",
        accountNumber: 6550,
        title: "Programvare (abonnement)",
        vatCode: 0,
        vatRate: 0,
      });
    };
    const client = new FolioClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const category = await client.getCategory("cat-1");
    expect(category.accountNumber).toBe(6550);
    expect(category.title).toBe("Programvare (abonnement)");
  });

  it("downloads attachment bytes with content-type", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe(
        "https://api.folio.no/v2/attachments/att-1/original",
      );
      return new Response(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    };
    const client = new FolioClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const file = await client.downloadAttachment("att-1", "original");
    expect(file.contentType).toBe("application/pdf");
    expect(file.bytes).toEqual(pdf);
  });
});

describe("eventGaps", () => {
  it("flags Folio complete=false and missing receipt, purpose, and category", () => {
    const gaps = eventGaps({
      id: "e1",
      complete: false,
      attachments: [],
    });
    expect(gaps).toEqual({
      incomplete: true,
      missingReceipt: true,
      missingPurpose: true,
      missingCategory: true,
    });
  });

  it("is clean when complete with receipt, purpose, and category", () => {
    expect(
      eventGaps({
        id: "e2",
        complete: true,
        purpose: "SaaS",
        attachments: [{ id: "a1", filename: "r.pdf" }],
        ledgerCategory: { id: "cat" },
      }),
    ).toEqual({
      incomplete: false,
      missingReceipt: false,
      missingPurpose: false,
      missingCategory: false,
    });
  });
});
