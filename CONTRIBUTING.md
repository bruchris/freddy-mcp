# Contributing

Use Node 22.14+ or Node 24 and npm ci. Tests use synthetic data and mocked vendor requests; do not add customer accounting records or receipts.

Run npm test, npm run typecheck, npm run build, npm run test:tooling, npm run check:public and npm run check:secrets. Tooling tests include actual tarball installations and must run after building. Scripts call Node directly so Windows paths containing & work.

Keep pull requests focused. Explain the changed behavior and verification. Auth, credentials, accounting writes and release changes need review. Preserve the model's bookkeeping judgment; do not add receipt parsers, merchant aliases or VAT guesses.

Only the two MCP packages and approved supporting files belong here. The public boundary check rejects application paths and private material anywhere in Git history. Never merge a private workspace's Git branch or history into this repository.

See [releases](docs/releases.md) and [security](SECURITY.md).
