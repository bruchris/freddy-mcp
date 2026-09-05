#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { loadEnvFiles } from "./env-file.js";
import {
  buildAuthorizeUrl,
  DEFAULT_FOLIO_AUTHORIZE_URL,
  DEFAULT_REDIRECT_URI,
  exchangeAuthorizationCode,
  parseRedirectListen,
  persistFolioTokens,
} from "./oauth.js";

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
    return;
  }
  execFile(platform === "darwin" ? "open" : "xdg-open", [url]);
}

function html(body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Folio</title><body style="font-family:sans-serif;padding:2rem">${body}</body></html>`;
}

export function listenForCode(options: {
  port: number;
  pathname: string;
  expectedState: string;
}): Promise<{ wait: Promise<string>; close: () => void; port: number }> {
  return new Promise((resolveListen, rejectListen) => {
    let settled = false;
    const wait = new Promise<string>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let url: URL;
        try { url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`); } catch {
          res.writeHead(400).end("bad request target");
          return;
        }
        if (url.pathname !== options.pathname) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.writeHead(405, { allow: "GET" }).end();
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (state !== options.expectedState) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(html("<p>Invalid OAuth state. Return to the original sign-in window.</p>"));
          return;
        }
        if (error) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(html("<p>Folio authorization was declined or failed. You can close this window.</p>"));
          server.close();
          reject(new Error("Folio OAuth authorization was declined or failed. Retry sign-in."));
          return;
        }
        if (!code) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(html("<p>Missing code or bad state. You can close this window.</p>"));
          server.close();
          reject(new Error("OAuth callback missing code or state did not match."));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html("<p>Folio is connected. You can close this window.</p>"));
        server.close();
        resolve(code);
      });
      server.on("error", (error) => {
        if (!settled) {
          settled = true;
          rejectListen(error);
        } else {
          reject(error);
        }
      });
      server.listen(options.port, "127.0.0.1", () => {
        settled = true;
        const address = server.address();
        resolveListen({
          port: typeof address === "object" && address ? address.port : options.port,
          wait,
          close: () => server.close(),
        });
      });
    });
  });
}

export async function runFolioBrowserLogin() {
  loadEnvFiles();
  const clientId = process.env.FOLIO_CLIENT_ID?.trim();
  const clientSecret = process.env.FOLIO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.FOLIO_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const authorizeUrlBase =
    process.env.FOLIO_AUTHORIZE_URL?.trim() || DEFAULT_FOLIO_AUTHORIZE_URL;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set FOLIO_CLIENT_ID and FOLIO_CLIENT_SECRET (Folio company OAuth app). Redirect must match FOLIO_REDIRECT_URI (default http://localhost:3334/callback). Do not put the secret in npm.",
    );
  }
  const listen = parseRedirectListen(redirectUri);
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    authorizeUrl: authorizeUrlBase,
  });
  const session = await listenForCode({
    port: listen.port,
    pathname: listen.pathname,
    expectedState: state,
  });
  console.error(`Listening on ${redirectUri}`);
  console.error(`Using redirect_uri=${redirectUri} (must match the Folio app allow-list exactly).`);
  console.error("Opening Folio in your browser. Approve the app.");
  openBrowser(authorizeUrl);
  try {
    const code = await session.wait;
    const tokens = await exchangeAuthorizationCode({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });
    const file = persistFolioTokens(tokens);
    console.error(
      `Saved FOLIO_API_KEY${tokens.refreshToken ? " and FOLIO_REFRESH_TOKEN" : ""} to ${file}`,
    );
  } finally {
    session.close();
  }
}

function invokedAsScript(): boolean {
  const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
  return entry.endsWith("/auth.ts") || entry.endsWith("/auth.js");
}

if (invokedAsScript()) {
  runFolioBrowserLogin().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EADDRINUSE")) {
      console.error(
        `Port is busy. Set FOLIO_REDIRECT_URI to a free port, add that URI on the Folio app, then retry.`,
      );
    }
    console.error(message);
    process.exit(1);
  });
}
