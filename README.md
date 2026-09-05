# Folio and Fiken MCP tools

Open-source TypeScript clients, Model Context Protocol servers and command-line tools for Folio banking and Fiken accounting. Unofficial; not affiliated with Folio AS or Fiken AS.

| Package | API surface |
| --- | --- |
| [@bruchris/folio-mcp](packages/folio-mcp) | Accounts, transactions, events, receipt bytes, categories and payment drafts |
| [@bruchris/fiken-mcp](packages/fiken-mcp) | Companies, accounts, contacts, purchases and purchase attachments |

The adapter exposes vendor APIs. The model reads receipts and chooses accounting fields; there are no merchant-specific receipt parsers or VAT rules.

## Release status

Version 0.1.0 is prepared but not yet published to npm. The installation examples below apply after registry publication. Both packages require Node 22.14+; Node 24 is recommended.

```sh
npx -y @bruchris/folio-mcp
npx -y @bruchris/fiken-mcp
```

Configure FOLIO_API_KEY or FIKEN_API_TOKEN in your client environment. API keys are supported for owner integrations. Vendor OAuth uses your registered vendor app; client secrets stay on the host, never in npm.

Fiken restricts personal-key use in third-party applications; obtain the required OAuth/vendor authorization before offering an integration to other firms. See [Fiken's API documentation](https://api.fiken.no/api/v2/docs/).

## Approval and receipts

MCP writes return a preview until confirm=true. Your client must obtain approval before confirming. CLI writes require --confirm. Folio API payments remain drafts for approval inside Folio.

For a card purchase, read the Folio event and receipt, inspect Fiken contacts and similar purchases, then choose the accounting fields. Payment date and NOK amount come from the booked Folio transaction. Attach receipts to the purchase; do not duplicate them into Fiken Innboks.

Typed clients are imported from @bruchris/folio-mcp/client and @bruchris/fiken-mcp/client without launching MCP or loading environment files.

## Local development

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run test:tooling
npm run check:public
npm run check:secrets
```

See [contributing](CONTRIBUTING.md), [hosting](docs/hosting.md), [release policy](docs/releases.md) and [security reporting](SECURITY.md). This repository contains the MCP packages and their supporting material. The Freddy application source is private and is not included.

MIT license; see each package's LICENSE.
