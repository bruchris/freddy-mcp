import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The release seam is the exact artifact a consumer installs, including its
// exported client and stdio/CLI entry points. Build both packages before this test.
test("published tarballs install cleanly and expose side-effect-free clients, help, and MCP tools", {
  timeout: 360_000,
}, async (context) => {
  const script = fileURLToPath(new URL("../release-smoke.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    signal: context.signal,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const result = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 0, output);
  assert.match(output, /@bruchris\/folio-mcp: tarball, isolated install, client, CLI, MCP passed/);
  assert.match(output, /@bruchris\/fiken-mcp: tarball, isolated install, client, CLI, MCP passed/);
  assert.match(output, /Release smoke passed; no vendor network requests/);
});
