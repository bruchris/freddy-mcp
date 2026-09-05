# @bruchris/folio-mcp

> Release status: local 0.1.0 preparation. Not published to npm yet; the npx examples below apply after publication. Requires Node 22.14+ (Node 24 recommended).


> Model Context Protocol (MCP) server for [Folio Bank](https://folio.no) business accounts (`api.folio.no/v2`).
> Connect Claude Desktop, Claude Code, Cursor, Codex, ChatGPT, and autonomous AI agents to your banking data.

[![npm version](https://img.shields.io/npm/v/@bruchris/folio-mcp.svg)](https://www.npmjs.com/package/@bruchris/folio-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Typed **client**, **MCP stdio server**, and **CLI**. Pair with [`@bruchris/fiken-mcp`](https://www.npmjs.com/package/@bruchris/fiken-mcp) to book card charges. Not affiliated with Folio.

---

## Features

- **Accounts & balances** — list accounts and query balance on a date.
- **Transactions** — booked transactions in a date range.
- **Card events** — list/get events; filter incomplete or missing receipts.
- **Receipts** — upload PDFs/images; **download bytes to the model** (vision / embedded PDF). Folio OCR `extractedText` is returned raw. This package does not parse invoices.
- **Ledger categories** — NS4102-style account number and VAT metadata.
- **Payment drafts** — create/list/cancel. API-created payments **always stay drafts** until approved in the Folio app.
- **Stdio and HTTP** — local stdio (API key or `folio login`); remote Streamable HTTP with `MCP_AUTH_TOKEN` ([hosting](https://github.com/bruchris/freddy-mcp/blob/main/docs/hosting.md)).

## Hosted-service target

This package is also the Folio adapter behind the planned hosted service:

- landing/setup page: `https://folio.bruchris.me/`
- Streamable HTTP MCP: `https://folio.bruchris.me/mcp`

The current HTTP entry point uses a private bearer token and an always-on Node/Docker origin. The production service will add MCP OAuth and map the signed-in client to an organisation's encrypted Folio connection in Freddy. See [hosting](https://github.com/bruchris/freddy-mcp/blob/main/docs/hosting.md) for the current owner-only transport and authentication limits. These URLs remain targets until deployment is verified.

---

## Installation

### 1. Generate a Folio API key or connect OAuth

**API key** (local first-party):

1. Log in to [app.folio.no](https://app.folio.no).
2. Go to **Rediger konto** → [API-tilgang](https://app.folio.no/til/api-tilgang).
3. Create a personal API key and set `FOLIO_API_KEY`.

**OAuth** (refreshing tokens; optional for owner HTTP hosting with API keys): register a company OAuth app with redirect `http://localhost:3334/callback`, set `FOLIO_CLIENT_ID` / `FOLIO_CLIENT_SECRET`, then from this repo: `npm run auth:folio` (or `folio login`). If the consent page is wrong, set `FOLIO_AUTHORIZE_URL`. Never put `client_secret` in npm.

### 2. Configure your AI client

#### Claude Code (CLI)

```bash
claude mcp add folio --env FOLIO_API_KEY=your_folio_api_key -- npx -y @bruchris/folio-mcp
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "folio": {
      "command": "npx",
      "args": ["-y", "@bruchris/folio-mcp"],
      "env": {
        "FOLIO_API_KEY": "your_folio_api_key"
      }
    }
  }
}
```

#### Cursor / other IDEs

**Settings → Tools & MCP**, or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "folio": {
      "command": "npx",
      "args": ["-y", "@bruchris/folio-mcp"],
      "env": {
        "FOLIO_API_KEY": "your_folio_api_key"
      }
    }
  }
}
```

---

## Available tools

| Tool | Type | Description |
| :--- | :--- | :--- |
| `folio_list_events` | Read | Card events; `incomplete`, `missingReceipt`, or `gaps`. |
| `folio_get_event` | Read | One event, category, attachment metadata, raw OCR text. |
| `folio_download_attachment` | Read | Receipt bytes for the model (optional write to `destPath`). |
| `folio_upload_attachment` | Write | Attach a local `.pdf` / `.png` / `.jpg` to an event. |
| `folio_update_event` | Write | Purpose, note, participants, ledger category. |
| `folio_complete_event` | Write | Mark complete. |
| `folio_uncomplete_event` | Write | Mark incomplete. |
| `folio_list_accounts` | Read | Bank and card accounts. |
| `folio_get_balance` | Read | Balance for an account on `YYYY-MM-DD`. |
| `folio_list_transactions` | Read | Booked transactions in a date range. |
| `folio_get_category` | Read | Category title, account number, VAT. |
| `folio_list_payments` | Read | Payment drafts. |
| `folio_create_payment` | Write | Create a **draft** (in-app approval required). |
| `folio_cancel_payment` | Write | Delete a draft. |

`integration/disable` is available on the client only, not MCP/CLI.

---

## CLI

After `npm install -g @bruchris/folio-mcp`, or via `npx`:

```bash
export FOLIO_API_KEY=your_folio_api_key
npx @bruchris/folio-mcp   # stdio MCP
folio login               # OAuth; writes FOLIO_API_KEY + FOLIO_REFRESH_TOKEN
folio events --from 2026-04-01 --gaps
folio event <eventId>
folio download --event <eventId> --out ./receipt.pdf
folio finish <eventId> ./receipt.pdf --category-from <otherEventId>
```

`--incomplete` is Folio `complete=false`. `--missing-receipt` is no attachment. `--gaps` is either.

---

## TypeScript client

```typescript
import { apiKeyAuth, FolioClient } from "@bruchris/folio-mcp/client";

const folio = new FolioClient({
  auth: apiKeyAuth(process.env.FOLIO_API_KEY!),
});

const { events } = await folio.listEvents({ startDate: "2026-04-01" });
```

---

## Security

- Payment tools only create **drafts**. Money movement needs a human in the Folio app.
- Do not log or commit `FOLIO_API_KEY` or `FOLIO_CLIENT_SECRET`.
- HTTP MCP (`folio-mcp-http` / `npm run http:folio`) requires `MCP_AUTH_TOKEN`. See [hosting](https://github.com/bruchris/freddy-mcp/blob/main/docs/hosting.md).
- Do not upload the same receipt to Folio **and** Fiken Innboks when you book via `createPurchase`.

---

## License

MIT License © 2026 [Christian Bru](https://bruchris.me).
Unofficial community project. Folio is a trademark of Folio AS.

## Confirmation and remote files

MCP write tools return a preview until confirm=true; review the proposal in your client before confirming. CLI mutations require --confirm. HTTP mode rejects local filesystem paths, including attachment uploads and download destinations. Downloaded receipt bytes can still be returned to the model. Set MCP_ALLOWED_ORIGINS to exact approved browser origins if required; unauthenticated/native requests are still subject to bearer authentication. These owner-mode controls do not implement Freddy tenant-aware approvals.
