import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  parseRedirectListen,
  persistFikenTokens,
} from "../src/oauth.js";

describe("Fiken OAuth", () => {
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
      redirectUri: "http://localhost:3333/callback",
      state: "abc",
    });
    expect(url).toContain("https://fiken.no/oauth/authorize?");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3333%2Fcallback");
    expect(url).toContain("state=abc");
  });

  it("POSTs authorization_code with Basic client credentials", async () => {
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
          token_type: "bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const tokens = await exchangeAuthorizationCode(
      {
        clientId: "cid",
        clientSecret: "csecret",
        code: "authcode",
        redirectUri: "http://localhost:3333/callback",
        state: "abc",
      },
      fetchImpl,
    );
    expect(method).toBe("POST");
    expect(url).toBe("https://fiken.no/oauth/token");
    expect(authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=authcode");
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
  });

  it("POSTs refresh_token with Basic client credentials", async () => {
    let authorization = "";
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
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
    expect(authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(body).toContain("grant_type=refresh_token");
    expect(tokens.accessToken).toBe("access-2");
  });

  it("parses localhost redirect listen port and path", () => {
    expect(parseRedirectListen("http://localhost:3333/callback")).toEqual({
      port: 3333,
      pathname: "/callback",
      host: "localhost",
    });
  });

  it("writes access and refresh tokens into a .env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fiken-oauth-"));
    const file = join(dir, ".env");
    writeFileSync(file, 'FIKEN_CLIENT_ID="cid"\n');
    persistFikenTokens(
      { accessToken: "access-1", refreshToken: "refresh-1" },
      file,
    );
    const text = readFileSync(file, "utf8");
    expect(text).toContain("FIKEN_API_TOKEN=");
    expect(text).toContain("FIKEN_REFRESH_TOKEN=");
    expect(text).toContain("access-1");
    expect(text).toContain("refresh-1");
  });
});
