#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { runFikenBrowserLogin } from "./auth.js";
import { fikenClientFromEnv } from "./env.js";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const command = process.argv[2];
  if (["purchase","delete-purchase","attach"].includes(command ?? "") && !hasFlag("--confirm")) {
    throw new Error("Refusing to write without --confirm");
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log("Usage: fiken <login|companies|accounts|bank-accounts|contacts|contact|purchases|get-purchase|purchase|delete-purchase|attach> ...");
    return;
  }
  if (command === "login") {
    await runFikenBrowserLogin();
    return;
  }
  if (command === "purchase") {
    required("--payment-date");
    required("--payment-account");
    const amount = Number(required("--payment-nok"));
    if (!Number.isSafeInteger(amount)) throw new Error("--payment-nok must be exact integer NOK ore from the Folio booking");
    required("--vat");
  }
  const fiken = await fikenClientFromEnv();
  if (command === "companies") {
    console.log(JSON.stringify(await fiken.listCompanies(), null, 2));
    return;
  }
  if (command === "accounts") {
    const slug = required("--company");
    const search = arg("--search")?.toLowerCase();
    let accounts = await fiken.listAccounts(slug);
    if (search) {
      accounts = accounts.filter((a) =>
        `${a.code ?? ""} ${a.name ?? ""}`.toLowerCase().includes(search),
      );
    }
    console.log(JSON.stringify(accounts, null, 2));
    return;
  }
  if (command === "bank-accounts") {
    console.log(JSON.stringify(await fiken.listBankAccounts(required("--company")), null, 2));
    return;
  }
  if (command === "contacts") {
    const slug = required("--company");
    const name = arg("--search") ?? arg("--name");
    console.log(JSON.stringify(await fiken.listContacts(slug, { name, email: arg("--email") }), null, 2));
    return;
  }
  if (command === "contact") {
    console.log(
      JSON.stringify(
        await fiken.getContact(required("--company"), Number(required("--contact-id"))),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "purchases") {
    console.log(
      JSON.stringify(
        await fiken.listPurchases(required("--company"), {
          date: arg("--date"),
          dateGe: arg("--from"),
          dateLe: arg("--to"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "get-purchase") {
    console.log(
      JSON.stringify(
        await fiken.getPurchase(required("--company"), Number(required("--purchase-id"))),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "delete-purchase") {
    if (!hasFlag("--confirm")) {
      throw new Error("Refusing to delete without --confirm");
    }
    const purchaseId = Number(required("--purchase-id"));
    await fiken.deletePurchase(required("--company"), purchaseId, arg("--reason") ?? "rebook");
    console.log(JSON.stringify({ deleted: true, purchaseId }, null, 2));
    return;
  }
  if (command === "purchase") {
    if (!hasFlag("--confirm")) {
      throw new Error("Refusing to book without --confirm");
    }
    const created = await fiken.createPurchase(required("--company"), {
      identifier: arg("--identifier"),
      date: required("--date"),
      kind: (arg("--kind") as "cash_purchase" | "supplier") ?? "cash_purchase",
      paid: true,
      currency: required("--currency"),
      paymentAccount: required("--payment-account"),
      paymentDate: required("--payment-date"),
      paymentAmountInNok: Number(required("--payment-nok")),
      supplierId: arg("--supplier-id") ? Number(arg("--supplier-id")) : undefined,
      lines: [
        {
          description: required("--description"),
          vatType: required("--vat"),
          account: arg("--account"),
          netPrice: arg("--net") ? Number(arg("--net")) : undefined,
          vat: arg("--vat-ore") ? Number(arg("--vat-ore")) : undefined,
          netPriceInCurrency: arg("--net-currency") ? Number(arg("--net-currency")) : undefined,
          vatInCurrency: arg("--vat-currency") ? Number(arg("--vat-currency")) : undefined,
        },
      ],
    });
    console.log(JSON.stringify(created, null, 2));
    return;
  }
  if (command === "attach") {
    const path = required("--file");
    const ext = extname(path).toLowerCase();
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) throw new Error("Attach only .pdf, .png, .jpg/.jpeg, or .gif");
    const bytes = new Uint8Array(await readFile(path));
    const uploaded = await fiken.attachToPurchase(
      required("--company"),
      Number(required("--purchase-id")),
      { bytes, filename: basename(path), contentType },
    );
    console.log(JSON.stringify({ filename: basename(path), ...uploaded }, null, 2));
    return;
  }
  throw new Error(
    "Usage: fiken <login|companies|accounts|bank-accounts|contacts|contact|purchases|get-purchase|purchase|delete-purchase|attach> ...",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
