#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { eventGaps, hasDocumentationGap, type FolioClient } from "./client.js";
import { runFolioBrowserLogin } from "./auth.js";
import { folioClientFromEnv } from "./env.js";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function gapLabels(event: Parameters<typeof eventGaps>[0]): string {
  const gaps = eventGaps(event);
  const labels: string[] = [];
  if (gaps.incomplete) labels.push("incomplete");
  if (gaps.missingReceipt) labels.push("receipt");
  if (gaps.missingPurpose) labels.push("purpose");
  if (gaps.missingCategory) labels.push("category");
  return labels.length ? labels.join(",") : "ok";
}

async function eventsCommand() {
  const from = arg("--from");
  if (!from) {
    throw new Error(
      "Usage: folio events --from YYYY-MM-DD [--to YYYY-MM-DD] [--incomplete] [--missing-receipt] [--gaps]",
    );
  }
  const folio = await folioClientFromEnv();
  const data = await folio.listEvents({ startDate: from, endDate: arg("--to") });
  const incompleteOnly = hasFlag("--incomplete");
  const missingReceiptOnly = hasFlag("--missing-receipt");
  const gapsOnly = hasFlag("--gaps");
  const events = data.events.filter((event) => {
    const gaps = eventGaps(event);
    if (gapsOnly) return hasDocumentationGap(event);
    if (incompleteOnly && !gaps.incomplete) return false;
    if (missingReceiptOnly && !gaps.missingReceipt) return false;
    return true;
  });
  for (const event of events) {
    const merchant = event.cardAuthorization?.merchantName ?? "";
    const tx = event.transactions?.[0];
    const nok = tx?.transactionAmount
      ? `${tx.transactionAmount.amount} ${tx.transactionAmount.currency}`
      : "";
    console.log(
      [
        event.id,
        tx?.bookingDate ?? event.time ?? "",
        merchant,
        nok,
        gapLabels(event),
      ]
        .filter((part) => part !== "")
        .join("\t"),
    );
  }
  console.error(`${events.length} event(s) of ${data.events.length} in range`);
}

async function attachCommand() {
  const eventId = process.argv[3];
  const filePath = process.argv[4];
  if (!eventId || !filePath) {
    throw new Error("Usage: folio attach <eventId> <file>");
  }
  const folio = await folioClientFromEnv();
  const uploaded = await uploadFile(folio, eventId, filePath);
  console.log(JSON.stringify({ eventId, attachmentId: uploaded.id, filename: basename(filePath) }, null, 2));
}

async function uploadFile(
  folio: FolioClient,
  eventId: string,
  filePath: string,
) {
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    throw new Error("Upload only .pdf, .png, or .jpg/.jpeg files");
  }
  const bytes = new Uint8Array(await readFile(filePath));
  return folio.uploadAttachment(eventId, {
    bytes,
    filename: basename(filePath),
    contentType,
  });
}

async function finishCommand() {
  const eventId = process.argv[3];
  const filePath = process.argv[4];
  if (!eventId || !filePath) {
    throw new Error(
      "Usage: folio finish <eventId> <file> [--category-from <eventId>]",
    );
  }
  const folio = await folioClientFromEnv();
  const before = await folio.getEvent(eventId);
  const uploaded = await uploadFile(folio, eventId, filePath);
  const categoryFrom = arg("--category-from");
  if (categoryFrom) {
    const source = await folio.getEvent(categoryFrom);
    const categoryId = source.ledgerCategory?.id;
    if (!categoryId) {
      throw new Error(`Source event ${categoryFrom} has no ledger category`);
    }
    await folio.updateEvent(eventId, { ledgerCategoryId: categoryId });
  }
  let after = await folio.getEvent(eventId);
  if (after.complete !== true) {
    await folio.markComplete(eventId);
    after = await folio.getEvent(eventId);
  }
  console.log(
    JSON.stringify(
      {
        eventId,
        merchant: after.cardAuthorization?.merchantName ?? before.cardAuthorization?.merchantName,
        attachmentId: uploaded.id,
        filename: basename(filePath),
        completeBefore: before.complete ?? false,
        completeAfter: after.complete ?? false,
        gaps: eventGaps(after),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const command = process.argv[2];
  if (["attach","finish","complete","uncomplete"].includes(command ?? "") && !hasFlag("--confirm")) {
    throw new Error("Refusing to write without --confirm");
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log("Usage: folio <login|events|event|attach|finish|download|accounts|transactions|category|complete|uncomplete|payments> ...");
    return;
  }
  if (command === "login") {
    await runFolioBrowserLogin();
    return;
  }
  if (command === "events") {
    await eventsCommand();
    return;
  }
  if (command === "attach") {
    await attachCommand();
    return;
  }
  if (command === "finish") {
    await finishCommand();
    return;
  }
  if (command === "event") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("Usage: folio event <eventId>");
    const folio = await folioClientFromEnv();
    const event = await folio.getEvent(eventId);
    const category = event.ledgerCategory?.id
      ? await folio.getCategory(event.ledgerCategory.id)
      : null;
    console.log(JSON.stringify({ event, category, gaps: eventGaps(event) }, null, 2));
    return;
  }
  if (command === "accounts") {
    const folio = await folioClientFromEnv();
    console.log(JSON.stringify(await folio.listAccounts(), null, 2));
    return;
  }
  if (command === "transactions") {
    const from = arg("--from");
    if (!from) throw new Error("Usage: folio transactions --from YYYY-MM-DD [--to YYYY-MM-DD]");
    const folio = await folioClientFromEnv();
    console.log(JSON.stringify(await folio.listTransactions({ startDate: from, endDate: arg("--to") }), null, 2));
    return;
  }
  if (command === "category") {
    const id = process.argv[3];
    if (!id) throw new Error("Usage: folio category <categoryId>");
    const folio = await folioClientFromEnv();
    console.log(JSON.stringify(await folio.getCategory(id), null, 2));
    return;
  }
  if (command === "complete") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("Usage: folio complete <eventId>");
    const folio = await folioClientFromEnv();
    await folio.markComplete(eventId);
    const event = await folio.getEvent(eventId);
    console.log(JSON.stringify({ eventId, complete: event.complete ?? false }, null, 2));
    return;
  }
  if (command === "uncomplete") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("Usage: folio uncomplete <eventId>");
    const folio = await folioClientFromEnv();
    await folio.markIncomplete(eventId);
    console.log(JSON.stringify({ eventId, complete: false }, null, 2));
    return;
  }
  if (command === "payments") {
    const from = arg("--from");
    if (!from) throw new Error("Usage: folio payments --from YYYY-MM-DD [--to YYYY-MM-DD]");
    const folio = await folioClientFromEnv();
    console.log(JSON.stringify(await folio.listPayments({ startDate: from, endDate: arg("--to") }), null, 2));
    return;
  }
  if (command === "download") {
    const out = arg("--out");
    if (!out) {
      throw new Error(
        "Usage: folio download --out <file> [--event <eventId>] [--attachment <attachmentId>]",
      );
    }
    const folio = await folioClientFromEnv();
    let attachmentId = arg("--attachment");
    let filename: string | undefined;
    const eventId = arg("--event");
    if (!attachmentId) {
      if (!eventId) {
        throw new Error("Pass --attachment <id> or --event <eventId>");
      }
      const event = await folio.getEvent(eventId);
      const first = event.attachments?.[0];
      if (!first?.id) {
        throw new Error(`Event ${eventId} has no attachments`);
      }
      attachmentId = first.id;
      filename = first.filename;
    }
    const file = await folio.downloadAttachment(attachmentId);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, file.bytes);
    console.log(
      JSON.stringify(
        {
          eventId: eventId ?? null,
          attachmentId,
          filename: filename ?? basename(out),
          contentType: file.contentType,
          bytes: file.bytes.byteLength,
          path: out,
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    "Usage: folio <login|events|event|attach|finish|download|accounts|transactions|category|complete|uncomplete|payments> ...",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
