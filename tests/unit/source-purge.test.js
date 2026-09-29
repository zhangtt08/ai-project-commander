/**
 * Guard tests for the one code path allowed to destroy files inside a managed workspace.
 * These back the ADR-009 lint exemption granted to src/core/source-purge.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessPurgeTarget, purgeDirectory, formatBytes } from '../../src/core/source-purge.js';
import { makeTempDir } from '../helpers/tmp.js';

const OWN_DATA = path.join(os.homedir(), 'AppData', 'Local', 'commander-data');

function fixture(name = 'project') {
  const root = makeTempDir(`apc-purge-${name}-`);
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi');
  return dir;
}

describe('assessPurgeTarget refuses anything that is not a project folder', () => {
  test('the filesystem root', () => {
    const r = assessPurgeTarget(process.platform === 'win32' ? 'C:\\' : '/');
    assert.equal(r.ok, false);
    assert.match(r.reason, /根目录/);
  });

  test('the user home directory', () => {
    const r = assessPurgeTarget(os.homedir());
    assert.equal(r.ok, false);
    assert.match(r.reason, /系统保护/);
  });

  test('Desktop / Documents even though they hold projects', () => {
    for (const sub of ['Desktop', 'Documents', 'Downloads']) {
      const r = assessPurgeTarget(path.join(os.homedir(), sub));
      assert.equal(r.ok, false, `${sub} must be refused`);
    }
  });

  test('a shallow directory that is not a project', () => {
    const r = assessPurgeTarget(path.parse(os.homedir()).root + 'Users');
    assert.equal(r.ok, false);
    assert.match(r.reason, /层级过浅|系统保护/);
  });

  test('relative paths', () => {
    const r = assessPurgeTarget('some/relative/dir');
    assert.equal(r.ok, false);
    assert.match(r.reason, /绝对路径/);
  });

  test('a path that does not exist', () => {
    const r = assessPurgeTarget(path.join(os.tmpdir(), 'apc-does-not-exist-xyz', 'nested'));
    assert.equal(r.ok, false);
    assert.match(r.reason, /不存在/);
  });

  test('Commander\'s own data directory and its ancestors', () => {
    const own = path.join(os.homedir(), 'AI-Project-Commander', 'data');
    assert.equal(assessPurgeTarget(own, { ownDataDir: own }).ok, false, 'itself');
    assert.equal(assessPurgeTarget(path.dirname(own), { ownDataDir: own }).ok, false, 'ancestor');
    assert.equal(assessPurgeTarget(path.join(own, 'sub'), { ownDataDir: own }).ok, false, 'descendant');
  });

  test('a normal project folder is accepted and measured', () => {
    const dir = fixture('accepted');
    const r = assessPurgeTarget(dir, { ownDataDir: OWN_DATA });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.fileCount, 2);
    assert.equal(r.confirmToken, 'accepted');
    assert.equal(r.name, 'accepted');
    assert.ok(r.totalBytes > 0);
    assert.ok(r.display.includes('accepted'));
  });
});

describe('purgeDirectory demands the echoed token', () => {
  test('a mismatched token throws and deletes nothing', () => {
    const dir = fixture('guarded');
    const assessed = assessPurgeTarget(dir, { ownDataDir: OWN_DATA });
    assert.throws(() => purgeDirectory(assessed, { confirmToken: 'wrong' }), /确认口令|拒绝/);
    assert.ok(fs.existsSync(dir), 'nothing may be removed on a rejected confirmation');
    assert.ok(fs.existsSync(path.join(dir, 'src', 'a.js')));
  });

  test('an unassessed target throws', () => {
    assert.throws(() => purgeDirectory({ ok: false, reason: 'nope' }, { confirmToken: 'x' }), /拒绝删除/);
    assert.throws(() => purgeDirectory(null, {}), /拒绝删除/);
  });

  test('the matching token really removes the tree', () => {
    const dir = fixture('removed');
    const assessed = assessPurgeTarget(dir, { ownDataDir: OWN_DATA });
    const res = purgeDirectory(assessed, { confirmToken: 'removed' });
    assert.equal(res.removed, true);
    assert.equal(res.fileCount, 2);
    assert.equal(fs.existsSync(dir), false);
  });
});

describe('formatBytes', () => {
  test('scales up and stays readable', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    assert.equal(formatBytes(35 * 1024 * 1024), '35 MB');
  });
});
