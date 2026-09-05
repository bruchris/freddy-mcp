import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import { FikenApiError, type FikenClient } from "./client.js";

export const SERVER_NAME = "fiken-mcp-server";
export const SERVER_VERSION = "0.1.0";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof FikenApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function createServer(fiken: FikenClient, options: { allowLocalFiles?: boolean } = {}): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "fiken_list_companies",
    {
      title: "List Fiken companies",
      description: "List companies the token can access. Use slug on later calls.",
      inputSchema: z.object({}),
      annotations: read,
    },
    async () => {
      try {
        return jsonResult(await fiken.listCompanies());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_list_accounts",
    {
      title: "List Fiken accounts",
      description: "Chart of accounts. Optional fromAccount/toAccount range (e.g. 6500-6599).",
      inputSchema: z.object({
        companySlug: z.string(),
        fromAccount: z.string().optional(),
        toAccount: z.string().optional(),
      }),
      annotations: read,
    },
    async ({ companySlug, fromAccount, toAccount }) => {
      try {
        return jsonResult(await fiken.listAccounts(companySlug, { fromAccount, toAccount }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_list_bank_accounts",
    {
      title: "List Fiken bank accounts",
      description: "Bank/card accounts with accountCode for paymentAccount (e.g. 1920:10001).",
      inputSchema: z.object({ companySlug: z.string() }),
      annotations: read,
    },
    async ({ companySlug }) => {
      try {
        return jsonResult(await fiken.listBankAccounts(companySlug));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_list_purchases",
    {
      title: "List Fiken purchases",
      description: "List purchases, optionally filtered by date (YYYY-MM-DD).",
      inputSchema: z.object({
        companySlug: z.string(),
        date: z.string().optional(),
        dateGe: z.string().optional(),
        dateLe: z.string().optional(),
      }),
      annotations: read,
    },
    async ({ companySlug, ...params }) => {
      try {
        return jsonResult(await fiken.listPurchases(companySlug, params));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_get_purchase",
    {
      title: "Get Fiken purchase",
      description:
        "Get one booked purchase. Use this to copy how similar charges were booked (supplier, identifier, vatType, description) after you have read the new receipt yourself.",
      inputSchema: z.object({
        companySlug: z.string(),
        purchaseId: z.number().int(),
      }),
      annotations: read,
    },
    async ({ companySlug, purchaseId }) => {
      try {
        return jsonResult(await fiken.getPurchase(companySlug, purchaseId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const purchaseFields = {
    companySlug: z.string(),
    identifier: z.string().optional(),
    date: z.string(),
    kind: z.enum(["cash_purchase", "supplier"]).default("cash_purchase"),
    paid: z.boolean().default(true),
    currency: z.string(),
    paymentAccount: z.string().optional(),
    paymentDate: z.string().optional(),
    paymentAmountInNok: z.number().int().optional(),
    supplierId: z.number().int().optional(),
    description: z.string(),
    vatType: z.string(),
    account: z.string().optional(),
    netPrice: z.number().int().optional(),
    vat: z.number().int().optional(),
    netPriceInCurrency: z.number().int().optional(),
    vatInCurrency: z.number().int().optional(),
  };

  server.registerTool(
    "fiken_preview_purchase",
    {
      title: "Preview Fiken purchase",
      description:
        "Read-only echo of the purchase payload. You fill identifier, supplierId, description, dates, and vatType from the receipt and from similar existing purchases. Call fiken_create_purchase to book. Folio booking date and exact NOK øre for payment. Do not upload the receipt to Innboks.",
      inputSchema: z.object(purchaseFields),
      annotations: read,
    },
    async (input) => jsonResult({ preview: true, ...input }),
  );

  server.registerTool(
    "fiken_create_purchase",
    {
      title: "Create Fiken purchase",
      description:
        "Book a purchase. Amounts in øre. You (the model) must set identifier, supplierId, kind, description, date, paymentDate, and vatType after reading the receipt and comparing existing purchases. Adapters do not parse receipts or pick suppliers.",
      inputSchema: z.object({ ...purchaseFields, confirm: z.boolean().optional().describe("Set true only after the user approves the preview.") }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "fiken_create_purchase", input, next: "Obtain user approval, then repeat these fields with confirm=true." });

      try {
        if (input.paid && (!input.paymentDate || !input.paymentAccount || input.paymentAmountInNok === undefined)) {
          return errorResult(new Error("Paid purchases require paymentDate, paymentAccount, and paymentAmountInNok from the Folio booking. Never infer these from the invoice date or FX."));
        }
        const created = await fiken.createPurchase(input.companySlug, {
          identifier: input.identifier,
          date: input.date,
          kind: input.kind,
          paid: input.paid,
          currency: input.currency,
          paymentAccount: input.paymentAccount,
          paymentDate: input.paymentDate,
          paymentAmountInNok: input.paymentAmountInNok,
          supplierId: input.supplierId,
          lines: [
            {
              description: input.description,
              vatType: input.vatType,
              account: input.account,
              netPrice: input.netPrice,
              vat: input.vat,
              netPriceInCurrency: input.netPriceInCurrency,
              vatInCurrency: input.vatInCurrency,
            },
          ],
        });
        return jsonResult(created);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_attach_to_purchase",
    {
      title: "Attach file to Fiken purchase",
      description: "Attach a local PDF/image to a purchase (not Innboks).",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        companySlug: z.string(),
        purchaseId: z.number().int(),
        path: z.string(),
      }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "fiken_attach_to_purchase", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { companySlug, purchaseId, path } = input;
      try {
        if (options.allowLocalFiles === false) return errorResult(new Error("Local file access is disabled on this server."));
        const ext = extname(path).toLowerCase();
        const contentType = MIME_BY_EXT[ext];
        if (!contentType) {
          return errorResult(new Error("Attach only .pdf, .png, .jpg/.jpeg, or .gif"));
        }
        const bytes = new Uint8Array(await readFile(path));
        const uploaded = await fiken.attachToPurchase(companySlug, purchaseId, {
          bytes,
          filename: basename(path),
          contentType,
        });
        return jsonResult({
          purchaseId,
          filename: basename(path),
          bytes: bytes.byteLength,
          location: uploaded.location,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_list_contacts",
    {
      title: "List Fiken contacts",
      description:
        "Search contacts by name or email. You pick the matching supplier contactId after reading the receipt. Do not hardcode vendor aliases in this package.",
      inputSchema: z.object({
        companySlug: z.string(),
        name: z.string().optional(),
        email: z.string().optional(),
      }),
      annotations: read,
    },
    async ({ companySlug, name, email }) => {
      try {
        return jsonResult(await fiken.listContacts(companySlug, { name, email }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_get_contact",
    {
      title: "Get Fiken contact",
      description: "Get one contact by id.",
      inputSchema: z.object({
        companySlug: z.string(),
        contactId: z.number().int(),
      }),
      annotations: read,
    },
    async ({ companySlug, contactId }) => {
      try {
        return jsonResult(await fiken.getContact(companySlug, contactId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_create_contact",
    {
      title: "Create Fiken contact",
      description:
        "Create a supplier/customer when none exists. Use after you have read the receipt and searched fiken_list_contacts.",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        companySlug: z.string(),
        name: z.string(),
        email: z.string().optional(),
        supplier: z.boolean().optional(),
        customer: z.boolean().optional(),
        organizationNumber: z.string().optional(),
        streetAddress: z.string().optional(),
        streetAddressLine2: z.string().optional(),
        city: z.string().optional(),
        postCode: z.string().optional(),
        country: z.string().optional(),
      }),
      annotations: write,
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "fiken_create_contact", input, next: "Obtain user approval, then repeat these fields with confirm=true." });

      try {
        const created = await fiken.createContact(input.companySlug, {
          name: input.name,
          email: input.email,
          supplier: input.supplier ?? true,
          customer: input.customer ?? false,
          organizationNumber: input.organizationNumber,
          address:
            input.streetAddress || input.city || input.postCode || input.country
              ? {
                  streetAddress: input.streetAddress,
                  streetAddressLine2: input.streetAddressLine2,
                  city: input.city,
                  postCode: input.postCode,
                  country: input.country,
                }
              : undefined,
        });
        return jsonResult(created);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fiken_delete_purchase",
    {
      title: "Delete Fiken purchase",
      description: "Soft-delete a purchase (PATCH .../delete). Requires a reason. Use before rebooking a bad entry.",
      inputSchema: z.object({
        confirm: z.boolean().optional().describe("Set true only after the user approves the preview."),
        companySlug: z.string(),
        purchaseId: z.number().int(),
        description: z.string().describe("Reason shown in Fiken"),
      }),
      annotations: { ...write, destructiveHint: true },
    },
    async (args) => {
      const { confirm, ...input } = args;
      if (confirm !== true) return jsonResult({ preview: true, tool: "fiken_delete_purchase", input, next: "Obtain user approval, then repeat these fields with confirm=true." });
      const { companySlug, purchaseId, description } = input;
      try {
        await fiken.deletePurchase(companySlug, purchaseId, description);
        return jsonResult({ deleted: true, purchaseId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
