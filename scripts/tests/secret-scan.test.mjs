import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const scanner = resolve('scripts/secret-scan.mjs');
test('publication scan rejects a leaked local credential without printing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'freddy-scan-test-'));
  try {
    const secret = ['synthetic', 'private', 'credential', '123456789'].join('-');
    spawnSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, '.gitignore'), '.env\n');
    writeFileSync(join(root, '.env'), 'FIKEN_API_TOKEN=' + secret + '\n');
    writeFileSync(join(root, 'README.md'), 'Token: ' + secret);
    const result = spawnSync(process.execPath, [scanner, '--root', root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /README.md/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
    writeFileSync(join(root, 'README.md'), 'Safe public documentation');
    const clean = spawnSync(process.execPath, [scanner, '--root', root], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('publication scan inspects staged bytes even if the working file was cleaned', () => {
  const root = mkdtempSync(join(tmpdir(), 'freddy-scan-index-'));
  try {
    spawnSync('git', ['init','--quiet',root]);
    const secret = ['synthetic','staged','credential','987654321'].join('-');
    writeFileSync(join(root,'.gitignore'),'.env\n');
    writeFileSync(join(root,'.env'),'FOLIO_API_KEY=' + secret);
    writeFileSync(join(root,'example.txt'),secret);
    spawnSync('git',['-C',root,'add','example.txt']);
    writeFileSync(join(root,'example.txt'),'clean');
    const result = spawnSync(process.execPath,[scanner,'--root',root],{encoding:'utf8'});
    assert.equal(result.status,1); assert.match(result.stderr,/index/); assert.ok(!result.stderr.includes(secret));
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('oversized staged files fail without disclosing subprocess output', () => {
  const root = mkdtempSync(join(tmpdir(), 'freddy-scan-size-'));
  try {
    spawnSync('git',['init','--quiet',root]);
    const marker = 'SYNTHETIC_BLOB_MUST_STAY_PRIVATE';
    writeFileSync(join(root,'large.txt'),marker + 'x'.repeat(2 * 1024 * 1024));
    spawnSync('git',['-C',root,'add','large.txt']);
    writeFileSync(join(root,'large.txt'),'clean');
    const result=spawnSync(process.execPath,[scanner,'--root',root],{encoding:'utf8',maxBuffer:5*1024*1024});
    assert.equal(result.status,1); assert.equal((result.stdout+result.stderr).includes(marker),false);
    assert.ok(/oversized|exceeds/.test(result.stderr));
  } finally {rmSync(root,{recursive:true,force:true});}
});
