export const DEFAULT_FIKEN_BASE_URL = "https://api.fiken.no/api/v2";

export type AuthProvider = {
  getAccessToken(): Promise<string>;
};

export function apiKeyAuth(apiKey: string): AuthProvider {
  return {
    async getAccessToken() {
      return apiKey;
    },
  };
}

export class FikenApiError extends Error {
  // Raw URLs and response bodies can contain credentials or accounting data.
  constructor(readonly status: number, _url: string, _body: string) {
    super(messageFor(status));
    this.name = "FikenApiError";
  }
}

function messageFor(status: number): string {
  if (status === 401) return "Fiken authentication failed (401). Set FIKEN_API_TOKEN to a valid token or reconnect OAuth.";
  if (status === 403) return "Fiken forbidden (403). The credential lacks permission for this resource.";
  if (status === 404) return "Fiken resource not found (404).";
  if (status === 429) return "Fiken rate limit (429). Back off before retrying.";
  if (status === 501) return "Fiken has not implemented this endpoint (501).";
  if (status === 400) return "Fiken rejected the request (400). Review the submitted fields and accounting period in Fiken; do not change VAT automatically.";
  return "Fiken API HTTP " + status + ". Response details withheld to protect credentials and accounting data.";
}

export type FikenCompany = {
  slug?: string;
  name?: string;
  organizationNumber?: string;
  [key: string]: unknown;
};

export type FikenAccount = {
  code?: string;
  name?: string;
  [key: string]: unknown;
};

export type FikenBankAccount = {
  bankAccountNumber?: string;
  name?: string;
  accountCode?: string;
  [key: string]: unknown;
};

export type FikenContact = {
  contactId?: number;
  name?: string;
  email?: string;
  supplier?: boolean;
  customer?: boolean;
  inactive?: boolean;
  organizationNumber?: string;
  address?: {
    streetAddress?: string;
    streetAddressLine2?: string;
    city?: string;
    postCode?: string;
    country?: string;
  };
  [key: string]: unknown;
};

export type FikenPurchaseLine = {
  description: string;
  vatType: string;
  account?: string;
  netPrice?: number;
  vat?: number;
  netPriceInCurrency?: number;
  vatInCurrency?: number;
};

export type FikenPurchaseRequest = {
  identifier?: string;
  date: string;
  dueDate?: string;
  kind: "cash_purchase" | "supplier";
  paid: boolean;
  currency: string;
  paymentAccount?: string;
  paymentDate?: string;
  paymentAmountInNok?: number;
  supplierId?: number;
  kid?: string;
  lines: FikenPurchaseLine[];
};

export type CreatedPurchase = {
  id: number | null;
  location: string | null;
};

export type FikenClientOptions = {
  auth: AuthProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
};

function unwrapArray<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  throw new Error(`Unexpected Fiken list payload (wanted ${keys.join("/")})`);
}

function purchaseIdFromLocation(location: string | null): number | null {
  if (!location) return null;
  const match = location.match(/\/purchases\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}


async function responseText(response: Response): Promise<string> {
  try { return await response.text(); } catch { throw new Error("Fiken response could not be read. Check the vendor before retrying a write."); }
}

export class FikenClient {
  private readonly auth: AuthProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: FikenClientOptions) {
    this.auth = options.auth;
    this.baseUrl = (options.baseUrl ?? DEFAULT_FIKEN_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listCompanies(): Promise<FikenCompany[]> {
    return unwrapArray(await this.json("/companies"), ["companies"]);
  }

  async listAccounts(
    companySlug: string,
    params?: { fromAccount?: string; toAccount?: string; page?: number; pageSize?: number },
  ): Promise<FikenAccount[]> {
    const query = new URLSearchParams();
    if (params?.fromAccount) query.set("fromAccount", params.fromAccount);
    if (params?.toAccount) query.set("toAccount", params.toAccount);
    if (params?.page !== undefined) query.set("page", String(params.page));
    query.set("pageSize", String(params?.pageSize ?? 100));
    const qs = query.toString();
    return unwrapArray(
      await this.json(`/companies/${companySlug}/accounts?${qs}`),
      ["accounts"],
    );
  }

  async listBankAccounts(companySlug: string): Promise<FikenBankAccount[]> {
    return unwrapArray(
      await this.json(`/companies/${companySlug}/bankAccounts`),
      ["bankAccounts", "accounts"],
    );
  }

  async listContacts(
    companySlug: string,
    params?: { name?: string; email?: string; page?: number; pageSize?: number },
  ): Promise<FikenContact[]> {
    const query = new URLSearchParams();
    if (params?.name) query.set("name", params.name);
    if (params?.email) query.set("email", params.email);
    if (params?.page !== undefined) query.set("page", String(params.page));
    query.set("pageSize", String(params?.pageSize ?? 100));
    return unwrapArray(
      await this.json(`/companies/${companySlug}/contacts?${query.toString()}`),
      ["contacts"],
    );
  }

  async getContact(companySlug: string, contactId: number): Promise<FikenContact> {
    return this.json(`/companies/${companySlug}/contacts/${contactId}`);
  }

  async createContact(companySlug: string, body: Record<string, unknown>): Promise<FikenContact | { location: string | null }> {
    const url = `${this.baseUrl}/companies/${companySlug}/contacts`;
    const { response, body: text } = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new FikenApiError(response.status, url, text);
    }
    const location = response.headers.get("location");
    if (text) {
      try {
        return JSON.parse(text) as FikenContact;
      } catch {
        // 201 with empty body
      }
    }
    return { location };
  }

  async deletePurchase(companySlug: string, purchaseId: number, description: string): Promise<void> {
    const query = new URLSearchParams({ description });
    await this.json(
      `/companies/${companySlug}/purchases/${purchaseId}/delete?${query.toString()}`,
      { method: "PATCH" },
    );
  }

  async listPurchases(
    companySlug: string,
    params?: { date?: string; dateGe?: string; dateLe?: string; page?: number; pageSize?: number },
  ): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.date) query.set("date", params.date);
    if (params?.dateGe) query.set("dateGe", params.dateGe);
    if (params?.dateLe) query.set("dateLe", params.dateLe);
    if (params?.page !== undefined) query.set("page", String(params.page));
    query.set("pageSize", String(params?.pageSize ?? 25));
    return unwrapArray(
      await this.json(`/companies/${companySlug}/purchases?${query.toString()}`),
      ["purchases"],
    );
  }

  async getPurchase(companySlug: string, purchaseId: number): Promise<unknown> {
    return this.json(`/companies/${companySlug}/purchases/${purchaseId}`);
  }

  async createPurchase(
    companySlug: string,
    body: FikenPurchaseRequest,
  ): Promise<CreatedPurchase> {
    const url = `${this.baseUrl}/companies/${companySlug}/purchases`;
    const { response, body: text } = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new FikenApiError(response.status, url, text);
    }
    const location = response.headers.get("location");
    let id = purchaseIdFromLocation(location);
    if (text) {
      try {
        const parsed = JSON.parse(text) as { purchaseId?: number; id?: number };
        id = parsed.purchaseId ?? parsed.id ?? id;
      } catch {
        // 201 with empty or non-JSON body
      }
    }
    return { id, location };
  }

  async attachToPurchase(
    companySlug: string,
    purchaseId: number,
    file: { bytes: Uint8Array; filename: string; contentType: string },
    options?: { attachToPayment?: boolean; attachToSale?: boolean },
  ): Promise<{ location: string | null }> {
    const url = `${this.baseUrl}/companies/${companySlug}/purchases/${purchaseId}/attachments`;
    const form = new FormData();
    form.append("filename", file.filename);
    if (options?.attachToPayment !== false) form.append("attachToPayment", "true");
    if (options?.attachToSale) form.append("attachToSale", "true");
    form.append(
      "file",
      new Blob([file.bytes], { type: file.contentType }),
      file.filename,
    );
    const { response, body: text } = await this.request(url, { method: "POST", body: form });
    if (!response.ok) {
      throw new FikenApiError(response.status, url, text);
    }
    return { location: response.headers.get("location") };
  }

  private request(url: string, init?: RequestInit): Promise<{ response: Response; body: string }> {
    return this.enqueue(async () => {
      const response = await this.send(url, init);
      const body = await responseText(response);
      return { response, body };
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { response, body } = await this.request(url, init);
    if (!response.ok) {
      throw new FikenApiError(response.status, url, body);
    }
    if (!body) return [] as T;
    try { return JSON.parse(body) as T; } catch { throw new Error("Fiken returned an invalid JSON response."); }
  }

  private async send(url: string, init?: RequestInit): Promise<Response> {
    try {
      const token = await this.auth.getAccessToken();
      const headers = new Headers(init?.headers);
      if (!headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return await this.fetchImpl(url, { ...init, headers });
    } catch {
      throw new Error("Fiken request failed before receiving a response. Check the connection before retrying a write.");
    }
  }
}
