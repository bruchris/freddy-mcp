import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../check-public-boundary.mjs', import.meta.url));
function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
}
function git(root, ...args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-c', 'user.name=Public boundary test', '-c', 'user.email=boundary@example.invalid', '-c', `core.hooksPath=${join(root, '.git', 'no-hooks')}`, '-C', root, ...args], { env: environment(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Synthetic Git setup failed; subprocess output withheld.');
  return result.stdout;
}
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'freddy-boundary-test-'));
  const canonical = realpathSync(root);
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content)); };
  try {
    git(root, 'init', '--quiet');
    write('package.json', { name: 'freddy-mcp', private: true, workspaces: ['packages/*'] });
    write('package-lock.json', { name: 'freddy-mcp', lockfileVersion: 3, packages: { '': { name: 'freddy-mcp', workspaces: ['packages/*'] } } });
    write('README.md', 'Public Folio and Fiken adapters.\n');
    git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'Public MCP source');
    run({ root, write, run: () => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', env: environment(), windowsHide: true }) });
  } finally {
    assert.equal(realpathSync(root), canonical, 'Temporary directory changed; cleanup refused.');
    const rel = relative(realpathSync(tmpdir()), canonical);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Cleanup escaped the test temporary directory.');
    rmSync(canonical, { recursive: true, force: true });
  }
}

test('a standalone public MCP tree passes but deleted private source remains forbidden in its history', () => {
  fixture(({ root, write, run }) => {
    const clean = run();
    assert.equal(clean.status, 0, 'Clean public source must pass.');
    assert.match(clean.stdout, /Public MCP boundary passed/);
    const marker = ['SYNTHETIC', 'PRIVATE', 'APP', 'CONTENT'].join('_');
    write('apps/freddy/private.ts', marker);
    git(root, 'add', 'apps'); git(root, 'commit', '--quiet', '-m', 'Synthetic private source');
    git(root, 'rm', '--quiet', '-r', 'apps'); git(root, 'commit', '--quiet', '-m', 'Remove synthetic private source');
    const rejected = run();
    assert.equal(rejected.status, 1, 'Deleting private source must not make its history publishable.');
    assert.match(rejected.stderr, /history/i);
    assert.equal((rejected.stdout + rejected.stderr).includes(marker), false, 'Diagnostics must never print private blob contents.');
  });
});
test('workspace and local dependency boundaries apply to working files, staged bytes, and old manifests', () => {
  fixture(({ root, write, run }) => {
    const safe = { name: 'freddy-mcp', private: true, workspaces: ['packages/*'] };
    write('package.json', { ...safe, workspaces: ['packages/*', 'apps/*'] });
    assert.equal(run().status, 1, 'A private app workspace must be rejected in the working manifest.');
    git(root, 'add', 'package.json');
    write('package.json', safe);
    const index = run();
    assert.equal(index.status, 1, 'Cleaning a working manifest must not hide private staged workspaces.');
    assert.match(index.stderr, /index/i);
    git(root, 'commit', '--quiet', '-m', 'Synthetic private workspace metadata');
    git(root, 'add', 'package.json'); git(root, 'commit', '--quiet', '-m', 'Restore public workspace metadata');
    const history = run();
    assert.equal(history.status, 1, 'Historical app workspace metadata must remain forbidden.');
    assert.match(history.stderr, /history/i);
  });
  for (const entry of [
    ['apps/freddy', { name: '@bruchris/freddy' }],
    ['node_modules/private-app', { resolved: '../private-app', link: true }],
    ['node_modules/private-app', { resolved: 'file:../private-app' }],
  ]) fixture(({ write, run }) => {
    write('package-lock.json', { lockfileVersion: 3, packages: { '': { workspaces: ['packages/*'] }, [entry[0]]: entry[1] } });
    assert.equal(run().status, 1, 'Public lockfiles must exclude application workspaces and external local dependencies.');
  });
});
test('ignored private files are rejected while untracked build output remains outside the source boundary', () => fixture(({ root, write, run }) => {
  write('.gitignore', '.env\nnode_modules/\npackages/*/dist/\n');
  write('node_modules/synthetic-dependency/index.js', 'Synthetic installed dependency.');
  write('packages/folio-mcp/dist/client.js', 'Synthetic compiler output.');
  assert.equal(run().status, 0, 'Installing/building dependencies must not make source validation fail.');
  const marker = ['SYNTHETIC', 'IGNORED', 'PRIVATE', 'VALUE'].join('_');
  write('.env', marker);
  const result = run();
  assert.equal(result.status, 1, 'Ignored environment files must remain outside the public export.');
  assert.equal((result.stdout + result.stderr).includes(marker), false, 'Ignored file diagnostics must not expose contents.');
}));

test('symbolic-link and submodule modes are blocked in the index and historical trees', () => {
  for (const mode of ['120000', '160000']) fixture(({ root, run }) => {
    const blob = git(root, 'rev-parse', 'HEAD:README.md').trim();
    const oid = mode === '160000' ? git(root, 'rev-parse', 'HEAD').trim() : blob;
    git(root, 'update-index', '--add', '--cacheinfo', `${mode},${oid},README.md`);
    const staged = run();
    assert.equal(staged.status, 1, 'Linked index entries must be blocked.');
    assert.match(staged.stderr, /index/);
    git(root, 'commit', '--quiet', '-m', 'Synthetic linked entry');
    git(root, 'update-index', '--cacheinfo', `100644,${blob},README.md`);
    git(root, 'commit', '--quiet', '-m', 'Restore regular public file');
    const history = run();
    assert.equal(history.status, 1, 'Deleting linked entries must not hide their committed history.');
    assert.match(history.stderr, /history/);
  });
});

test('shallow history cannot be treated as verified public source', () => fixture(({ root, write, run }) => {
  write('.git/shallow', git(root, 'rev-parse', 'HEAD'));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shallow/);
}));
test('tree and blob tags cannot expose private objects outside commit history', () => {
  for (const kind of ['tree', 'blob']) for (const annotated of [false, true]) fixture(({ root, write, run }) => {
    const marker = ['SYNTHETIC', 'PRIVATE', 'TAGGED', 'OBJECT'].join('_');
    write('apps/freddy/private.ts', marker);
    git(root, 'add', 'apps');
    const tree = git(root, 'write-tree').trim();
    const target = kind === 'tree' ? tree : git(root, 'rev-parse', `${tree}:apps/freddy/private.ts`).trim();
    git(root, 'tag', ...(annotated ? ['-a', '-m', 'Synthetic object tag'] : []), 'private-object', target);
    git(root, 'reset', '--quiet', 'HEAD');
    const privateDirectory = resolve(root, 'apps');
    assert.equal(relative(root, privateDirectory), 'apps', 'Fixture cleanup must stay beneath its temporary root.');
    rmSync(privateDirectory, { recursive: true, force: true });
    const result = run();
    assert.equal(result.status, 1, 'Tags pointing to non-commit objects must not bypass public history validation.');
    assert.match(result.stderr, /ref|tag|history/i);
    assert.equal((result.stdout + result.stderr).includes(marker), false, 'Tagged private blob contents must never be printed.');
  });
});

test('lightweight and annotated tags that resolve to public commits remain valid', () => fixture(({ root, run }) => {
  git(root, 'tag', 'folio-mcp-v0.1.0');
  git(root, 'tag', '-a', '-m', 'Public Fiken release', 'fiken-mcp-v0.1.0');
  assert.equal(run().status, 0, 'Public commit release tags must remain allowed.');
}));