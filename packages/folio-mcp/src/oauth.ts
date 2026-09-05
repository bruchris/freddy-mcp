import { findEnvFile, loadEnvFiles, upsertEnvValue } from "./env-file.js";

/** Token exchange (RFC 6749). Consent URL is company-specific; override with FOLIO_AUTHORIZE_URL. */
export const FOLIO_TOKEN_URL = "https://api.folio.no/oauth2/token";
export const DEFAULT_FOLIO_AUTHORIZE_URL = "https://app.folio.no/oauth/authorize";
export const DEFAULT_REDIRECT_URI = "http://localhost:3334/callback";

export type FolioTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  integrationId?: string;
};

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  authorizeUrl?: string;
}): string {
  const url = new URL(input.authorizeUrl ?? DEFAULT_FOLIO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function parseRedirectListen(redirectUri: string): {
  port: number;
  pathname: string;
  host: string;
} {
  const url = new URL(redirectUri);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("FOLIO_REDIRECT_URI must be http(s)");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return { port, pathname: url.pathname || "/", host: url.hostname };
}

export async function exchangeAuthorizationCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<FolioTokenSet> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    fetchImpl,
  );
}

export async function exchangeRefreshToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FolioTokenSet> {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    fetchImpl,
  );
}

class OAuthExchangeError extends Error {}

async function tokenRequest(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<FolioTokenSet> {
  try {
    const response = await fetchImpl(FOLIO_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new OAuthExchangeError(
        `Folio OAuth token exchange failed (${response.status}). Check Client ID/secret, redirect URI, and FOLIO_AUTHORIZE_URL.`,
      );
    }
    const data = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      integration_id?: string;
    };
    if (!data.access_token) {
      throw new OAuthExchangeError("Folio OAuth returned no access_token.");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      integrationId: data.integration_id,
    };
  } catch (error) {
    if (error instanceof OAuthExchangeError) throw error;
    throw new OAuthExchangeError("Folio OAuth token exchange failed. Check the connection and credential configuration; response details are withheld.");
  }
}

export function persistFolioTokens(tokens: FolioTokenSet, envFile?: string): string {
  loadEnvFiles();
  const file =
    envFile ??
    findEnvFile("FOLIO_CLIENT_ID") ??
    findEnvFile("FOLIO_API_KEY") ??
    findEnvFile();
  if (!file) {
    throw new Error("No .env file found. Create one in the repo root first.");
  }
  upsertEnvValue(file, "FOLIO_API_KEY", tokens.accessToken);
  process.env.FOLIO_API_KEY = tokens.accessToken;
  if (tokens.refreshToken) {
    upsertEnvValue(file, "FOLIO_REFRESH_TOKEN", tokens.refreshToken);
    process.env.FOLIO_REFRESH_TOKEN = tokens.refreshToken;
  }
  return file;
}
