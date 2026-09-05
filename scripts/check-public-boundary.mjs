#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootFiles = new Set([
  'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md',
  '.gitignore', '.gitattributes', '.node-version', 'release.config.json', '.dockerignore',
  '.github/workflows/ci.yml', '.github/workflows/release.yml',
  'docs/hosting.md', 'docs/releases.md', 'docs/index.html', 'deploy/folio.Dockerfile', 'deploy/fiken.Dockerfile',
  'docker-compose.yml', 'docker-compose.folio-oauth.yml', 'docker-compose.fiken-oauth.yml',
  ...['release-smoke', 'secret-scan', 'release-preflight', 'check-public-boundary'].map(name => `scripts/${name}.mjs`),
  ...['release-smoke', 'secret-scan', 'release-preflight', 'public-boundary'].map(name => `scripts/tests/${name}.test.mjs`),
]);
const packageRootFiles = new Set(['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'tsconfig.json', 'vitest.config.ts']);
const packageDirectories = ['packages/folio-mcp', 'packages/fiken-mcp'];

export class PublicBoundaryError extends Error {}
function refuse(scope, reason) { throw new PublicBoundaryError(`Public MCP boundary rejected ${scope}: ${reason}. Diagnostic payloads are withheld.`); }
function safeComponents(path) { return !path.includes('\\') && path.split('/').every(part => part && part !== '..' && part !== '.' && !part.startsWith('.')); }
function allowedFile(path) {
  if (rootFiles.has(path)) return true;
  for (const directory of packageDirectories) {
    if (!path.startsWith(directory + '/')) continue;
    const remainder = path.slice(directory.length + 1);
    if (packageRootFiles.has(remainder)) return true;
    if (/^(src|tests)\/.+\.ts$/.test(remainder) && safeComponents(remainder)) return true;
  }
  return false;
}
function allowedDirectory(path) {
  if ([...rootFiles].some(file => file.startsWith(path + '/'))) return true;
  if (packageDirectories.some(directory => directory === path || directory.startsWith(path + '/'))) return true;
  return /^packages\/(folio|fiken)-mcp\/(src|tests)(?:\/.*)?$/.test(path) && safeComponents(path);
}
function isolatedGitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
}
function gitReader(root) {
  return (...args) => {
    const result = spawnSync('git', ['--no-optional-locks', '-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], {
      encoding: 'utf8', env: isolatedGitEnvironment(), windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 30_000,
    });
    if (result.error || result.status !== 0) refuse('repository access', 'Git inspection failed');
    return result.stdout;
  };
}
function physicalFiles(root) {
  const files = new Map();
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (path === '.git') continue;
      // Installed dependencies and compiler output are not source candidates.
      // These paths remain forbidden in the index and every committed tree.
      if (entry.isDirectory() && (/^(?:packages\/(?:folio|fiken)-mcp\/)?node_modules$/.test(path) || /^packages\/(?:folio|fiken)-mcp\/dist$/.test(path))) continue;
      if (entry.isSymbolicLink()) refuse('working tree', 'symbolic links are forbidden');
      if (entry.isDirectory()) {
        if (!allowedDirectory(path)) refuse('working tree', 'a directory is outside the public source allowlist');
        visit(join(directory, entry.name), path);
      } else {
        if (!entry.isFile() || !allowedFile(path)) refuse('working tree', 'a file is outside the public source allowlist');
        files.set(path, { path: join(directory, entry.name) });
      }
    }
  }
  visit(root);
  return files;
}
function indexedFiles(git) {
  const files = new Map();
  for (const record of git('ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
    const match = record.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
    if (!match || match[3] !== '0') refuse('index', 'unmerged or invalid entries exist');
    const [, mode, oid, , path] = match;
    if (!['100644', '100755'].includes(mode)) refuse('index', 'symbolic links and submodules are forbidden');
    if (!allowedFile(path)) refuse('index', 'a path is outside the public source allowlist');
    files.set(path, { oid });
  }
  return files;
}
function committedFiles(git, tree) {
  const files = new Map();
  for (const record of git('ls-tree', '-r', '-z', '--full-tree', tree).split('\0').filter(Boolean)) {
    const match = record.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) refuse('history', 'an invalid tree entry exists');
    const [, mode, type, oid, path] = match;
    if (!['100644', '100755'].includes(mode) || type !== 'blob') refuse('history', 'symbolic links and submodules are forbidden');
    if (!allowedFile(path)) refuse('history', 'a committed path is outside the public source allowlist');
    files.set(path, { oid });
  }
  return files;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function publicWorkspaces(value, scope) {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'packages/*') refuse(scope, 'workspace configuration must contain only packages/*');
}
function localDependency(value, base, scope) {
  if (typeof value !== 'string') refuse(scope, 'local dependency target is invalid');
  const target = value.replace(/^(?:file|link|portal):/, '').replaceAll('\\', '/');
  if (!target || target.startsWith('/') || /^[a-zA-Z]:/.test(target)) refuse(scope, 'absolute local dependencies are forbidden');
  const normalized = posix.normalize(posix.join(base, target));
  if (!packageDirectories.includes(normalized)) refuse(scope, 'local dependency escapes the two MCP packages');
}
function dependencies(value, base, scope) {
  if (value === undefined) return;
  if (!object(value)) refuse(scope, 'invalid dependency metadata');
  for (const [name, version] of Object.entries(value)) {
    if (object(version)) { dependencies(version, base, scope); continue; }
    if (typeof version !== 'string') refuse(scope, 'invalid dependency declaration');
    if (version.startsWith('workspace:')) {
      if (!['@bruchris/folio-mcp', '@bruchris/fiken-mcp'].includes(name) || !['workspace:*', 'workspace:^', 'workspace:~'].includes(version)) refuse(scope, 'private or unsupported workspace dependency');
    } else if (/^(?:file:|link:|portal:|\.{1,2}[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(version)) localDependency(version, base, scope);
  }
}
function dependencyFields(manifest, base, scope) {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions']) dependencies(manifest[key], base, scope);
}
function lockfile(lock, scope) {
  if (!object(lock) || ![2, 3].includes(lock.lockfileVersion) || !object(lock.packages) || !object(lock.packages[''])) refuse(scope, 'a workspace-aware npm lockfile is required');
  publicWorkspaces(lock.packages[''].workspaces, scope);
  for (const [path, record] of Object.entries(lock.packages)) {
    if (!object(record)) refuse(scope, 'invalid lockfile package record');
    if (path && !packageDirectories.includes(path) && !(/^(?:packages\/(?:folio|fiken)-mcp\/)?node_modules\/.+/.test(path) && safeComponents(path))) refuse(scope, 'lockfile includes a private or unexpected workspace');
    if (path !== '' && record.workspaces !== undefined) refuse(scope, 'nested workspaces are forbidden');
    const base = packageDirectories.includes(path) ? path : '';
    dependencyFields(record, base, scope);
    if (record.link === true) localDependency(record.resolved, '', scope);
    else if (typeof record.resolved === 'string' && (/^(?:file:|link:|portal:|\.{1,2}[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(record.resolved) || !/^[a-z][a-z0-9+.-]*:/i.test(record.resolved))) localDependency(record.resolved, '', scope);
  }
  // Version 2 can also carry legacy records; inspect their local resolutions.
  function legacy(records) {
    if (records === undefined) return;
    if (!object(records)) refuse(scope, 'invalid legacy lock metadata');
    for (const record of Object.values(records)) {
      if (!object(record)) refuse(scope, 'invalid legacy lock package');
      for (const key of ['version', 'resolved']) if (typeof record[key] === 'string' && /^(?:file:|link:|portal:|\.{1,2}[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(record[key])) localDependency(record[key], '', scope);
      legacy(record.dependencies);
    }
  }
  legacy(lock.dependencies);
}
function validateMetadata(files, scope, read, required = false) {
  if (required && (!files.has('package.json') || !files.has('package-lock.json'))) refuse(scope, 'root manifest and npm lockfile are required');
  function json(path) {
    if (!files.has(path)) return undefined;
    try { return JSON.parse(read(files.get(path))); } catch (error) {
      if (error instanceof PublicBoundaryError) throw error;
      refuse(scope, 'invalid JSON metadata');
    }
  }
  const root = json('package.json');
  if (root !== undefined) {
    if (!object(root)) refuse(scope, 'invalid root package manifest');
    publicWorkspaces(root.workspaces, scope);
    dependencyFields(root, '', scope);
  }
  for (const directory of packageDirectories) {
    const manifest = json(directory + '/package.json');
    if (manifest === undefined) continue;
    if (!object(manifest) || manifest.name !== '@bruchris/' + directory.split('/')[1] || manifest.workspaces !== undefined) refuse(scope, 'invalid MCP package identity or nested workspace');
    dependencyFields(manifest, directory, scope);
  }
  const lock = json('package-lock.json');
  if (lock !== undefined) lockfile(lock, scope);
}
export function checkPublicBoundary(directory = process.cwd()) {
  const root = realpathSync(resolve(directory));
  const metadata = join(root, '.git');
  if (!existsSync(metadata) || !lstatSync(metadata).isDirectory() || lstatSync(metadata).isSymbolicLink()) refuse('repository', 'a standalone Git directory is required');
  const git = gitReader(root);
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) refuse('repository', 'Git root differs from the inspected directory');
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'false') refuse('history', 'shallow history cannot be verified');
  if (existsSync(join(metadata, 'info', 'grafts'))) refuse('history', 'grafted history cannot be verified');
  // git log omits refs to tree/blob objects, but those objects are still public
  // when their tags are pushed. Every ref must ultimately resolve to a commit.
  const refObjects = new Set(git('for-each-ref', '--format=%(objectname)').split(/\r?\n/).filter(Boolean));
  for (const oid of refObjects) {
    if (!/^[a-f0-9]{40,64}$/.test(oid) || git('cat-file', '-t', `${oid}^{}`).trim() !== 'commit') refuse('history', 'a ref does not resolve to a commit');
  }
  const working = physicalFiles(root);
  const blobCache = new Map();
  const read = (entry) => {
    if (entry.path) {
      if (lstatSync(entry.path).size > 4 * 1024 * 1024) refuse('working tree', 'oversized metadata cannot be verified');
      return readFileSync(entry.path, 'utf8');
    }
    if (!blobCache.has(entry.oid)) {
      const size = Number(git('cat-file', '-s', entry.oid).trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 * 1024) refuse('Git metadata', 'oversized metadata cannot be verified');
      blobCache.set(entry.oid, git('cat-file', 'blob', entry.oid));
    }
    return blobCache.get(entry.oid);
  };
  validateMetadata(working, 'working tree', read, true);
  validateMetadata(indexedFiles(git), 'index', read);
  const trees = [...new Set(git('log', '--all', '--reflog', '--format=%T').split(/\r?\n/).filter(Boolean))];
  for (const tree of trees) {
    if (!/^[a-f0-9]{40,64}$/.test(tree)) refuse('history', 'invalid tree identity');
    validateMetadata(committedFiles(git, tree), 'history', read);
  }
  return { files: working.size, trees: trees.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root')) throw new PublicBoundaryError('Usage: node scripts/check-public-boundary.mjs [--root directory]');
    const result = checkPublicBoundary(args[1] ?? process.cwd());
    console.log(`Public MCP boundary passed for working tree, index, and ${result.trees} reachable trees.`);
  } catch (error) {
    console.error(error instanceof PublicBoundaryError ? error.message : 'Public MCP boundary failed; diagnostic content withheld.');
    process.exitCode = 1;
  }
}