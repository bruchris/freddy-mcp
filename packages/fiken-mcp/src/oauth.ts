import { findEnvFile, loadEnvFiles, upsertEnvValue } from "./env-file.js";

export const FIKEN_AUTHORIZE_URL = "https://fiken.no/oauth/authorize";
export const FIKEN_TOKEN_URL = "https://fiken.no/oauth/token";
export const DEFAULT_REDIRECT_URI = "http://localhost:3333/callback";

export type FikenTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(FIKEN_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function parseRedirectListen(redirectUri: string): { port: number; pathname: string; host: string } {
  const url = new URL(redirectUri);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("FIKEN_REDIRECT_URI must be http(s)");
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
    state?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<FikenTokenSet> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.state ? { state: input.state } : {}),
    },
    input.clientId,
    input.clientSecret,
    fetchImpl,
  );
}

export async function exchangeRefreshToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FikenTokenSet> {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    },
    input.clientId,
    input.clientSecret,
    fetchImpl,
  );
}

class OAuthExchangeError extends Error {}

async function tokenRequest(
  body: Record<string, string>,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch,
): Promise<FikenTokenSet> {
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetchImpl(FIKEN_TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new OAuthExchangeError(
        `Fiken OAuth token exchange failed (${response.status}). Check Client ID/secret, redirect URI, and that the app is not read-only.`,
      );
    }
    const data = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new OAuthExchangeError("Fiken OAuth returned no access_token.");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    if (error instanceof OAuthExchangeError) throw error;
    throw new OAuthExchangeError("Fiken OAuth token exchange failed. Check the connection and credential configuration; response details are withheld.");
  }
}

export function persistFikenTokens(tokens: FikenTokenSet, envFile?: string): string {
  loadEnvFiles();
  const file =
    envFile ??
    findEnvFile("FIKEN_CLIENT_ID") ??
    findEnvFile("FIKEN_API_TOKEN") ??
    findEnvFile();
  if (!file) {
    throw new Error("No .env file found. Create one in the repo root first.");
  }
  upsertEnvValue(file, "FIKEN_API_TOKEN", tokens.accessToken);
  process.env.FIKEN_API_TOKEN = tokens.accessToken;
  if (tokens.refreshToken) {
    upsertEnvValue(file, "FIKEN_REFRESH_TOKEN", tokens.refreshToken);
    process.env.FIKEN_REFRESH_TOKEN = tokens.refreshToken;
  }
  return file;
}
