import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCandidates, recogniseCandidate, defaultSearchRoots } from '../../src/core/workspace-resolver.js';
import { ProjectScanner } from '../../src/core/scanner.js';
import { createFixtureProject } from '../../src/demo/fixture-factory.js';
import { makeTempDir } from '../helpers/tmp.js';

const ROOT = makeTempDir('apc-resolver-');

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

describe('WorkspaceResolver', () => {
  test('finds an exact match inside the configured roots', () => {
    const root = path.join(ROOT, 'rootA');
    mkdirp(path.join(root, 'my-project', 'src'));
    const found = findCandidates('my-project', { roots: [root], maxDepth: 2 });
    assert.equal(found.length, 1);
    assert.equal(found[0].match, 'exact');
    assert.equal(path.basename(found[0].path), 'my-project');
  });

  test('is case-insensitive and matches at any depth up to the limit', () => {
    const root = path.join(ROOT, 'rootB');
    mkdirp(path.join(root, 'work', 'My-Project'));
    const found = findCandidates('my-project', { roots: [root], maxDepth: 3 });
    assert.equal(found.length, 1);
    assert.equal(found[0].match, 'exact');
  });

  test('offers fuzzy matches at top level and ranks exact above fuzzy', () => {
    const root = path.join(ROOT, 'rootC');
    mkdirp(path.join(root, 'my-project-legacy'));
    mkdirp(path.join(root, 'nested', 'my-project'));
    const found = findCandidates('my-project', { roots: [root], maxDepth: 2 });
    assert.ok(found.length >= 2);
    assert.equal(found[0].match, 'exact', 'exact match must rank first');
  });

  test('never returns node_modules or dot directories', () => {
    const root = path.join(ROOT, 'rootD');
    mkdirp(path.join(root, 'node_modules', 'my-project'));
    mkdirp(path.join(root, '.hidden', 'my-project'));
    const found = findCandidates('my-project', { roots: [root], maxDepth: 3 });
    assert.deepEqual(found, []);
  });

  test('empty or blank queries return nothing', () => {
    assert.deepEqual(findCandidates('', { roots: [ROOT] }), []);
    assert.deepEqual(findCandidates('   ', { roots: [ROOT] }), []);
  });

  test('nonexistent roots are skipped without throwing', () => {
    const found = findCandidates('anything', { roots: [path.join(ROOT, 'does-not-exist')], timeBudgetMs: 500 });
    assert.deepEqual(found, []);
  });

  test('recogniseCandidate runs the real scanner and reports the stack', async () => {
    const dir = path.join(ROOT, 'recognised');
    createFixtureProject(dir, 'healthy');
    const info = await recogniseCandidate(dir, { scanner: new ProjectScanner() });
    assert.equal(info.recognised, true);
    assert.equal(info.language, 'JavaScript');
    assert.equal(info.packageManager, 'npm');
    assert.equal(info.isGit, true);
    assert.equal(info.hasSpec, true);
    assert.ok(info.fileCount > 8);
  });

  test('recogniseCandidate degrades honestly for a missing directory', async () => {
    const info = await recogniseCandidate(path.join(ROOT, 'gone'), { scanner: new ProjectScanner() });
    assert.equal(info.recognised, false);
    assert.equal(info.reason, 'workspace_not_found');
  });

  test('defaultSearchRoots returns existing absolute directories', () => {
    const roots = defaultSearchRoots();
    assert.ok(roots.length >= 1);
    for (const r of roots) {
      assert.ok(path.isAbsolute(r), `${r} must be absolute`);
      assert.equal(fs.existsSync(r), true, `${r} must exist`);
    }
  });
});
