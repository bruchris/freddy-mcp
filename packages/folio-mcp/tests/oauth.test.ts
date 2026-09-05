import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  FOLIO_TOKEN_URL,
  parseRedirectListen,
  persistFolioTokens,
} from "../src/oauth.js";

describe("Folio OAuth", () => {
  it.each(["malformed", "network", "body"])("does not disclose token material in %s failures", async (mode) => {
    const fetchImpl: typeof fetch = async () => {
      if (mode === "network") throw new Error("SECR3T42");
      if (mode === "body") return new Response(new ReadableStream({ start(controller) { controller.error(new Error("SECR3T42")); } }));
      return new Response("SECR3T42");
    };
    let caught: unknown;
    try { await exchangeRefreshToken({ clientId: "test", clientSecret: "SECR3T42", refreshToken: "SECR3T42" }, fetchImpl); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught) + JSON.stringify(caught)).not.toContain("SECR3T42");
  });

  it("builds the authorize URL with code, client, redirect, and state", () => {
    const url = buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://localhost:3334/callback",
      state: "abc",
    });
    expect(url).toContain("https://app.folio.no/oauth/authorize?");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3334%2Fcallback");
    expect(url).toContain("state=abc");
  });

  it("uses FOLIO_AUTHORIZE_URL when provided", () => {
    const url = buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://localhost:3334/callback",
      state: "abc",
      authorizeUrl: "https://company.folio.no/oauth/authorize",
    });
    expect(url.startsWith("https://company.folio.no/oauth/authorize?")).toBe(true);
  });

  it("POSTs authorization_code to Folio token URL with client_id/secret in the body", async () => {
    let method = "";
    let url = "";
    let authorization = "";
    let body = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: 7200,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const tokens = await exchangeAuthorizationCode(
      {
        clientId: "cid",
        clientSecret: "csecret",
        code: "authcode",
        redirectUri: "http://localhost:3334/callback",
      },
      fetchImpl,
    );
    expect(method).toBe("POST");
    expect(url).toBe(FOLIO_TOKEN_URL);
    expect(authorization).toBe("");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=authcode");
    expect(body).toContain("client_id=cid");
    expect(body).toContain("client_secret=csecret");
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
  });

  it("POSTs refresh_token to the same Folio token URL", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const tokens = await exchangeRefreshToken(
      { clientId: "cid", clientSecret: "csecret", refreshToken: "refresh-1" },
      fetchImpl,
    );
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-1");
    expect(tokens.accessToken).toBe("access-2");
  });

  it("parses localhost redirect listen port and path", () => {
    expect(parseRedirectListen("http://localhost:3334/callback")).toEqual({
      port: 3334,
      pathname: "/callback",
      host: "localhost",
    });
  });

  it("writes access and refresh tokens into a .env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "folio-oauth-"));
    const file = join(dir, ".env");
    writeFileSync(file, 'FOLIO_CLIENT_ID="cid"\n');
    persistFolioTokens({ accessToken: "access-1", refreshToken: "refresh-1" }, file);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("FOLIO_API_KEY=");
    expect(text).toContain("FOLIO_REFRESH_TOKEN=");
    expect(text).toContain("access-1");
    expect(text).toContain("refresh-1");
  });
});
