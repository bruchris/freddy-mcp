# @bruchris/fiken-mcp

> Release status: local 0.1.0 preparation. Not published to npm yet; the npx examples below apply after publication. Requires Node 22.14+ (Node 24 recommended).


> Model Context Protocol (MCP) server for [Fiken Accounting](https://fiken.no) (`api.fiken.no/api/v2`).
> Connect Claude Desktop, Claude Code, Cursor, Codex, ChatGPT, and autonomous AI agents to Norwegian bookkeeping.

[![npm version](https://img.shields.io/npm/v/@bruchris/fiken-mcp.svg)](https://www.npmjs.com/package/@bruchris/fiken-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Typed **client**, **MCP stdio server**, and **CLI**. Pair with [`@bruchris/folio-mcp`](https://www.npmjs.com/package/@bruchris/folio-mcp) for card charges. Not affiliated with Fiken.

The model fills identifier, supplier, description, dates, and `vatType` after reading the receipt. This package does not parse PDFs.

---

## Features

- **Companies & chart of accounts** — list companies (use `slug` on later calls); search NS4102 accounts.
- **Bank accounts** — `accountCode` for `paymentAccount` (e.g. Kortkonto `1920:…`).
- **Contacts** — list/get/create suppliers and customers.
- **Purchases** — list/get/preview/create/delete; attach files to the **purchase** (not Innboks).
- **Serialized HTTP** — one in-flight request (Fiken rate limit).
- **Amounts in øre** — integers (14950 = 149.50 NOK). FX lines use `netPriceInCurrency` / `vatInCurrency`.

## Hosted-service target

This package is also the Fiken adapter behind the planned hosted service:

- landing/setup page: `https://fiken.bruchris.me/`
- Streamable HTTP MCP: `https://fiken.bruchris.me/mcp`

The current HTTP entry point uses a private bearer token and an always-on Node/Docker origin. The production service will add MCP OAuth and map the signed-in client to an organisation's encrypted Fiken connection in Freddy. See [hosting](https://github.com/bruchris/freddy-mcp/blob/main/docs/hosting.md) for the current owner-only transport and authentication limits. These URLs remain targets until deployment is verified.

---

## Installation

### 1. Get a Fiken token

**Personal API key** (simplest for local MCP):

1. Log in to [fiken.no](https://fiken.no).
2. **Rediger konto** → **Sikkerhet** → **Personlige API-nøkler**.
3. Create a key and set `FIKEN_API_TOKEN`.

**OAuth app** (refreshing tokens): register redirect `http://localhost:3333/callback`, set `FIKEN_CLIENT_ID` / `FIKEN_CLIENT_SECRET`, then from this repo: `npm run auth:fiken` (or `fiken login`). The client refreshes `FIKEN_API_TOKEN` automatically. Never put `client_secret` in npm.

Remote Streamable HTTP: `npm run http:fiken` with `MCP_AUTH_TOKEN`. See [hosting](https://github.com/bruchris/freddy-mcp/blob/main/docs/hosting.md). GitHub cannot host this process.

### 2. Configure your AI client

#### Claude Code (CLI)

```bash
claude mcp add fiken --env FIKEN_API_TOKEN=your_token -- npx -y @bruchris/fiken-mcp
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fiken": {
      "command": "npx",
      "args": ["-y", "@bruchris/fiken-mcp"],
      "env": {
        "FIKEN_API_TOKEN": "your_fiken_api_token"
      }
    }
  }
}
```

#### Cursor / other IDEs

```json
{
  "mcpServers": {
    "fiken": {
      "command": "npx",
      "args": ["-y", "@bruchris/fiken-mcp"],
      "env": {
        "FIKEN_API_TOKEN": "your_fiken_api_token"
      }
    }
  }
}
```

---

## Available tools

| Tool | Type | Description |
| :--- | :--- | :--- |
| `fiken_list_companies` | Read | Companies the token can access (`slug`). |
| `fiken_list_accounts` | Read | Chart of accounts; optional `fromAccount` / `toAccount`. |
| `fiken_list_bank_accounts` | Read | Bank/card accounts and `accountCode`. |
| `fiken_list_contacts` | Read | Search by name or email; **you** pick `supplierId`. |
| `fiken_get_contact` | Read | One contact. |
| `fiken_create_contact` | Write | Create a supplier/customer if none exists. |
| `fiken_list_purchases` | Read | Purchases, optional date filters. |
| `fiken_get_purchase` | Read | One purchase (copy a similar booking). |
| `fiken_preview_purchase` | Read | Echo payload without booking. |
| `fiken_create_purchase` | Write | `POST /purchases`. Amounts in øre. |
| `fiken_delete_purchase` | Write | Soft-delete (`PATCH …/delete`) with a reason. |
| `fiken_attach_to_purchase` | Write | Attach a local PDF/image to a purchase. |

Inbox **upload** is out of the Folio card-charge path. Do not upload a receipt to Innboks if it already lives on the Folio event.

CLI writes require `--confirm`.

---

## Folio + Fiken workflow

When both servers are configured, the **model** should:

1. `folio_list_events` / `folio_get_event` for amounts and booking date.
2. `folio_download_attachment` and **read** the receipt (supplier, invoice number, line text).
3. `fiken_list_contacts` and `fiken_get_purchase` on a similar existing booking.
4. `fiken_preview_purchase` then `fiken_create_purchase` (`paymentDate` + `paymentAmountInNok` from Folio booking NOK).
5. `fiken_attach_to_purchase` if you want the file on the Fiken voucher.

Skip intern overføringer. Superføring **Registrer nytt kjøp** cannot be pressed via API.

---

## CLI

```bash
export FIKEN_API_TOKEN=your_token
npx @bruchris/fiken-mcp
fiken login
fiken companies
fiken bank-accounts --company your-slug
fiken contacts --company your-slug --search Acme
fiken get-purchase --company your-slug --purchase-id 123
fiken purchase --company your-slug --confirm --kind supplier --supplier-id 1 \
  --date 2026-05-17 --payment-date 2026-05-18 --currency USD \
  --payment-account 1920:10002 --payment-nok 95516 --account 6553 \
  --vat HIGH_FOREIGN_SERVICE_DEDUCTIBLE --description "from the receipt" \
  --net-currency 10000 --identifier invoice-number
```

---

## TypeScript client

```typescript
import { apiKeyAuth, FikenClient } from "@bruchris/fiken-mcp/client";

const fiken = new FikenClient({
  auth: apiKeyAuth(process.env.FIKEN_API_TOKEN!),
});

const companies = await fiken.listCompanies();
```

HTTP is serialized (one in-flight). `201` + `Location` is a successful create.

---

## License

MIT License © 2026 [Christian Bru](https://bruchris.me).
Unofficial community integration. Fiken is a trademark of Fiken AS.

## Confirmation and remote files

MCP write tools return a preview until confirm=true; review the proposal in your client before confirming. CLI mutations require --confirm. HTTP mode rejects local filesystem paths, including attachment uploads and download destinations. Downloaded receipt bytes can still be returned to the model. Set MCP_ALLOWED_ORIGINS to exact approved browser origins if required; unauthenticated/native requests are still subject to bearer authentication. These owner-mode controls do not implement Freddy tenant-aware approvals.

Personal API keys are intended for owner-built integrations. Fiken requires OAuth for third-party applications; do not onboard another firm with a personal key without Fiken authorization. See the [official API documentation](https://api.fiken.no/api/v2/docs/). Request serialization applies within one client instance; hosted processes must coordinate the vendor limit across workers.
