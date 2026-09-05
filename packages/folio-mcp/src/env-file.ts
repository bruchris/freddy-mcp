import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function loadEnvFiles(): string[] {
  const loaded: string[] = [];
  const seen = new Set<string>();
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const file = join(dir, ".env");
    if (existsSync(file) && !seen.has(file)) {
      applyEnvFile(file);
      loaded.push(file);
      seen.add(file);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return loaded;
}

function applyEnvFile(file: string) {
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function findEnvFile(preferredKey?: string): string | undefined {
  const loaded = loadEnvFiles();
  if (preferredKey) {
    const match = loaded.find((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .some((line) => line.startsWith(`${preferredKey}=`)),
    );
    if (match) return match;
  }
  return loaded[0];
}

export function upsertEnvValue(file: string, key: string, value: string) {
  const quoted = JSON.stringify(value);
  const text = readFileSync(file, "utf8");
  const line = `${key}=${quoted}`;
  if (new RegExp(`^${key}=`, "m").test(text)) {
    writeFileSync(file, text.replace(new RegExp(`^${key}=.*$`, "m"), line));
    return;
  }
  const suffix = text.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${text}${suffix}${line}\n`);
}
