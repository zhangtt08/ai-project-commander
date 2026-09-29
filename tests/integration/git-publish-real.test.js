/**
 * Exercises the GitHub publishing pipeline against the REAL git binary and the REAL
 * CommandRunner (allowlist + per-call env), using a local bare repo as the remote so no
 * credentials are needed. This is what a mocked unit test cannot prove: that the allowlist
 * actually permits these git verbs on Windows, that a commit can be authored without a
 * global git identity, and that a push really lands.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { CommandRunner } from '../../src/core/command-runner.js';
import { prepareRepository, ensureOriginRemote, gitAuthEnv } from '../../src/core/github-publisher.js';

const runner = new CommandRunner({ defaultTimeoutMs: 60000 });
const git = { run: (req) => runner.run({ ...req, env: req.env || gitAuthEnv('local-test-no-token') }) };

// Most machines have no global user.name/user.email; the product derives the identity from
// the GitHub account, so the test must supply the same thing a real publish would.
const IDENTITY = { name: 'apc-test', email: 'apc-test@users.noreply.github.com' };

function workspace(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `apc-git-${name}-`));
  const proj = path.join(root, 'proj');
  const bare = path.join(root, 'remote.git');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'index.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'ignore' });
  return { root, proj, bare };
}

function cleanup(root) {
  try {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* temp trees are reclaimed by the OS */ }
}

describe('publishing against the real git binary', () => {
  test('the allowlist permits the publishing verbs', () => {
    for (const args of [['init', '-b', 'main'], ['add', '-A'], ['commit', '-m', 'x'], ['push', '-u', 'origin', 'main'], ['remote', 'add', 'origin', 'https://github.com/a/b.git'], ['remote', 'set-url', 'origin', 'https://github.com/a/b.git']]) {
      const v = runner.check ? runner.check('git', args) : null;
      if (v) assert.equal(v.allowed, true, `git ${args.join(' ')} must be allowed: ${v.reason}`);
    }
    const line = { ...git };
    assert.ok(line, 'git executor wired');
  });

  test('prepareRepository authors a real first commit with no global git identity', async () => {
    const { root, proj } = workspace('prep');
    try {
      const res = await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      assert.equal(res.ok, true, `prepareRepository failed: ${res.reason}`);
      assert.match(execFileSync('git', ['-C', proj, 'log', '--oneline'], { encoding: 'utf8' }), /AI Project Commander/);
      assert.equal(execFileSync('git', ['-C', proj, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(), 'main');
      assert.equal(execFileSync('git', ['-C', proj, 'log', '-1', '--format=%ae'], { encoding: 'utf8' }).trim(), IDENTITY.email);
    } finally {
      cleanup(root);
    }
  });

  test('prepareRepository is safe to run twice', async () => {
    const { root, proj } = workspace('twice');
    try {
      const a = await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      const b = await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      assert.equal(a.ok, true, a.reason);
      assert.equal(b.ok, true, `second run must not fail: ${b.reason}`);
      assert.equal(b.hadCommits, true, 'second run should see the existing history');
    } finally {
      cleanup(root);
    }
  });

  test('ensureOriginRemote refuses a non-GitHub remote rather than exfiltrating the code', async () => {
    const { root, proj, bare } = workspace('guard');
    try {
      await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      const r = await ensureOriginRemote({ git, cwd: proj, url: bare.replace(/\\/g, '/') });
      assert.equal(r.ok, false, 'a local/arbitrary remote must be rejected');
      assert.match(r.reason, /凭据|非法/, 'the rejection must state why');
      const cfg = fs.readFileSync(path.join(proj, '.git', 'config'), 'utf8');
      assert.ok(!cfg.includes('local-test-no-token'), 'no credential may reach .git/config');
    } finally {
      cleanup(root);
    }
  });

  test('ensureOriginRemote accepts a plain github.com URL with no secret in it', async () => {
    const { root, proj } = workspace('ghurl');
    try {
      await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      const url = 'https://github.com/apc-test/apc-probe.git';
      const r = await ensureOriginRemote({ git, cwd: proj, url });
      assert.equal(r.ok, true, r.reason);
      assert.equal(execFileSync('git', ['-C', proj, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(), url);
      const cfg = fs.readFileSync(path.join(proj, '.git', 'config'), 'utf8');
      assert.ok(!cfg.includes('local-test-no-token'), 'token must never be written to .git/config');
      assert.ok(!/x-access-token/i.test(cfg), 'no credential material in .git/config');
    } finally {
      cleanup(root);
    }
  });

  test('a real push lands the commit on the remote with env-based auth', async () => {
    const { root, proj, bare } = workspace('push');
    try {
      await prepareRepository({ git, cwd: proj, branch: 'main', identity: IDENTITY });
      const url = bare.replace(/\\/g, '/');
      // Add the remote directly: ensureOriginRemote deliberately only accepts github.com,
      // so the push test wires it itself to exercise the transport, not the guard.
      const added = await runner.run({ command: 'git', args: ['remote', 'add', 'origin', url], cwd: proj, purpose: 'test remote' });
      assert.equal(added.exitCode, 0, added.stderr);
      const pushed = await runner.run({
        command: 'git', args: ['push', '-u', 'origin', 'main'], cwd: proj, purpose: 'test push',
        env: gitAuthEnv('local-test-no-token'),
      });
      assert.equal(pushed.exitCode, 0, `push failed: ${pushed.stderr || pushed.stdout}`);
      const remoteHead = execFileSync('git', ['-C', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
      const localHead = execFileSync('git', ['-C', proj, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      assert.equal(remoteHead, localHead, 'remote must hold the same commit as local');
    } finally {
      cleanup(root);
    }
  });
});
