import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSensitive, isSensitive, SensitivePathError, assertNotSensitive } from '../../src/core/sensitive.js';
import { readWorkspaceText, looksBinary, isInside, resetReadAudit, FILE_READ_AUDIT } from '../../src/core/fs-safe.js';
import { IgnoreEngine, loadGitignore } from '../../src/core/ignore-engine.js';
import { ProjectScanner } from '../../src/core/scanner.js';
import { createFixtureProject } from '../../src/demo/fixture-factory.js';
import { makeTempDir } from '../helpers/tmp.js';

const tmp = () => makeTempDir('apc-unit-');

describe('SensitiveFileDetector', () => {
  test('detects the documented sensitive shapes', () => {
    const cases = [
      ['.env', 'env_file'], ['.env.local', 'env_file'], ['config/.env.production', 'env_file'],
      ['certs/server.pem', 'private_key'], ['keys/app.key', 'private_key'],
      ['~/.ssh/id_rsa', 'ssh_private_key'], ['id_ed25519', 'ssh_private_key'],
      ['credentials.json', 'credentials'], ['src/secrets.yaml', 'secrets'],
      ['tokens.txt', 'tokens'], ['.npmrc', 'credentials_file'], ['.pypirc', 'credentials_file'],
      ['serviceAccount.json', 'cloud_credentials'], ['.aws/credentials', 'credentials'],
      ['store.jks', 'java_keystore'],
    ];
    for (const [p, rule] of cases) {
      const d = detectSensitive(p);
      assert.equal(d.sensitive, true, `${p} was not flagged`);
      assert.ok(d.rule, `${p} has no rule`);
    }
  });

  test('does not flag ordinary files', () => {
    for (const p of ['src/app.ts', 'README.md', 'package.json', 'env.example.txt', 'src/envelope.js']) {
      assert.equal(isSensitive(p), false, `${p} was wrongly flagged`);
    }
  });

  test('assertNotSensitive throws a typed error and never reads', () => {
    assert.throws(() => assertNotSensitive('.env'), SensitivePathError);
    try { assertNotSensitive('.env'); } catch (err) { assert.equal(err.code, 'sensitive_file_protected'); }
  });
});

describe('fs-safe reads', () => {
  test('refuses to read a sensitive file even when it exists', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=super-secret-value\n');
    resetReadAudit();
    const res = await readWorkspaceText(dir, '.env');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'sensitive_file_protected');
    assert.equal(FILE_READ_AUDIT.skippedSensitive, 1);
    assert.equal(FILE_READ_AUDIT.reads, 0);
  });

  test('enforces the size cap and skips binary files', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(5000));
    const big = await readWorkspaceText(dir, 'big.txt', { maxBytes: 100 });
    assert.equal(big.ok, false);
    assert.equal(big.reason, 'too_large');

    fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3, 4]));
    const bin = await readWorkspaceText(dir, 'bin.dat');
    assert.equal(bin.ok, false);
    assert.equal(bin.reason, 'binary');
    assert.equal(looksBinary(Buffer.from('plain text')), false);
  });

  test('refuses to escape the workspace root', async () => {
    const dir = tmp();
    const res = await readWorkspaceText(dir, '../outside.txt');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'outside_workspace');
    assert.equal(isInside(dir, path.join(dir, 'a/b')), true);
    assert.equal(isInside(dir, path.join(dir, '..')), false);
  });
});

describe('IgnoreEngine', () => {
  test('applies hard ignores before anything else', async () => {
    const dir = tmp();
    const engine = await IgnoreEngine.fromProject({ root: dir });
    assert.equal(engine.check('node_modules/react/index.js').ignored, true);
    assert.equal(engine.check('.git/objects/aa').ignored, true);
    assert.equal(engine.check('src/index.ts').ignored, false);
    assert.equal(engine.check('dist/bundle.js').ignored, true);
    assert.equal(engine.check('src/keep.ts').reason, undefined);
  });

  test('honours user patterns and .gitignore', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\n*.snap\n');
    const patterns = await loadGitignore(dir);
    assert.ok(patterns.includes('*.snap'));
    const engine = await IgnoreEngine.fromProject({ root: dir, userPatterns: ['scratch/**'] });
    assert.equal(engine.check('generated/x.js').ignored, true);
    assert.equal(engine.check('a/b/x.snap').ignored, true);
    assert.equal(engine.check('scratch/notes.md').ignored, true);
  });

  test('enforces the depth limit', async () => {
    const engine = new IgnoreEngine({ root: '/x', limits: { maxDepth: 3 } });
    assert.equal(engine.exceedsDepth('a/b/c'), false);
    assert.equal(engine.exceedsDepth('a/b/c/d'), true);
  });
});

describe('ProjectScanner', () => {
  test('detects stack, config, spec candidates and sensitive files without reading them', async () => {
    const dir = path.join(tmp(), 'healthy');
    createFixtureProject(dir, 'healthy');
    const meta = await new ProjectScanner().scan(dir);
    assert.equal(meta.ok, true);
    assert.equal(meta.packageManager, 'npm');
    assert.ok(meta.frameworks.includes('Vite'));
    assert.ok(meta.frameworks.includes('React'));
    assert.ok(meta.frameworks.includes('Vitest'));
    assert.ok(meta.frameworks.includes('Playwright'));
    assert.equal(meta.configFiles.tsconfig, true);
    assert.equal(meta.configFiles.eslint, true);
    assert.ok(meta.specCandidates.includes('SPEC.md'));
    assert.ok(meta.fileCount > 10);
    assert.equal(meta.sensitiveCount, 2, 'expected .env and secrets.json to be detected');
    assert.equal(meta.readAudit.skippedSensitive, 2);
    assert.match(meta.fileFingerprint, /^[0-9a-f]{40}$/);
    assert.equal(meta.directories.src, true);
    assert.equal(meta.directories.tests, true);
  });

  test('reports a missing workspace instead of throwing', async () => {
    const meta = await new ProjectScanner().scan(path.join(tmp(), 'does-not-exist'));
    assert.equal(meta.ok, false);
    assert.equal(meta.reason, 'workspace_not_found');
  });

  test('marks a scan as truncated when the file limit is exceeded', async () => {
    const dir = path.join(tmp(), 'many');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    for (let i = 0; i < 30; i += 1) fs.writeFileSync(path.join(dir, 'src', `f${i}.ts`), 'export const x = 1;\n');
    const meta = await new ProjectScanner().scan(dir, { limits: { maxFiles: 10 } });
    assert.equal(meta.truncated, true);
    assert.equal(meta.fileCount, 10);
    assert.ok(meta.warnings.some((w) => /maxFiles/.test(w)));
  });

  test('does not scan outside the workspace or follow symlinks', async () => {
    const dir = path.join(tmp(), 'root');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    const before = (await new ProjectScanner().scan(dir)).fileCount;
    assert.equal(before, 1);
  });
});
