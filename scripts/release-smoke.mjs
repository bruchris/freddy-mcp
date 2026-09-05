#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  { name: "@bruchris/folio-mcp", directory: "folio-mcp", vendor: "folio", client: "FolioClient", requiredTools: ["folio_get_event", "folio_download_attachment"], deniedCommands: [["attach", "synthetic-event", "synthetic.pdf"], ["finish", "synthetic-event", "synthetic.pdf"], ["complete", "synthetic-event"], ["uncomplete", "synthetic-event"]] },
  { name: "@bruchris/fiken-mcp", directory: "fiken-mcp", vendor: "fiken", client: "FikenClient", requiredTools: ["fiken_list_contacts", "fiken_get_purchase", "fiken_create_purchase"], deniedCommands: [["purchase"], ["delete-purchase"], ["attach"]] },
];

function npmCli() {
  const executableDirectory = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(executableDirectory, "node_modules/npm/bin/npm-cli.js"),
    resolve(executableDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
    "/usr/share/nodejs/npm/bin/npm-cli.js",
  ];
  for (const directory of (process.env.PATH ?? process.env.Path ?? "").split(delimiter)) {
    candidates.push(join(directory, "node_modules/npm/bin/npm-cli.js"));
    const command = join(directory, "npm");
    if (existsSync(command)) candidates.push(realpathSync(command));
  }
  const candidate = candidates.find((path) => path && /npm-cli\.js$/i.test(path) && existsSync(path));
  if (!candidate) throw new Error("Cannot locate npm-cli.js. Install Node with npm or invoke this script through npm.");
  return candidate;
}

function isolatedEnvironment(root) {
  const environment = {};
  // No inherited npm config, proxies, NODE_OPTIONS, tokens, or vendor credentials.
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|comspec|pathext|systemdrive)$/i.test(key)) environment[key] = value;
  }
  return {
    ...environment,
    HOME: join(root, "home"), USERPROFILE: join(root, "home"),
    APPDATA: join(root, "home", "roaming"), LOCALAPPDATA: join(root, "home", "local"),
    TEMP: join(root, "tmp"), TMP: join(root, "tmp"), TMPDIR: join(root, "tmp"),
    npm_config_userconfig: join(root, "npm-user.conf"),
    npm_config_globalconfig: join(root, "npm-global.conf"),
    npm_config_cache: join(root, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false",
    FREDDY_SMOKE_ROOT: root,
    NO_COLOR: "1", CI: "true", TZ: "UTC",
  };
}

function run(args, { cwd, env, label, timeout = 90_000, expectedCode = 0 }) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`${label} could not start (${error.code ?? "spawn error"}).`)); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== expectedCode || timedOut) {
        // Package/npm diagnostics can contain data. Report only a status and npm's code.
        const npmCode = stderr.match(/npm (?:error|ERR!) code ([A-Z0-9_]+)/i)?.[1];
        reject(new Error(`${label} failed (${timedOut ? "timeout" : code ?? signal})${npmCode ? `: ${npmCode}` : ""}.`));
      } else resolveResult({ stdout, stderr });
    });
  });
}

function assertInside(root, path) {
  const remainder = relative(root, path);
  assert.ok(remainder && remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder), "Path must stay inside the smoke temporary directory.");
}

function validatePacklist(pack, manifest) {
  assert.equal(pack.name, manifest.name, "Packed package name differs from its manifest.");
  assert.equal(pack.version, manifest.version, "Packed package version differs from its manifest.");
  assert.ok(Array.isArray(pack.files) && pack.files.length > 0, "Tarball has no file inventory.");
  const paths = new Set(pack.files.map((file) => file.path));
  for (const path of paths) {
    const safePath = !path.includes("\\") && !path.split("/").some((part) => part === ".." || part.startsWith("."));
    const publicFile = /^(?:package\.json|readme(?:\.md)?|licen[cs]e(?:\.md|\.txt)?)$/i.test(path);
    const compiledFile = /^dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.d\.ts|\.js)$/.test(path);
    const sensitiveName = /(?:^|\/)(?:__tests__|tests?|fixtures?|receipts?|attachments?|uploads?|secrets?|credentials?)(?:\/|\.)/i.test(path);
    assert.ok(safePath && !sensitiveName && (publicFile || compiledFile), "Tarball contains a forbidden file; only compiled JS/types and package documentation are allowed.");
  }
  assert.ok(paths.has("package.json"), "Tarball is missing package.json.");
  assert.ok([...paths].some((path) => /^readme(?:\.md)?$/i.test(path)), "Tarball is missing README.");
  assert.ok([...paths].some((path) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(path)), "Tarball is missing LICENSE.");
  for (const entry of ["dist/client.js", "dist/client.d.ts", ...Object.values(manifest.bin ?? {})]) {
    assert.ok(paths.has(entry.replace(/^\.\//, "")), "Tarball is missing a public entry point.");
  }
}

// This preload applies only to installed package probes, never to npm itself.
// Attempts are fatal even when the package catches the thrown error.
const guardSource = String.raw`
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
let violations = 0;
function deny() { violations += 1; throw new Error("Release smoke forbids network and filesystem side effects."); }
globalThis.fetch = async () => deny();
for (const [target, names] of [
  [http, ["request", "get"]], [https, ["request", "get"]],
  [net, ["connect", "createConnection"]], [net.Socket.prototype, ["connect"]],
  [tls, ["connect"]], [dgram, ["createSocket"]],
  [dns, ["lookup", "resolve", "resolve4", "resolve6"]],
  [dns.promises, ["lookup", "resolve", "resolve4", "resolve6"]],
]) for (const name of names) target[name] = deny;
const mutations = ["writeFile", "appendFile", "truncate", "unlink", "rm", "rmdir", "mkdir", "rename", "copyFile", "cp", "link", "symlink", "chmod", "chown", "utimes", "createWriteStream"];
for (const name of mutations) {
  if (typeof fs[name] === "function") fs[name] = deny;
  if (typeof fs[name + "Sync"] === "function") fs[name + "Sync"] = deny;
  if (typeof fsp[name] === "function") fsp[name] = deny;
}
function checkRead(path) {
  if (typeof path === "number") return;
  const text = path instanceof URL ? fileURLToPath(path) : String(path);
  if (!/(?:^|[\\/])\.env(?:\.[^\\/]*)?$/.test(text)) return;
  if (process.env.FREDDY_SMOKE_CLIENT === "1") return deny();
  const remainder = relative(process.env.FREDDY_SMOKE_ROOT, resolve(text));
  if (remainder === ".." || remainder.startsWith(".." + sep) || isAbsolute(remainder)) return deny();
}
for (const name of ["readFile", "readFileSync", "createReadStream", "existsSync", "access", "accessSync", "stat", "statSync"]) {
  const original = fs[name];
  fs[name] = function(path, ...args) { checkRead(path); return original.call(this, path, ...args); };
}
for (const name of ["readFile", "access", "stat"]) {
  const original = fsp[name];
  fsp[name] = function(path, ...args) { checkRead(path); return original.call(this, path, ...args); };
}
for (const [target, name] of [[fs, "open"], [fs, "openSync"], [fsp, "open"]]) {
  const original = target[name];
  target[name] = function(path, flags, ...args) {
    checkRead(path);
    if ((typeof flags === "string" && /[wa+]/.test(flags)) || (typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)))) deny();
    return original.call(this, path, flags, ...args);
  };
}
if (typeof process.loadEnvFile === "function") process.loadEnvFile = deny;
syncBuiltinESMExports();
process.on("exit", () => { if (violations) process.exitCode = 86; });
`;

const clientProbeSource = String.raw`
import assert from "node:assert/strict";
const before = { ...process.env };
const client = await import(process.argv[2] + "/client");
assert.equal(typeof client[process.argv[3]], "function");
assert.equal(typeof client.apiKeyAuth, "function");
new client[process.argv[3]]({ auth: client.apiKeyAuth("synthetic-smoke-key") });
assert.deepEqual({ ...process.env }, before, "Importing the client changed process.env.");
process.once("beforeExit", () => {
  assert.deepEqual({ ...process.env }, before, "Client import scheduled an environment side effect.");
  console.log("Client import passed.");
});
`;

async function handshake(binary, guard, cwd, env, specification) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(guard).href, binary], {
    cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  let stderr = "";
  let protocolError;
  let closing = false;
  let closed = false;
  const rejectPending = (error) => {
    protocolError ??= error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", () => rejectPending(new Error(`${specification.name}: stdio process could not start.`)));
  child.stdin.on("error", () => { if (!closing) rejectPending(new Error("MCP stdin closed unexpectedly.")); });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { rejectPending(new Error("MCP stdout contains non-JSON protocol output.")); continue; }
      if (message.jsonrpc !== "2.0") { rejectPending(new Error("MCP response is not JSON-RPC 2.0.")); continue; }
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error("MCP request returned an error.")) : request.resolve(message.result); }
    }
  });
  const completion = new Promise((resolveResult) => child.once("close", (code, signal) => {
    closed = true;
    if (!closing) rejectPending(new Error(`MCP exited before shutdown (${code ?? signal}).`));
    resolveResult({ code, signal });
  }));
  const timeout = setTimeout(() => { rejectPending(new Error("MCP handshake timed out.")); child.kill(); }, 15_000);
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (id, method, params) => new Promise((resolveResult, reject) => {
    if (protocolError || closed) { reject(protocolError ?? new Error("MCP process is closed.")); return; }
    pending.set(id, { resolve: resolveResult, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
  try {
    const initialized = await request(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "freddy-release-smoke", version: "1.0.0" } });
    assert.equal(typeof initialized.protocolVersion, "string");
    assert.equal(typeof initialized.serverInfo?.name, "string");
    assert.ok(initialized.capabilities?.tools, "MCP must advertise tools.");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await request(2, "tools/list", {});
    assert.ok(Array.isArray(listed.tools) && listed.tools.length > 0, "MCP tools/list is empty.");
    for (const name of specification.requiredTools) assert.ok(listed.tools.some((tool) => tool.name === name), `MCP is missing required tool ${name}.`);
    for (const tool of listed.tools) {
      assert.ok(tool.name.startsWith(`${specification.vendor}_`), "MCP tool has an unexpected vendor prefix.");
      assert.equal(tool.inputSchema?.type, "object", "MCP tool must expose an input object schema.");
    }
    closing = true;
    child.stdin.end();
    const result = await completion;
    assert.equal(result.code, 0, "MCP did not shut down cleanly or attempted forbidden network/filesystem activity.");
    assert.equal(stderr, "", "MCP handshake emitted unexpected stderr.");
    if (protocolError) throw protocolError;
  } finally {
    clearTimeout(timeout);
    if (!closed) { closing = true; child.kill(); await completion; }
  }
}

async function main() {
  const npm = npmCli();
  const root = await mkdtemp(join(tmpdir(), "freddy-release-smoke-"));
  const canonicalRoot = await realpath(root);
  try {
    const env = isolatedEnvironment(root);
    // Existing env loaders inspect eight ancestors: every inspected ancestor stays
    // inside this new synthetic sandbox even before the preload's env-read guard.
    const consumer = join(root, "runtime", ...Array.from({ length: 9 }, (_, index) => `level-${index}`), "consumer");
    for (const directory of [consumer, env.HOME, env.APPDATA, env.LOCALAPPDATA, env.TEMP, join(root, "tarballs")]) await mkdir(directory, { recursive: true });
    await writeFile(env.npm_config_userconfig, "");
    await writeFile(env.npm_config_globalconfig, "");
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "freddy-release-consumer", private: true, version: "0.0.0", type: "module" }));
    const sentinel = "FREDDY_SMOKE_ENV_SENTINEL=must-not-be-loaded-by-client\n";
    await writeFile(join(consumer, ".env"), sentinel);
    const tarballs = [];
    const manifests = new Map();
    for (const specification of packages) {
      const cwd = join(repository, "packages", specification.directory);
      const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      assert.equal(manifest.name, specification.name);
      assert.ok(existsSync(join(cwd, "dist", "client.js")), `${specification.name} needs a fresh build before release smoke.`);
      const packed = await run([npm, "pack", cwd, "--json", "--ignore-scripts", "--workspaces=false", "--pack-destination", join(root, "tarballs")], { cwd: consumer, env, label: `npm pack ${specification.name}` });
      const metadata = JSON.parse(packed.stdout);
      assert.equal(metadata.length, 1, "npm pack must produce exactly one tarball.");
      validatePacklist(metadata[0], manifest);
      const tarball = resolve(root, "tarballs", metadata[0].filename);
      assertInside(join(root, "tarballs"), tarball);
      tarballs.push(tarball);
      manifests.set(specification.name, manifest);
    }
    await run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", ...tarballs], { cwd: consumer, env, label: "Clean tarball install", timeout: 120_000 });
    const guard = join(root, "runtime-guard.mjs");
    const clientProbe = join(consumer, "client-probe.mjs");
    await writeFile(guard, guardSource);
    await writeFile(clientProbe, clientProbeSource);
    for (const specification of packages) {
      const installed = join(consumer, "node_modules", ...specification.name.split("/"));
      const installedReal = await realpath(installed);
      assertInside(await realpath(consumer), installedReal);
      const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
      assert.equal(manifest.version, manifests.get(specification.name).version);
      const imported = await run(["--import", pathToFileURL(guard).href, clientProbe, specification.name, specification.client], { cwd: consumer, env: { ...env, FREDDY_SMOKE_CLIENT: "1" }, label: `${specification.name} /client import`, timeout: 15_000 });
      assert.equal(imported.stdout.trim(), "Client import passed.", "Client import did not complete cleanly or wrote to stdout.");
      assert.equal(imported.stderr, "", "Client import wrote to stderr.");
      const cli = resolve(installed, manifest.bin[specification.vendor]);
      assertInside(installed, cli);
      const help = await run(["--import", pathToFileURL(guard).href, cli, "--help"], { cwd: consumer, env, label: `${specification.name} CLI --help without credentials`, timeout: 15_000 });
      assert.match(help.stdout, /usage:/i, "CLI --help must print usage to stdout.");
      assert.equal(help.stderr, "", "CLI --help emitted unexpected stderr.");
      for (const deniedCommand of specification.deniedCommands) {
        const denied = await run(["--import", pathToFileURL(guard).href, cli, ...deniedCommand], {
          cwd: consumer, env: { ...env, FREDDY_SMOKE_CLIENT: "1" },
          label: specification.name + " CLI missing --confirm: " + deniedCommand[0],
          timeout: 15_000, expectedCode: 1,
        });
        assert.match(denied.stderr, /--confirm/, "Mutating CLI commands must require --confirm before reading credentials or files.");
        assert.equal(denied.stdout, "", "Denied CLI command wrote unexpected output.");
      }
      if (specification.vendor === "fiken") {
        const paymentFields = [["--payment-date", "2026-09-02"], ["--payment-account", "1920:10001"], ["--payment-nok", "100"]];
        for (const [missing] of paymentFields) {
          const args = ["purchase", "--confirm", "--company", "synthetic-company", "--date", "2026-09-01", "--currency", "NOK", "--description", "synthetic purchase", "--vat", "NONE", "--net", "100", ...paymentFields.filter(([flag]) => flag !== missing).flat()];
          const denied = await run(["--import", pathToFileURL(guard).href, cli, ...args], {
            cwd: consumer, env: { ...env, FREDDY_SMOKE_CLIENT: "1" },
            label: specification.name + " paid CLI missing " + missing,
            timeout: 15_000, expectedCode: 1,
          });
          assert.ok(denied.stderr.includes(missing), "Paid CLI purchase must require each explicit Folio booking field before reading credentials.");
          assert.equal(denied.stdout, "", "Denied paid purchase wrote unexpected output.");
        }
      }
      const binary = resolve(installed, manifest.bin[`${specification.vendor}-mcp`]);
      assertInside(installed, binary);
      await handshake(binary, guard, consumer, { ...env, FOLIO_API_KEY: "synthetic-smoke-folio-key", FIKEN_API_TOKEN: "synthetic-smoke-fiken-key" }, specification);
      assert.equal(await readFile(join(consumer, ".env"), "utf8"), sentinel, "A package changed the synthetic env fixture.");
      console.log(`${specification.name}: tarball, isolated install, client, CLI, MCP passed`);
    }
    console.log("Release smoke passed; no vendor network requests.");
  } finally {
    // Never delete a computed/replaced path without checking its actual identity.
    assert.equal(await realpath(root), canonicalRoot, "Temporary directory identity changed; cleanup refused.");
    assertInside(await realpath(tmpdir()), canonicalRoot);
    await rm(canonicalRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Release smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
