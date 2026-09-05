import { describe, expect, it } from "vitest";
import { apiKeyAuth, FikenClient } from "../src/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FikenClient", () => {
  it.each(["rejected", "malformed", "network", "body"])("does not disclose vendor data in %s errors", async (mode) => {
    const client = new FikenClient({
      auth: apiKeyAuth("SECR3T42"),
      fetch: async () => {
        if (mode === "network") throw new Error("SECR3T42");
        if (mode === "body" || mode === "download") return new Response(new ReadableStream({ start(controller) { controller.error(new Error("SECR3T42")); } }));
        return new Response("SECR3T42", { status: mode === "rejected" ? 400 : 200 });
      },
    });
    let caught: unknown;
    try { await client.listCompanies(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught) + JSON.stringify(caught)).not.toContain("SECR3T42");
  });

  it.each(["list", "purchase", "contact", "attachment"])("waits for the complete %s response body before the next request", async (operation) => {
    let requests = 0;
    let releaseBody!: () => void;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      if (requests > 1) return jsonResponse([]);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          releaseBody = () => { controller.enqueue(new TextEncoder().encode("[]")); controller.close(); };
        },
      }));
    };
    const client = new FikenClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const first = operation === "purchase" ? client.createPurchase("demo", { date: "2026-01-01", kind: "cash_purchase", paid: false, currency: "NOK", lines: [] })
      : operation === "contact" ? client.createContact("demo", { name: "Synthetic supplier" })
      : operation === "attachment" ? client.attachToPurchase("demo", 1, { bytes: new Uint8Array([1]), filename: "synthetic.pdf", contentType: "application/pdf" })
      : client.listCompanies();
    const second = client.listCompanies();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requests).toBe(1);
    } finally {
      releaseBody();
      await Promise.all([first, second]);
    }
    expect(requests).toBe(2);
  });

  it("sends a Bearer token from apiKey auth on listCompanies", async () => {
    const headers: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const h = new Headers(init?.headers);
      headers.push(h.get("authorization") ?? "");
      return jsonResponse([]);
    };
    const client = new FikenClient({
      auth: apiKeyAuth("secret-token"),
      fetch: fetchImpl,
    });
    await client.listCompanies();
    expect(headers[0]).toBe("Bearer secret-token");
  });

  it("throws an actionable 401 error", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 401 });
    const client = new FikenClient({
      auth: apiKeyAuth("bad"),
      fetch: fetchImpl,
    });
    await expect(client.listCompanies()).rejects.toMatchObject({
      name: "FikenApiError",
      status: 401,
    });
    await expect(client.listCompanies()).rejects.toThrow(/FIKEN_API_TOKEN/);
  });

  it("serializes overlapping requests (one in-flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: typeof fetch = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return jsonResponse([]);
    };
    const client = new FikenClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    await Promise.all([client.listCompanies(), client.listCompanies()]);
    expect(maxInFlight).toBe(1);
  });

  it("POSTs a purchase and reads id from Location", async () => {
    let method = "";
    let url = "";
    let body = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      body = String(init?.body ?? "");
      return new Response("", {
        status: 201,
        headers: {
          location: "https://api.fiken.no/api/v2/companies/bru/purchases/99",
        },
      });
    };
    const client = new FikenClient({
      auth: apiKeyAuth("k"),
      fetch: fetchImpl,
    });
    const created = await client.createPurchase("bru", {
      identifier: "evt-1",
      date: "2026-05-18",
      kind: "cash_purchase",
      paid: true,
      currency: "USD",
      paymentAccount: "1920:1",
      paymentDate: "2026-05-18",
      paymentAmountInNok: 95516,
      lines: [
        {
          description: "ChatGPT Pro",
          vatType: "NONE",
          account: "6550",
          netPriceInCurrency: 10000,
          vatInCurrency: 0,
        },
      ],
    });
    expect(method).toBe("POST");
    expect(url).toBe("https://api.fiken.no/api/v2/companies/bru/purchases");
    expect(JSON.parse(body).identifier).toBe("evt-1");
    expect(created.id).toBe(99);
  });

  it("lists contacts with a name filter", async () => {
    let url = "";
    const fetchImpl: typeof fetch = async (input) => {
      url = String(input);
      return jsonResponse([{ contactId: 1, name: "OpenAI, LLC", supplier: true }]);
    };
    const client = new FikenClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    const contacts = await client.listContacts("bru", { name: "OpenAI" });
    expect(url).toContain("/companies/bru/contacts?");
    expect(url).toContain("name=OpenAI");
    expect(contacts[0]?.name).toBe("OpenAI, LLC");
  });

  it("PATCHes purchase delete with a reason", async () => {
    let method = "";
    let url = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      return new Response("", { status: 200 });
    };
    const client = new FikenClient({ auth: apiKeyAuth("k"), fetch: fetchImpl });
    await client.deletePurchase("bru", 99, "rebook with supplier");
    expect(method).toBe("PATCH");
    expect(url).toContain("/companies/bru/purchases/99/delete?");
    expect(url).toContain("description=rebook");
  });
});
