import { describe, expect, it, vi } from "vitest";
import { exec, execFile } from "node:child_process";
import { listenForCode, openBrowser } from "../src/auth.js";

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));

describe("local OAuth callback", () => {
  it.each([
    { path: "//[", method: "GET", status: 400 },
    { path: "/callback?state=synthetic-state&code=wrong-code", method: "POST", status: 405 },
  ])("rejects invalid callback request $method $path before consuming consent", async ({ path, method, status }) => {
    const session = await listenForCode({ port: 0, pathname: "/callback", expectedState: "synthetic-state" });
    const completion = session.wait.then((code) => ({ code }), (error: Error) => ({ error: error.message }));
    try {
      await expect(fetch("http://127.0.0.1:" + session.port + path, { method, signal: AbortSignal.timeout(500) })).resolves.toMatchObject({ status });
      const accepted = await fetch("http://127.0.0.1:" + session.port + "/callback?state=synthetic-state&code=synthetic-code");
      expect(accepted.status).toBe(200);
      expect(await completion).toEqual({ code: "synthetic-code" });
    } finally { session.close(); }
  });

  it("launches Windows browser URLs as a literal executable argument without a shell", () => {
    vi.mocked(exec).mockClear();
    vi.mocked(execFile).mockClear();
    const url = "https://authorize.example/?callback=%PATH%&state=synthetic";
    openBrowser(url, "win32");
    expect(exec).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
  });

  it("never reflects OAuth error values even when state matches", async () => {
    const session = await listenForCode({ port: 0, pathname: "/callback", expectedState: "synthetic-state" });
    const completion = session.wait.catch((error: Error) => error.message);
    try {
      const query = new URLSearchParams({ state: "synthetic-state", error: "<script>synthetic-secret</script>", error_description: "synthetic-secret" });
      const rejected = await fetch("http://127.0.0.1:" + session.port + "/callback?" + query);
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).not.toContain("synthetic-secret");
      expect(await completion).not.toContain("synthetic-secret");
    } finally { session.close(); }
  });

  it("rejects an unbound error without reflecting it or consuming the pending consent", async () => {
    const session = await listenForCode({ port: 0, pathname: "/callback", expectedState: "synthetic-state" });
    const completion = session.wait.then((code) => ({ code }), (error: Error) => ({ error: error.message }));
    try {
      const query = new URLSearchParams({ state: "wrong-state", error: "<script>synthetic-secret</script>" });
      const rejected = await fetch("http://127.0.0.1:" + session.port + "/callback?" + query);
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).not.toContain("synthetic-secret");
      const accepted = await fetch("http://127.0.0.1:" + session.port + "/callback?state=synthetic-state&code=synthetic-code");
      expect(accepted.status).toBe(200);
      expect(await completion).toEqual({ code: "synthetic-code" });
    } finally { session.close(); }
  });
});
