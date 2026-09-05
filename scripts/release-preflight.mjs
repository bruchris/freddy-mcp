import { appendFileSync, readFileSync } from 'node:fs';
import { checkPublicBoundary, PublicBoundaryError } from './check-public-boundary.mjs';

function reject(message) { throw new PublicBoundaryError(message); }
try {
  const vendor = process.argv[2];
  if (!['folio', 'fiken'].includes(vendor)) reject('Choose folio or fiken.');
  const config = JSON.parse(readFileSync('release.config.json', 'utf8'));
  if (config.publicationScope === 'private-workspace') {
    reject('The private workspace cannot publish. Release the reviewed standalone public MCP export instead.');
  }
  if (config.publicationScope !== 'mcp-only' || config.appSourceVisibility !== 'private' || config.repository !== 'bruchris/freddy-mcp') {
    reject('Public release requires the approved MCP-only repository while Freddy application source remains private.');
  }
  if (config.repository !== process.env.GITHUB_REPOSITORY) reject('Workflow repository differs from the approved public MCP destination.');
  checkPublicBoundary(process.cwd());
  const directory = `packages/${vendor}-mcp`;
  const pkg = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
  if (pkg.name !== `@bruchris/${vendor}-mcp` || !/^\d+\.\d+\.\d+$/.test(pkg.version)) reject('Invalid package name or release version.');
  if (pkg.repository?.url !== `git+https://github.com/${config.repository}.git` || pkg.repository?.directory !== directory) reject('Package source metadata differs from the approved public MCP destination.');
  const changelog = readFileSync(`${directory}/CHANGELOG.md`, 'utf8');
  if (!changelog.split(/\r?\n/).some(line => line === `## ${pkg.version}` || line.startsWith(`## ${pkg.version} - `))) reject('Version has no release notes.');
  const tag = `${vendor}-mcp-v${pkg.version}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Release preflight passed for ${tag}`);
} catch (error) {
  console.error(error instanceof PublicBoundaryError ? error.message : 'Release preflight failed; diagnostic content withheld.');
  process.exitCode = 1;
}