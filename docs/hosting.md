# Owner-hosted MCP

The current HTTP entrypoints are always-on Node servers. Use a VPS, Docker host or another Node origin, with TLS. They cannot run unchanged as a Vercel function or Cloudflare Worker.

Routes: GET /healthz and Streamable HTTP /mcp. Vendor landing pages and public OAuth are not yet deployed.

## API-key mode

Set MCP_AUTH_TOKEN and the appropriate FOLIO_API_KEY or FIKEN_API_TOKEN in your host environment. Then run npm run http:folio or npm run http:fiken. Defaults are loopback ports 3000 and 3001.

Docker Compose reads an uncommitted root .env for interpolation, passes each service only its vendor key, and binds ports on 127.0.0.1. Never print resolved Compose configuration or container environments. Separate FOLIO_MCP_AUTH_TOKEN and FIKEN_MCP_AUTH_TOKEN can replace the owner fallback token.

Build/start with docker compose up --build -d. Put a TLS reverse proxy in front of the loopback ports. If Cloudflare proxies the Node origins, enforce equivalent authentication at the origin and do not cache authenticated responses.

HTTP requests with an Origin header are denied unless the exact origin is in MCP_ALLOWED_ORIGINS; native clients without Origin still require the bearer token. Compose uses the per-service FOLIO_MCP_ALLOWED_ORIGINS / FIKEN_MCP_ALLOWED_ORIGINS variables. Wildcards are unsupported.

Remote MCP disables filesystem uploads and download destination paths. Receipt downloads can return bytes to the model. Local stdio retains explicit filesystem operations.

## Owner OAuth mode

Vendor OAuth requires the owner's registered app. Local login commands are npm run auth:folio and npm run auth:fiken; redirect defaults are localhost:3334/callback and localhost:3333/callback. Client secrets and refreshed tokens stay in the owner's local .env file. No credentials are distributed through npm.

For Docker, add docker-compose.fiken-oauth.yml and/or docker-compose.folio-oauth.yml. Each selected overlay requires its corresponding FIKEN_OAUTH_ENV_FILE / FOLIO_OAUTH_ENV_FILE: an existing private file containing only that vendor client ID/secret and current refresh token, writable by container UID 1000. Never mount a shared file containing both vendors' credentials.

For Folio API key plus Fiken OAuth:

```sh
docker compose -f docker-compose.yml -f docker-compose.fiken-oauth.yml up -d
```

Refresh occurs at startup and persists rotated tokens into the mounted vendor file. Do not override that file with a stale refresh token through environment variables. Long-running production OAuth needs coordinated refresh/reconnection; restarting is an owner-testing limitation, not unattended production support.

Folio third-party OAuth requires vendor partnership/configuration. Fiken personal keys are for owner-built integrations; third-party OAuth remains subject to development/production approval.

## Operations

Check /healthz (200), /mcp without bearer (401), rejected origins (403) and a valid MCP initialization over HTTPS. Use synthetic credentials for local automated transport checks; live vendor writes need separate approval.

Images run as UID 1000 with production dependencies. Rotate exposed bearer/vendor credentials, restart services as needed, and keep authorization headers out of reverse-proxy logs. Retain a previous image for rollback.

Build public Docker images from this standalone public repository. Do not build release images from a private app workspace: Docker includes the root dependency lockfile.
