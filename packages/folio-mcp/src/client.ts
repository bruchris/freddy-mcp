export const DEFAULT_FOLIO_BASE_URL = "https://api.folio.no/v2";

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

export class FolioApiError extends Error {
  // Raw URLs and response bodies can contain credentials or accounting data.
  constructor(readonly status: number, _url: string, _body: string) {
    super(messageFor(status));
    this.name = "FolioApiError";
  }
}

function messageFor(status: number): string {
  if (status === 401) return "Folio authentication failed (401). Set FOLIO_API_KEY to a valid key or reconnect OAuth.";
  if (status === 403) return "Folio forbidden (403). The credential lacks permission for this resource.";
  if (status === 404) return "Folio resource not found (404).";
  if (status === 429) return "Folio rate limit (429). Back off before retrying.";
  if (status === 501) return "Folio has not implemented this endpoint (501).";
  if (status === 400) return "Folio rejected the request (400). Review the submitted fields and accounting period in Folio; do not change VAT automatically.";
  return "Folio API HTTP " + status + ". Response details withheld to protect credentials and accounting data.";
}

export type Money = {
  amount: string;
  currency: string;
};

export type FolioAttachmentMeta = {
  id: string;
  filename?: string;
  mimeType?: string;
  fileSize?: number;
  extractedText?: string;
};

export type FolioEvent = {
  id: string;
  complete?: boolean;
  amount?: Money;
  time?: string;
  cardAuthorization?: {
    merchantName?: string;
    merchantId?: string;
    cardId?: string;
    currencyAmount?: Money;
  };
  transactions?: Array<{
    id: string;
    bookingDate?: string;
    description?: string;
    transactionAmount?: Money;
    currencyAmount?: Money;
  }>;
  attachments?: FolioAttachmentMeta[];
  purpose?: string;
  note?: string;
  ledgerCategory?: { id: string; eTag?: string };
  [key: string]: unknown;
};

export type EventGaps = {
  incomplete: boolean;
  missingReceipt: boolean;
  missingPurpose: boolean;
  missingCategory: boolean;
};

export function eventGaps(event: FolioEvent): EventGaps {
  return {
    incomplete: event.complete === false,
    missingReceipt: (event.attachments?.length ?? 0) === 0,
    missingPurpose: !event.purpose?.trim(),
    missingCategory: !event.ledgerCategory?.id,
  };
}

export function hasDocumentationGap(event: FolioEvent): boolean {
  const gaps = eventGaps(event);
  return gaps.incomplete || gaps.missingReceipt;
}

function isEventWrapper(payload: unknown): payload is { event: FolioEvent } {
  if (!payload || typeof payload !== "object" || !("event" in payload)) {
    return false;
  }
  const event = (payload as { event: unknown }).event;
  return !!event && typeof event === "object" && "id" in event;
}

export type EventsResponse = {
  events: FolioEvent[];
  includes?: unknown;
};

export type FolioAccount = {
  accountNumber: string;
  balance?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
};

export type FolioCategory = {
  accountName?: string;
  accountNumber?: number;
  isIncoming?: boolean;
  requiresParticipants?: boolean;
  requiresPurpose?: boolean;
  requiresAttachment?: boolean;
  title?: string;
  vatCode?: number;
  vatRate?: number;
  vatTitle?: string;
  [key: string]: unknown;
};

export type FolioPaymentDraft = {
  creditor: { name: string; accountNumber: string };
  debtorAccountNumber: string;
  currencyAmount: Money;
  executionDate: string;
  kid?: string;
  message?: string;
  foreignPaymentInfo?: Record<string, unknown>;
};

export type AttachmentVariant = "original" | "cropped" | "128x128" | "256x256" | "512x512";

export type UploadAttachmentInput = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

export type FolioClientOptions = {
  auth: AuthProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
};


async function responseText(response: Response): Promise<string> {
  try { return await response.text(); } catch { throw new Error("Folio response could not be read. Check the vendor before retrying a write."); }
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  try { return new Uint8Array(await response.arrayBuffer()); } catch { throw new Error("Folio attachment response could not be read."); }
}

export class FolioClient {
  private readonly auth: AuthProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FolioClientOptions) {
    this.auth = options.auth;
    this.baseUrl = (options.baseUrl ?? DEFAULT_FOLIO_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listEvents(params: {
    startDate: string;
    endDate?: string;
    includeMerchants?: boolean;
    includeCards?: boolean;
  }): Promise<EventsResponse> {
    const query = new URLSearchParams({ startDate: params.startDate });
    if (params.endDate) query.set("endDate", params.endDate);
    if (params.includeMerchants !== false) query.set("includeMerchants", "true");
    if (params.includeCards !== false) query.set("includeCards", "true");
    return this.json<EventsResponse>(`/events?${query.toString()}`);
  }

  async getEvent(id: string): Promise<FolioEvent> {
    const query = new URLSearchParams({
      includeMerchants: "true",
      includeCards: "true",
    });
    const payload: unknown = await this.json(
      `/events/${id}?${query.toString()}`,
    );
    if (isEventWrapper(payload)) {
      return payload.event;
    }
    return payload as FolioEvent;
  }

  async listTransactions(params: {
    startDate: string;
    endDate?: string;
    includeMerchants?: boolean;
  }): Promise<unknown> {
    const query = new URLSearchParams({ startDate: params.startDate });
    if (params.endDate) query.set("endDate", params.endDate);
    if (params.includeMerchants !== false) query.set("includeMerchants", "true");
    return this.json(`/transactions?${query.toString()}`);
  }

  async getTransaction(id: string): Promise<unknown> {
    return this.json(`/transactions/${id}`);
  }

  async listAccounts(): Promise<{ accounts: FolioAccount[] }> {
    return this.json("/accounts");
  }

  async listAccountTransactions(
    accountNumber: string,
    params: { startDate: string; endDate?: string },
  ): Promise<unknown> {
    const query = new URLSearchParams({ startDate: params.startDate });
    if (params.endDate) query.set("endDate", params.endDate);
    return this.json(
      `/accounts/${encodeURIComponent(accountNumber)}/transactions?${query.toString()}`,
    );
  }

  async getAccountBalance(accountNumber: string, date: string): Promise<unknown> {
    return this.json(
      `/accounts/${encodeURIComponent(accountNumber)}/balance/${date}`,
    );
  }

  async listPayments(params: {
    startDate: string;
    endDate?: string;
    includeAgents?: boolean;
  }): Promise<unknown> {
    const query = new URLSearchParams({ startDate: params.startDate });
    if (params.endDate) query.set("endDate", params.endDate);
    if (params.includeAgents) query.set("includeAgents", "true");
    return this.json(`/payments?${query.toString()}`);
  }

  async getPayment(id: string): Promise<unknown> {
    return this.json(`/payments/${id}`);
  }

  async createPayment(draft: FolioPaymentDraft): Promise<{ id: string; eventId?: string }> {
    return this.json("/payments", { method: "POST", body: JSON.stringify(draft) });
  }

  async deletePayment(id: string): Promise<void> {
    await this.json(`/payments/${id}`, { method: "DELETE" });
  }

  async uploadAttachment(
    eventId: string,
    file: UploadAttachmentInput,
  ): Promise<{ id: string }> {
    const url = `${this.baseUrl}/events/${eventId}/attachments`;
    const response = await this.send(url, {
      method: "POST",
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      },
      body: file.bytes,
    });
    return this.parseJson(response, url);
  }

  async updateEvent(
    eventId: string,
    fields: {
      purpose?: string;
      note?: string;
      participants?: string;
      ledgerCategoryId?: string;
    },
  ): Promise<void> {
    await this.json(`/events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  }

  async markComplete(eventId: string): Promise<void> {
    await this.json(`/events/${eventId}/complete`, { method: "POST" });
  }

  async markIncomplete(eventId: string): Promise<void> {
    await this.json(`/events/${eventId}/complete`, { method: "DELETE" });
  }

  async getCategory(id: string): Promise<FolioCategory> {
    return this.json(`/categories/${encodeURIComponent(id)}`);
  }

  async downloadAttachment(
    id: string,
    type: AttachmentVariant = "original",
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = `${this.baseUrl}/attachments/${id}/${type}`;
    const response = await this.send(url);
    if (!response.ok) {
      const body = await responseText(response);
      throw new FolioApiError(response.status, url, body);
    }
    const bytes = await responseBytes(response);
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async getStatement(startDate: string, endDate: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    return this.downloadPdf(`/statement?startDate=${startDate}&endDate=${endDate}`);
  }

  async getStatementMonth(year: number, month: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    return this.downloadPdf(`/statement/${year}/${month}`);
  }

  async disableIntegration(): Promise<void> {
    await this.json("/integration/disable", { method: "POST" });
  }

  private async downloadPdf(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.send(url);
    if (!response.ok) {
      const body = await responseText(response);
      throw new FolioApiError(response.status, url, body);
    }
    const bytes = await responseBytes(response);
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? "application/pdf",
    };
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await this.send(url, { ...init, headers });
    return this.parseJson<T>(response, url);
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
      throw new Error("Folio request failed before receiving a response. Check the connection before retrying a write.");
    }
  }

  private async parseJson<T>(response: Response, url: string): Promise<T> {
    const body = await responseText(response);
    if (!response.ok) {
      throw new FolioApiError(response.status, url, body);
    }
    if (!body) {
      return {} as T;
    }
    try { return JSON.parse(body) as T; } catch { throw new Error("Folio returned an invalid JSON response."); }
  }
}
