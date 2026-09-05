import { apiKeyAuth, FikenClient } from "./client.js";
import { loadEnvFiles } from "./env-file.js";
import { exchangeRefreshToken, persistFikenTokens } from "./oauth.js";

export { loadEnvFiles } from "./env-file.js";

export async function refreshFikenAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  loadEnvFiles();
  const refreshToken = process.env.FIKEN_REFRESH_TOKEN?.trim();
  const clientId = process.env.FIKEN_CLIENT_ID?.trim();
  const clientSecret = process.env.FIKEN_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    return undefined;
  }
  const tokens = await exchangeRefreshToken(
    { clientId, clientSecret, refreshToken },
    fetchImpl,
  );
  process.env.FIKEN_API_TOKEN = tokens.accessToken;
  if (tokens.refreshToken) {
    process.env.FIKEN_REFRESH_TOKEN = tokens.refreshToken;
  }
  if (fetchImpl === fetch) {
    persistFikenTokens(tokens);
  }
  return tokens.accessToken;
}

export async function fikenClientFromEnv(): Promise<FikenClient> {
  loadEnvFiles();
  const refreshed = await refreshFikenAccessToken();
  const token = refreshed ?? process.env.FIKEN_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "FIKEN_API_TOKEN is not set. Run `npm run auth:fiken` from the repo root (needs FIKEN_CLIENT_ID and FIKEN_CLIENT_SECRET), or put a personal API token in .env.",
    );
  }
  return new FikenClient({ auth: apiKeyAuth(token) });
}
