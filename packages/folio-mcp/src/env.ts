import { apiKeyAuth, FolioClient } from "./client.js";
import { loadEnvFiles } from "./env-file.js";
import { exchangeRefreshToken, persistFolioTokens } from "./oauth.js";

export { loadEnvFiles } from "./env-file.js";

export async function refreshFolioAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  loadEnvFiles();
  const refreshToken = process.env.FOLIO_REFRESH_TOKEN?.trim();
  const clientId = process.env.FOLIO_CLIENT_ID?.trim();
  const clientSecret = process.env.FOLIO_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    return undefined;
  }
  const tokens = await exchangeRefreshToken(
    { clientId, clientSecret, refreshToken },
    fetchImpl,
  );
  process.env.FOLIO_API_KEY = tokens.accessToken;
  if (tokens.refreshToken) {
    process.env.FOLIO_REFRESH_TOKEN = tokens.refreshToken;
  }
  if (fetchImpl === fetch) {
    persistFolioTokens(tokens);
  }
  return tokens.accessToken;
}

export async function folioClientFromEnv(): Promise<FolioClient> {
  loadEnvFiles();
  const refreshed = await refreshFolioAccessToken();
  const token = refreshed ?? process.env.FOLIO_API_KEY?.trim();
  if (!token) {
    throw new Error(
      "FOLIO_API_KEY is not set. Run `npm run auth:folio` (needs FOLIO_CLIENT_ID and FOLIO_CLIENT_SECRET), or put an API key from app.folio.no → API-tilgang in .env.",
    );
  }
  return new FolioClient({ auth: apiKeyAuth(token) });
}
