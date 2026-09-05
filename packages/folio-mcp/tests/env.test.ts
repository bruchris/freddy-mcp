import { afterEach, describe, expect, it } from "vitest";
import { refreshFolioAccessToken } from "../src/env.js";

const keys = [
  "FOLIO_API_KEY",
  "FOLIO_REFRESH_TOKEN",
  "FOLIO_CLIENT_ID",
  "FOLIO_CLIENT_SECRET",
] as const;

const snapshot = new Map<string, string | undefined>();

describe("folioClientFromEnv refresh", () => {
  afterEach(() => {
    for (const key of keys) {
      if (snapshot.has(key)) {
        const value = snapshot.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    snapshot.clear();
  });

  it("exchanges a refresh token without persisting when fetch is injected", async () => {
    for (const key of keys) snapshot.set(key, process.env[key]);
    process.env.FOLIO_REFRESH_TOKEN = "refresh-1";
    process.env.FOLIO_CLIENT_ID = "cid";
    process.env.FOLIO_CLIENT_SECRET = "csecret";
    delete process.env.FOLIO_API_KEY;

    let body = "";
    const token = await refreshFolioAccessToken(async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "access-2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_secret=csecret");
    expect(token).toBe("access-2");
    expect(process.env.FOLIO_API_KEY).toBe("access-2");
  });

  it("returns undefined when refresh credentials are missing", async () => {
    for (const key of keys) snapshot.set(key, process.env[key]);
    process.env.FOLIO_REFRESH_TOKEN = "";
    process.env.FOLIO_CLIENT_ID = "";
    process.env.FOLIO_CLIENT_SECRET = "";
    await expect(refreshFolioAccessToken()).resolves.toBeUndefined();
  });
});
