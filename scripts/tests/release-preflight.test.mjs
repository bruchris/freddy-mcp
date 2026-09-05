import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../release-preflight.mjs', import.meta.url));

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), 'freddy-preflight-'));
  const canonical = realpathSync(root);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GITHUB_REPOSITORY: 'bruchris/freddy-mcp', GITHUB_OUTPUT: '' };
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content)); };
  const git = (...args) => {
    const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', '-c', `core.hooksPath=${join(root, '.git', 'no-hooks')}`, '-C', root, ...args], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, 'Synthetic Git operation failed; output withheld.');
  };
  try {
    write('release.config.json', { publicationScope: 'mcp-only', appSourceVisibility: 'private', repository: 'bruchris/freddy-mcp' });
    write('package.json', { name: 'freddy-mcp', private: true, workspaces: ['packages/*'] });
    write('package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'freddy-mcp', workspaces: ['packages/*'] } } });
    for (const vendor of ['folio', 'fiken']) {
      write(`packages/${vendor}-mcp/package.json`, { name: `@bruchris/${vendor}-mcp`, version: '0.1.0', repository: { type: 'git', url: 'git+https://github.com/bruchris/freddy-mcp.git', directory: `packages/${vendor}-mcp` } });
      write(`packages/${vendor}-mcp/CHANGELOG.md`, '# Changelog\n\n## 0.1.0\n\nInitial adapter release.');
    }
    git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '-m', 'Public adapters');
    const run = (vendor = 'folio', extra = {}) => spawnSync(process.execPath, [script, vendor], { cwd: root, encoding: 'utf8', env: { ...env, ...extra }, windowsHide: true });
    check({ root, write, git, run });
  } finally {
    assert.equal(realpathSync(root), canonical, 'Temporary directory changed; cleanup refused.');
    const rel = relative(realpathSync(tmpdir()), canonical);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Cleanup escaped the test temporary directory.');
    rmSync(canonical, { recursive: true, force: true });
  }
}

test('private Freddy workspace cannot publish even with the approved public MCP destination', () => fixture(({ write, run }) => {
  write('release.config.json', { publicationScope: 'private-workspace', appSourceVisibility: 'private', repository: 'bruchris/freddy', publicationRepository: 'bruchris/freddy-mcp' });
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private workspace/i);
}));

test('standalone MCP source can release while Freddy application source remains private', () => fixture(({ run }) => {
  for (const vendor of ['folio', 'fiken']) {
    const result = run(vendor);
    assert.equal(result.status, 0, 'Verified MCP source should release independently of the private app.');
    assert.match(result.stdout, new RegExp(`${vendor}-mcp-v0.1.0`));
  }
}));

test('preflight still rejects destination mismatch and missing version release notes', () => fixture(({ write, run }) => {
  assert.equal(run('folio', { GITHUB_REPOSITORY: 'bruchris/freddy' }).status, 1);
  write('packages/folio-mcp/CHANGELOG.md', '# Changelog\n\n## Unreleased');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release notes/);
}));

test('preflight refuses private application history even after the working source is removed', () => fixture(({ write, git, run }) => {
  const marker = ['SYNTHETIC', 'PRIVATE', 'RELEASE', 'MARKER'].join('_');
  write('apps/freddy/app.ts', marker);
  git('add', 'apps'); git('commit', '--quiet', '-m', 'Synthetic private application');
  git('rm', '--quiet', '-r', 'apps'); git('commit', '--quiet', '-m', 'Remove private application');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /history/i);
  assert.equal((result.stdout + result.stderr).includes(marker), false, 'Preflight must not disclose historical blob contents.');
}));