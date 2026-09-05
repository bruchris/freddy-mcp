import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { z } from "zod";
import {
  eventGaps,
  FolioApiError,
  hasDocumentationGap,
  type FolioAttachmentMeta,
  type FolioClient,
  type FolioEvent,
} from "./client.js";

export const SERVER_NAME = "folio-mcp-server";
export const SERVER_VERSION = "0.1.0";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof FolioApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function attachmentSummary(attachment: FolioAttachmentMeta) {
  return {
    id: attachment.id,
    filename: attachment.filename ?? null,
    mimeType: attachment.mimeType ?? null,
    fileSize: attachment.fileSize ?? null,
    hasExtractedText: Boolean(attachment.extractedText?.trim()),
  };
}

function summarizeEvent(event: FolioEvent) {
  const tx = event.transactions?.[0];
  const gaps = eventGaps(event);
  return {
    id: event.id,
    complete: event.complete ?? false,
    gaps,
    time: event.time,
    merchant: event.cardAuthorization?.merchantName,
    bookingDate: tx?.bookingDate,
    nok: tx?.transactionAmount,
    original: tx?.currencyAmount ?? event.cardAuthorization?.currencyAmount ?? event.amount,
    purpose: event.purpose ?? null,
    note: event.note ?? null,
    ledgerCategoryId: event.ledgerCategory?.id ?? null,
    attachments: (event.attachments ?? []).map(attachmentSummary),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function mimeTypeOf(contentType: string): string {
  return contentType.split(";")[0]?.trim() || "application/octet-stream";
}

async function receiptToolResult(options: {
  attachmentId: string;
  filename?: string;
  bytes: Uint8Array;
  contentType: string;
  destPath?: string;
  eventId?: string;
}): Promise<CallToolResult> {
  const mimeType = mimeTypeOf(options.contentType);
  if (options.destPath) {
    await mkdir(dirname(options.destPath), { recursive: true });
    await writeFile(options.destPath, options.bytes);
  }
  const meta = {
    eventId: options.eventId ?? null,
    attachmentId: options.attachmentId,
    filename: options.filename ?? null,
    mimeType,
    bytes: options.bytes.byteLength,
    path: options.destPath ?? null,
    hint: "Read this receipt yourself. Do not ask the adapter to parse invoice fields.",
  };
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(meta, null, 2) },
  ];
  if (mimeType.startsWith("image/")) {
    content.push({ type: "image", mimeType, data: bytesToBase64(options.bytes) });
  } else {
    content.push({
      type: "resource",
      resource: {
        uri: `folio://attachments/${options.attachmentId}`,
        mimeType,
        blob: bytesToBase64(options.bytes),
      },
    });
  }
  return { content };
}

export function createServer(folio: FolioClient, options: { allowLocalFiles?: boolean } = {}): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "folio_list_events",
    {
      title: "List Folio events",
      description:
        "List Folio card events. Use folio_get_event then folio_download_attachment to read the receipt yourself (supplier, invoice no, line text). incomplete=true is Folio complete=false. missingReceipt=true is no attachments. gaps=true is either. Do not also upload the same file to Fiken Innboks.",
      inputSchema: z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Inclusive start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive end date YYYY-MM-DD"),
        incomplete: z
          .boolean()
          .optional()
          .describe("If true, only events Folio marks complete=false"),
        missingReceipt: z.boolean().optional().describe("If true, only events with no attachments"),
        gaps: z
          .boolean()
          .optional()
          .describe("If true, incomplete or missing receipt"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ startDate, endDate, incomplete, missingReceipt, gaps }) => {
      try {
        const data = await folio.listEvents({ startDate, endDate });
        let events = data.events;
        if (gaps) {
          events = events.filter(hasDocumentationGap);
        } else {
          if (incomplete) {
            events = events.filter((e) => eventGaps(e).incomplete);
          }
          if (missingReceipt) {
            events = events.filter((e) => eventGaps(e).missingReceipt);
          }
        }
        return jsonResult({
          count: events.length,
          events: events.map(summarizeEvent),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_upload_attachment",
    {
      title: "Upload Folio receipt",
      description:
        "Upload a local PDF/PNG/JPEG onto a Folio event. After upload, download it again if you need to read fields. Do not also POST the file to Fiken Innboks.",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        eventId: z.string().describe("Folio event UUID"),
        path: z.string().describe("Absolute path to a .pdf, .png, or .jpg file on this machine"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_upload_attachment", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { eventId, path } = input;
      try {
        if (options.allowLocalFiles === false) return errorResult(new Error("Local file access is disabled on this server."));
        const ext = extname(path).toLowerCase();
        const contentType = MIME_BY_EXT[ext];
        if (!contentType) {
          return errorResult(new Error("Upload only .pdf, .png, or .jpg/.jpeg files"));
        }
        const bytes = new Uint8Array(await readFile(path));
        const uploaded = await folio.uploadAttachment(eventId, {
          bytes,
          filename: basename(path),
          contentType,
        });
        return jsonResult({
          eventId,
          attachmentId: uploaded.id,
          filename: basename(path),
          bytes: bytes.byteLength,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const write = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  server.registerTool(
    "folio_get_event",
    {
      title: "Get Folio event",
      description:
        "Get one Folio event: amounts, booking date, category id, and attachment metadata. Includes Folio OCR extractedText when present (raw, unparsed). Call folio_download_attachment to fetch the PDF/image and read supplier, invoice number, and line description yourself.",
      inputSchema: z.object({ eventId: z.string() }),
      annotations: read,
    },
    async ({ eventId }) => {
      try {
        const event = await folio.getEvent(eventId);
        const category = event.ledgerCategory?.id
          ? await folio.getCategory(event.ledgerCategory.id)
          : null;
        return jsonResult({
          ...summarizeEvent(event),
          category,
          attachments: (event.attachments ?? []).map((attachment) => ({
            ...attachmentSummary(attachment),
            extractedText: attachment.extractedText ?? null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_download_attachment",
    {
      title: "Download Folio receipt",
      description:
        "Fetch receipt bytes for the model to read. Pass eventId (first attachment) and/or attachmentId. Returns the PDF/image in the tool result. Optional destPath writes a local copy for fiken_attach_to_purchase. Do not parse receipts in this package; interpret the file yourself.",
      inputSchema: z.object({
        eventId: z.string().optional().describe("Folio event UUID; uses the first attachment if attachmentId is omitted"),
        attachmentId: z.string().optional().describe("Folio attachment id from folio_get_event"),
        destPath: z
          .string()
          .optional()
          .describe("Optional absolute path to also write the file"),
        variant: z
          .enum(["original", "cropped", "128x128", "256x256", "512x512"])
          .optional()
          .describe("Image variant; default original"),
      }),
      annotations: read,
    },
    async ({ eventId, attachmentId, destPath, variant }) => {
      try {
        if (destPath !== undefined && options.allowLocalFiles === false) return errorResult(new Error("Local file access is disabled on this server."));
        if (!eventId && !attachmentId) {
          return errorResult(new Error("Pass eventId and/or attachmentId"));
        }
        let id = attachmentId;
        let filename: string | undefined;
        if (eventId) {
          const event = await folio.getEvent(eventId);
          const match = id
            ? event.attachments?.find((a) => a.id === id)
            : event.attachments?.[0];
          if (!match?.id) {
            return errorResult(new Error(`No attachment on event ${eventId}`));
          }
          id = match.id;
          filename = match.filename;
        }
        if (!id) {
          return errorResult(new Error("Pass eventId and/or attachmentId"));
        }
        const file = await folio.downloadAttachment(id, variant ?? "original");
        return receiptToolResult({
          attachmentId: id,
          filename,
          bytes: file.bytes,
          contentType: file.contentType,
          destPath,
          eventId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_update_event",
    {
      title: "Update Folio event",
      description: "PATCH purpose, note, participants, and/or ledgerCategoryId. Empty string clears purpose/note/participants.",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        eventId: z.string(),
        purpose: z.string().optional(),
        note: z.string().optional(),
        participants: z.string().optional(),
        ledgerCategoryId: z.string().optional(),
      }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_update_event", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { eventId, ...fields } = input;
      try {
        await folio.updateEvent(eventId, fields);
        return jsonResult({ eventId, updated: true });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_complete_event",
    {
      title: "Mark Folio event complete",
      description: "POST /events/{id}/complete after receipt and category are set.",
      inputSchema: z.object({ confirm: z.boolean().optional().describe("Set true only after the user approves the preview."), eventId: z.string() }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_complete_event", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { eventId } = input;
      try {
        await folio.markComplete(eventId);
        const event = await folio.getEvent(eventId);
        return jsonResult({ eventId, complete: event.complete ?? false });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_uncomplete_event",
    {
      title: "Mark Folio event incomplete",
      description: "DELETE /events/{id}/complete.",
      inputSchema: z.object({ confirm: z.boolean().optional().describe("Set true only after the user approves the preview."), eventId: z.string() }),
      annotations: { ...write, destructiveHint: true },
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_uncomplete_event", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { eventId } = input;
      try {
        await folio.markIncomplete(eventId);
        return jsonResult({ eventId, complete: false });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_list_accounts",
    {
      title: "List Folio accounts",
      description: "List Folio bank and card accounts and balances.",
      inputSchema: z.object({}),
      annotations: read,
    },
    async () => {
      try {
        return jsonResult(await folio.listAccounts());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_get_balance",
    {
      title: "Get Folio account balance",
      description: "Balance for an account number on a date (YYYY-MM-DD).",
      inputSchema: z.object({
        accountNumber: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      annotations: read,
    },
    async ({ accountNumber, date }) => {
      try {
        return jsonResult(await folio.getAccountBalance(accountNumber, date));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_list_transactions",
    {
      title: "List Folio transactions",
      description: "Booked transactions in a date range.",
      inputSchema: z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      annotations: read,
    },
    async ({ startDate, endDate }) => {
      try {
        return jsonResult(await folio.listTransactions({ startDate, endDate }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_get_category",
    {
      title: "Get Folio ledger category",
      description: "Category title, Fiken-style accountNumber, and VAT fields.",
      inputSchema: z.object({ categoryId: z.string() }),
      annotations: read,
    },
    async ({ categoryId }) => {
      try {
        return jsonResult(await folio.getCategory(categoryId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_list_payments",
    {
      title: "List Folio payment drafts",
      description: "List payments (Folio keeps API-created payments as drafts until approved in the app).",
      inputSchema: z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      annotations: read,
    },
    async ({ startDate, endDate }) => {
      try {
        return jsonResult(await folio.listPayments({ startDate, endDate }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_create_payment",
    {
      title: "Create Folio payment draft",
      description: "Create a payment draft only. Money still needs approval in the Folio app.",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        creditorName: z.string(),
        creditorAccountNumber: z.string(),
        debtorAccountNumber: z.string(),
        amount: z.string(),
        currency: z.string().default("NOK"),
        executionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        message: z.string().optional(),
        kid: z.string().optional(),
      }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_create_payment", input, next: "Obtain user approval, then repeat these fields with confirm=true." });

      try {
        const created = await folio.createPayment({
          creditor: {
            name: input.creditorName,
            accountNumber: input.creditorAccountNumber,
          },
          debtorAccountNumber: input.debtorAccountNumber,
          currencyAmount: { amount: input.amount, currency: input.currency },
          executionDate: input.executionDate,
          message: input.message,
          kid: input.kid,
        });
        return jsonResult({ ...created, draft: true });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "folio_cancel_payment",
    {
      title: "Cancel Folio payment draft",
      description: "DELETE a payment draft by id.",
      inputSchema: z.object({ confirm: z.boolean().optional().describe("Set true only after the user approves the preview."), paymentId: z.string() }),
      annotations: { ...write, destructiveHint: true },
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "folio_cancel_payment", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { paymentId } = input;
      try {
        await folio.deletePayment(paymentId);
        return jsonResult({ paymentId, cancelled: true });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
