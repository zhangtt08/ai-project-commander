/**
 * Covers the App-level GitHub wiring, which neither the publisher's unit tests nor the
 * real-git tests reach: settings gating, owner auto-resolution and caching, commit-identity
 * derivation, result persistence, and — above all — that the token never escapes into
 * argv, returned objects, or the project record.
 *
 * The GitHub API is a local fake; git is the real CommandRunner, spied on so the exact
 * argv and env of every invocation are asserted.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { App } from '../../src/core/app.js';
import { makeTempDir } from '../helpers/tmp.js';

const TOKEN = 'ghp_SECRETISH_1234567890abcdef';

function fakeGitHub(log) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    log.push({ url: u, method, headers: opts.headers || {}, body: opts.body ? String(opts.body) : null });
    const json = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });

    if (u.endsWith('/user') && method === 'GET') return json(200, { login: 'ztt-demo' });
    if (u.endsWith('/user/repos') && method === 'POST') {
      return json(201, {
        name: 'probe', full_name: 'ztt-demo/probe', private: true,
        html_url: 'https://github.com/ztt-demo/probe',
      });
    }
    return json(404, { message: 'Not Found' });
  };
}

function setup() {
  const dataDir = makeTempDir('apc-ghapp-');
  const app = new App({ dataDir, dbFile: ':memory:', logLevel: 'error' });
  const projDir = makeTempDir('apc-ghproj-');
  fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0' }));
  fs.writeFileSync(path.join(projDir, 'index.js'), 'export default 1;\n');

  const calls = [];
  const pushes = [];
  const real = app.runner.run.bind(app.runner);
  app.runner.run = (req) => {
    const args = [...(req.args || [])];
    const env = { ...(req.env || {}) };
    calls.push({ args, env, command: req.command, timeoutMs: req.timeoutMs });
    // Never let a test reach the real network: intercept the push and record its shape.
    // That a push genuinely transfers commits is covered by git-publish-real.test.js.
    if (args[0] === 'push') {
      pushes.push({ args, env, cwd: req.cwd });
      return Promise.resolve({ ok: true, exitCode: 0, stdout: '', stderr: '', blocked: false, timedOut: false });
    }
    return real(req);
  };
  return { app, projDir, calls, pushes, dataDir };
}

function enableGithub(app, { enabled = true, owner = '' } = {}) {
  app.repo.setSetting('github.token', TOKEN);
  app.repo.setSetting('github.enabled', enabled ? 'true' : 'false');
  if (owner) app.repo.setSetting('github.owner', owner);
}

describe('App.publishToGithub wiring', () => {
  const savedFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = savedFetch; });

  test('without a token it reports disabled and persists nothing misleading', async () => {
    const { app, projDir } = setup();
    const p = app.addProject({ workspacePath: projDir });
    const res = await app.publishToGithub(p.id);
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'disabled');
    assert.match(res.reason, /未配置 GitHub 令牌/);
  });

  test('a stored token with the toggle off is respected, not silently published', async () => {
    const { app, projDir } = setup();
    enableGithub(app, { enabled: false });
    const p = app.addProject({ workspacePath: projDir });
    const res = await app.publishToGithub(p.id);
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'disabled');
    assert.match(res.reason, /关闭/);
  });

  test('owner is resolved from the token and cached; a private repo is requested', async () => {
    const { app, projDir, calls } = setup();
    enableGithub(app);
    const apiLog = [];
    globalThis.fetch = fakeGitHub(apiLog);

    const p = app.addProject({ workspacePath: projDir });
    const res = await app.publishToGithub(p.id);

    const userCall = apiLog.find((c) => c.url.endsWith('/user'));
    assert.ok(userCall, 'the token must be validated first');
    const create = apiLog.find((c) => c.url.endsWith('/user/repos'));
    assert.ok(create, 'a repository creation request must be made');
    const body = JSON.parse(create.body);
    assert.equal(body.private, true, 'the repo MUST be created private');
    assert.ok(!body.name.includes('undefined'));

    // owner discovered from /user is persisted so later imports skip the round trip
    assert.equal(app.repo.getSetting('github.owner'), 'ztt-demo');

    // the push target is the credential-free github.com URL, never a token-bearing one
    const push = calls.find((c) => c.args[0] === 'push');
    assert.ok(push, 'a push must be attempted');
    assert.ok(!JSON.stringify(push.args).includes(TOKEN), 'token must never appear in argv');
    assert.equal(push.env.GIT_CONFIG_KEY_0, 'http.extraheader', 'auth must travel via git env, not argv');
    assert.equal(push.env.GIT_TERMINAL_PROMPT, '0', 'git must never block on an interactive credential prompt');
    assert.ok(push.timeoutMs <= 60000, `publish must be time-bounded, got ${push.timeoutMs}ms`);
    assert.equal(res.ok, true, `the whole chain should succeed: ${res.reason}`);
    assert.equal(res.stage, 'pushed');
    assert.equal(res.fullName, 'ztt-demo/probe');
  });

  test('importing a project never waits on the upload', async () => {
    const { app, projDir } = setup();
    enableGithub(app, { owner: 'ztt-demo' });
    let releasePush;
    const gate = new Promise((resolve) => { releasePush = resolve; });
    const real = app.runner.run.bind(app.runner);
    app.runner.run = (req) => {
      if ((req.args || [])[0] === 'push') {
        return gate.then(() => ({ ok: true, exitCode: 0, stdout: '', stderr: '', blocked: false, timedOut: false }));
      }
      return real(req);
    };
    globalThis.fetch = fakeGitHub([]);

    const t0 = Date.now();
    const project = await app.addProjectAndClassify(projDir);
    const elapsed = Date.now() - t0;
    releasePush();

    assert.ok(project.id, 'the project must be created and returned');
    assert.ok(elapsed < 8000, `import blocked on a pending upload for ${elapsed}ms`);
  });

  test('the token never reaches argv, the returned result, or the project record', async () => {
    const { app, projDir, calls } = setup();
    enableGithub(app, { owner: 'ztt-demo' });
    globalThis.fetch = fakeGitHub([]);

    const p = app.addProject({ workspacePath: projDir });
    const res = await app.publishToGithub(p.id);

    assert.ok(!JSON.stringify(res).includes(TOKEN), 'the API result must not carry the token');
    for (const c of calls) {
      assert.ok(!JSON.stringify(c.args).includes(TOKEN), `token leaked into argv: ${c.args.join(' ')}`);
    }
    const stored = app.repo.get('projects', p.id);
    assert.ok(!JSON.stringify(stored.metadata || {}).includes(TOKEN), 'token must not be stored on the project');
    // auth is carried only as a base64 Basic header in the child env
    const push = calls.find((c) => c.args[0] === 'push');
    assert.equal(push.env.GIT_CONFIG_KEY_0, 'http.extraheader');
    assert.match(String(push.env.GIT_CONFIG_VALUE_0), /^Authorization: Basic /);
    assert.ok(!String(push.env.GIT_CONFIG_VALUE_0).includes(TOKEN), 'the header is base64, not the raw token');
  });

  test('a commit is authored even though this machine has no global git identity', async () => {
    const { app, projDir } = setup();
    enableGithub(app, { owner: 'ztt-demo' });
    globalThis.fetch = fakeGitHub([]);

    const p = app.addProject({ workspacePath: projDir });
    await app.publishToGithub(p.id);

    const head = path.join(projDir, '.git', 'logs', 'HEAD');
    assert.ok(fs.existsSync(head), 'prepareRepository must have created a commit');
    const author = fs.readFileSync(path.join(projDir, '.git', 'logs', 'HEAD'), 'utf8');
    assert.match(author, /ztt-demo@users\.noreply\.github\.com/, 'the commit must use the derived GitHub identity');
  });

  test('publish survives a total API outage without throwing or hanging', async () => {
    const { app, projDir } = setup();
    enableGithub(app, { owner: 'ztt-demo' });
    globalThis.fetch = async () => { throw new Error('socket hang up'); };

    const p = app.addProject({ workspacePath: projDir });
    const res = await app.publishToGithub(p.id);
    assert.equal(res.ok, false);
    assert.ok(res.reason.length > 0);
    assert.ok(!res.reason.includes(TOKEN));
    // the failure is recorded so the UI can show why nothing was uploaded
    const stored = app.repo.get('projects', p.id);
    assert.equal(stored.metadata.github.ok, false);
  });

});
