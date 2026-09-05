import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

try {
const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg === -1 ? '.' : process.argv[rootArg + 1]);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))];
const forbidden = /(^|\/)(?:\.env(?:\..+)?|\.npmrc|receipts?|bookkeeping-data|backups|agent-transcripts|tmp|node_modules|\.next|\.vercel)(?:\/|$)|\.(?:pdf|csv|xlsx?|pem|key|p12|sqlite|db|tgz|mcpb)$/i;
const knownSecrets = [];
function readEnv(dir, depth = 0) {
  if (depth > 4) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', 'tmp', 'dist', '.next', 'receipts', 'backups'].includes(entry.name)) readEnv(path, depth + 1);
    if (entry.isFile() && /^\.env(?:\..+)?$/.test(entry.name) && entry.name !== '.env.example') {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || !/TOKEN|SECRET|API_?KEY|PASSWORD|DATABASE_URL/.test(match[1])) continue;
        const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
        if (value.length >= 12) knownSecrets.push(value);
      }
    }
  }
}
readEnv(root);
const findings = [];
const admitted = [];
for (const file of files) {
  const path = resolve(root, file);
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Candidate path escapes workspace');
  if (!existsSync(path)) continue; // tracked deletion
  if (lstatSync(path).isSymbolicLink()) { findings.push(`${file}: symbolic link requires review`); continue; }
  if (forbidden.test(file) && !/(^|\/)\.env\.example$/.test(file)) { findings.push(`${file}: private/artifact path`); continue; }
  if (lstatSync(path).size > 1024 * 1024) { findings.push(file + ": oversized public file requires review"); continue; }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) { findings.push(`${file}: binary file requires review`); continue; }
  const content = bytes.toString('utf8');
  if (knownSecrets.some(secret => content.includes(secret))) findings.push(`${file}: local credential match (redacted)`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push(`${file}: private key material (redacted)`);
  admitted.push(file);
}
const indexFiles = [];
for (const entry of git('ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
  const match = entry.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
  if (!match) throw new Error('Invalid Git index entry');
  const [, mode, oid, stage, file] = match;
  if (stage !== '0' || mode === '120000' || mode === '160000') { findings.push(file + ': unresolved or linked index entry'); continue; }
  if (forbidden.test(file) && !/(^|\/)\.env\.example$/.test(file)) { findings.push(file + ': private/artifact path in index'); continue; }
  if (Number(git('cat-file', '-s', oid).trim()) > 1024 * 1024) { findings.push(file + ': oversized index blob requires review'); continue; }
  const content = git('cat-file', 'blob', oid);
  if (content.includes('\0')) { findings.push(file + ': binary index entry requires review'); continue; }
  if (knownSecrets.some(secret => content.includes(secret))) findings.push(file + ': local credential match in index (redacted)');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push(file + ': private key in index (redacted)');
  indexFiles.push({file, content});
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
if (process.env.GITLEAKS_BIN || process.argv.includes('--require-gitleaks')) {
  const snapshot = mkdtempSync(join(tmpdir(), 'freddy-public-scan-'));
  try {
    for (const file of admitted) {
      const target = join(snapshot, 'worktree', file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, file), target);
    }
    for (const {file, content} of indexFiles) {
      const target = resolve(snapshot, 'index', file);
      if (!target.startsWith(resolve(snapshot, 'index') + sep)) throw new Error('Unsafe index path');
      mkdirSync(dirname(target), {recursive:true}); writeFileSync(target, content);
    }
    const scan = spawnSync(process.env.GITLEAKS_BIN || 'gitleaks', ['dir', snapshot, '--redact', '--no-banner', '--exit-code', '1'], { encoding: 'utf8' });
    // Never relay scanner output: even diagnostics from third-party tools may include matched data.
    if (scan.error || scan.status !== 0) {
      console.error('Gitleaks failed or found a potential secret. Inspect locally with --redact; no scanner payload is printed.');
      process.exitCode = 1;
    } else {
      const hasHistory = git('rev-list', '--all', '--count').trim() !== '0';
      if (hasHistory) {
        const history = spawnSync(process.env.GITLEAKS_BIN || 'gitleaks', ['git', root, '--redact', '--no-banner', '--log-opts=--all'], {encoding:'utf8', env:{...process.env, GIT_CONFIG_COUNT:'1', GIT_CONFIG_KEY_0:'safe.directory', GIT_CONFIG_VALUE_0:root.replaceAll('\\','/')}});
        if (history.error || history.status !== 0) { console.error('Gitleaks history scan failed; output withheld.'); process.exitCode = 1; }
      }
      if (!process.exitCode) console.log('Gitleaks passed for ' + admitted.length + ' public candidate files, ' + indexFiles.length + ' index blobs' + (hasHistory ? ' and Git history.' : '; no commits yet.'));
    }
  } finally {
    if (dirname(snapshot) !== tmpdir() || !snapshot.split(sep).at(-1).startsWith('freddy-public-scan-')) throw new Error('Unsafe cleanup path');
    rmSync(snapshot, { recursive: true, force: true });
  }
} else console.log(`Publication hygiene passed for ${admitted.length} candidate files; run with --require-gitleaks for the full scanner.`);

} catch {
  console.error("Publication scan failed; diagnostic content withheld. Check repository access and file sizes locally.");
  process.exitCode = 1;
}
