/**
 * GitHub publisher unit tests.
 *
 * Everything is faked: the GitHub REST API through an injected `fetchImpl` and git through
 * an injected executor that records every call. The central invariant under test is that the
 * personal access token never reaches argv, a returned object or a log line — it may only
 * ever appear inside the per-call git environment (GIT_CONFIG_VALUE_0).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubPublisher,
  PUBLISH_STAGES,
  SETTINGS_KEYS,
  basicAuthHeader,
  ensureOriginRemote,
  ensurePrivateRepo,
  gitAuthEnv,
  githubEnabled,
  plainRemoteUrl,
  prepareRepository,
  publishProject,
  redact,
  sanitizeRepoName,
  validateToken,
} from '../../src/core/github-publisher.js';

const TOKEN = 'ghp_UnitTestSecretValue1234567890ABCDEF';
const TOKEN_B64 = Buffer.from(`x-access-token:${TOKEN}`, 'utf8').toString('base64');
const OWNER = 'tester';
const REPO = 'demo-app';

// ───────────────────────────── fakes ─────────────────────────────

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/**
 * Fake fetch. Handlers are keyed by "METHOD url" (or bare url) and may be a response
 * object or a function of the recorded call. Every request is captured for assertions.
 */
function makeFetch(handlers = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const record = { url, method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(record);
    const handler = handlers[`${method} ${url}`] || handlers[url];
    if (!handler) return jsonResponse(404, { message: 'Not Found' });
    return typeof handler === 'function' ? handler(record) : handler;
  };
  return { fn, calls };
}

const ok = (stdout = '') => ({ ok: true, blocked: false, exitCode: 0, signal: null, stdout, stderr: '', timedOut: false });
const fail = (exitCode, stderr = '') => ({ ok: false, blocked: false, exitCode, signal: null, stdout: '', stderr, timedOut: false });
const blocked = (stderr) => ({ ok: false, blocked: true, exitCode: 127, signal: null, stdout: '', stderr, timedOut: false });

/**
 * Fake git executor: records {command,args,argv,cwd,purpose,env} per call and answers from
 * `overrides` (regex source → response|function) falling back to a plausible repository.
 */
function makeGit(overrides = {}, state = {}) {
  const calls = [];
  const settings = {
    isRepo: true, hadCommits: true, branch: 'main', dirty: false,
    gitignoreTracked: true, gitignoreUntracked: false, originUrl: '',
    ...state,
  };
  const fn = async (req) => {
    const argv = `${req.command} ${(req.args || []).join(' ')}`;
    calls.push({
      command: req.command,
      args: [...(req.args || [])],
      argv,
      cwd: req.cwd,
      purpose: req.purpose,
      timeoutMs: req.timeoutMs,
      env: req.env ? { ...req.env } : undefined,
    });
    for (const [pattern, value] of Object.entries(overrides)) {
      if (new RegExp(pattern, 'i').test(argv)) {
        const resolved = typeof value === 'function' ? value(req) : value;
        return resolved instanceof Error ? Promise.reject(resolved) : resolved;
      }
    }
    if (/rev-parse --is-inside-work-tree/.test(argv)) return settings.isRepo ? ok('true') : fail(128, 'fatal: not a git repository');
    if (/rev-parse --verify HEAD/.test(argv)) return settings.hadCommits ? ok('deadbeef') : fail(128, 'fatal: ambiguous argument');
    if (/symbolic-ref/.test(argv)) return ok(settings.branch);
    if (/rev-parse --abbrev-ref/.test(argv)) return ok(settings.branch);
    if (/ls-files/.test(argv)) return ok(settings.gitignoreTracked ? '.gitignore' : '');
    if (/status --porcelain --untracked-files=all/.test(argv)) return ok(settings.gitignoreUntracked ? '?? .gitignore' : '');
    if (/status --porcelain/.test(argv)) return ok(settings.dirty ? 'A  index.js' : '');
    if (/git init/.test(argv)) { settings.isRepo = true; return ok('Initialized empty repository'); }
    if (/git add/.test(argv)) return ok();
    if (/git commit/.test(argv)) { settings.hadCommits = true; settings.dirty = false; return ok('[main (root-commit) abcdef1]'); }
    if (/remote get-url origin/.test(argv)) return settings.originUrl ? ok(settings.originUrl) : fail(2, "error: No such remote 'origin'");
    if (/remote set-url origin/.test(argv)) { settings.originUrl = req.args[req.args.length - 1]; return ok(); }
    if (/remote add origin/.test(argv)) { settings.originUrl = req.args[req.args.length - 1]; return ok(); }
    if (/git push/.test(argv)) {
      if (!req.env || req.env.GIT_CONFIG_VALUE_0 !== `Authorization: Basic ${TOKEN_B64}`) return fail(128, 'fatal: could not read Username for https://github.com');
      return ok('To https://github.com/tester/demo-app.git');
    }
    return fail(1, `unexpected command: ${argv}`);
  }
  return { fn, calls, settings };
}

function makeFiles(state = {}) {
  const calls = [];
  const store = { exists: false, ...state };
  return {
    calls,
    store,
    exists: async (_dir, name) => {
      calls.push({ op: 'exists', name });
      return store.exists;
    },
    createIfMissing: async (dir, name, content) => {
      calls.push({ op: 'createIfMissing', dir, name, content });
      if (store.exists) throw new Error(`${name} already exists`);
      store.exists = true;
      return true;
    },
  };
}

const settingsWith = (overrides = {}) => ({
  [SETTINGS_KEYS.enabled]: 'true',
  [SETTINGS_KEYS.token]: TOKEN,
  [SETTINGS_KEYS.owner]: OWNER,
  ...overrides,
});

/** A Repository-shaped store, to prove the module works against app.repo as well. */
function repoStore(values = {}) {
  const map = new Map(Object.entries(values));
  return { getSetting: (key) => (map.has(key) ? map.get(key) : null), setSetting: (k, v) => map.set(k, v) };
}

/** The security assertion used across this file. */
function assertTokenHiddenEverywhere(calls, result) {
  for (const call of calls) {
    const argv = call.argv ?? `${call.command} ${(call.args || []).join(' ')}`;
    const args = call.args || [];
    assert.ok(!argv.includes(TOKEN), `token leaked into argv: ${argv}`);
    assert.ok(!args.some((a) => String(a).includes(TOKEN)), 'token leaked into an argv entry');
    assert.ok(!JSON.stringify(args).includes(TOKEN_B64), 'base64 token leaked into argv');
    assert.ok(args[0] !== 'config', 'the publisher must never write git config');
    if (call.env) {
      assert.equal(call.env.GIT_CONFIG_COUNT, '1', 'GIT_CONFIG_COUNT must gate the injected config');
      assert.equal(call.env.GIT_CONFIG_KEY_0, 'http.extraheader');
    }
  }
  const json = JSON.stringify(result);
  assert.ok(!json.includes(TOKEN), `token leaked into the result: ${json}`);
  assert.ok(!json.includes(TOKEN_B64), 'base64 token leaked into the result');
}

const happyFetch = (extra = {}) => makeFetch({
  'GET https://api.github.com/user': () => jsonResponse(200, { login: OWNER, id: 1 }),
  'POST https://api.github.com/user/repos': () => jsonResponse(201, {
    full_name: `${OWNER}/${REPO}`, html_url: `https://github.com/${OWNER}/${REPO}`, private: true,
  }),
  ...extra,
});

// ───────────────────────────── naming ─────────────────────────────

describe('sanitizeRepoName', () => {
  test('keeps Chinese characters because GitHub accepts them', () => {
    assert.equal(sanitizeRepoName('中文项目'), '中文项目');
    assert.equal(sanitizeRepoName('我的 项目 笔记'), '我的_项目_笔记');
    assert.equal(sanitizeRepoName('报表/2026/第一季度'), '报表_2026_第一季度');
  });

  test('strips path separators and shell-hostile characters', () => {
    const cleaned = sanitizeRepoName('a\\b:c*d?e"f<g>h|i');
    assert.equal(cleaned, 'a_b_c_d_e_f_g_h_i');
    for (const bad of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', ' ']) {
      assert.ok(!sanitizeRepoName(`x${bad}y`).includes(bad), `"${bad}" survived sanitising`);
    }
  });

  test('trims leading and trailing dots and dashes', () => {
    assert.equal(sanitizeRepoName('..my-project..'), 'my-project');
    assert.equal(sanitizeRepoName('--foo--'), 'foo');
    assert.equal(sanitizeRepoName('internal.dots_ok'), 'internal.dots_ok');
  });

  test('caps the length at 100 characters', () => {
    assert.equal(sanitizeRepoName('x'.repeat(240)).length, 100);
  });

  test('never returns an empty string', () => {
    for (const input of ['', '   ', '///', '???', '...', '***', null, undefined, 0, {}]) {
      const out = sanitizeRepoName(input);
      assert.ok(typeof out === 'string' && out.length > 0, `empty result for ${String(input)}`);
    }
    assert.equal(sanitizeRepoName('///'), 'project');
    assert.equal(sanitizeRepoName(''), 'project');
  });

  test('is deterministic', () => {
    const input = '项目 A/B: v2.0';
    assert.equal(sanitizeRepoName(input), sanitizeRepoName(input));
  });
});

// ───────────────────────────── secrets & auth ─────────────────────────────

describe('redact and the git authentication environment', () => {
  test('redact scrubs the literal token plus its base64 variants', () => {
    const text = `remote: ${TOKEN} rejected; header was ${TOKEN_B64}`;
    const clean = redact(text, [TOKEN]);
    assert.ok(!clean.includes(TOKEN));
    assert.ok(!clean.includes(TOKEN_B64));
    assert.match(clean, /\[REDACTED\]/);
  });

  test('redact scrubs known token shapes and embedded credentials even without a literal', () => {
    assert.ok(!redact('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').includes('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
    assert.ok(!redact('github_pat_11ABCDEFGH0123456789xyz').includes('github_pat_11ABCDEFGH'));
    assert.ok(!redact('Authorization: Basic QWxhZGRpbjpPcGVuU2VzYW1l').includes('QWxhZGRpbjpPcGVuU2VzYW1l'));
    assert.ok(!redact('https://user:s3cr3tvalue@github.com/a/b.git').includes('s3cr3tvalue'));
    assert.equal(redact(null), '');
    assert.equal(redact(''), '');
  });

  test('basicAuthHeader encodes x-access-token:<token> as base64', () => {
    assert.equal(basicAuthHeader(TOKEN), `Basic ${TOKEN_B64}`);
    assert.equal(Buffer.from(TOKEN_B64, 'base64').toString('utf8'), `x-access-token:${TOKEN}`);
    assert.equal(basicAuthHeader(''), '');
  });

  test('gitAuthEnv uses the git >= 2.31 GIT_CONFIG_* mechanism', () => {
    const env = gitAuthEnv(TOKEN);
    assert.deepEqual(Object.keys(env).sort(), ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']);
    assert.equal(env.GIT_CONFIG_COUNT, '1');
    assert.equal(env.GIT_CONFIG_KEY_0, 'http.extraheader');
    assert.equal(env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from(`x-access-token:${TOKEN}`, 'utf8').toString('base64')}`);
    assert.equal(gitAuthEnv('').GIT_CONFIG_COUNT, undefined);
  });

  test('the settings keys match the ones the Settings route stores', () => {
    assert.equal(SETTINGS_KEYS.token, 'github.token');
    assert.equal(SETTINGS_KEYS.enabled, 'github.enabled');
    assert.equal(SETTINGS_KEYS.owner, 'github.owner');
  });
});

describe('githubEnabled', () => {
  test('requires both a toggle and a usable token', () => {
    assert.equal(githubEnabled(settingsWith()), true);
    assert.equal(githubEnabled(settingsWith({ [SETTINGS_KEYS.token]: '' })), false);
    assert.equal(githubEnabled(settingsWith({ [SETTINGS_KEYS.token]: undefined })), false);
    assert.equal(githubEnabled({ [SETTINGS_KEYS.enabled]: 'true' }), false);
    assert.equal(githubEnabled({ [SETTINGS_KEYS.token]: TOKEN }), false);
    assert.equal(githubEnabled(null), false);
    assert.equal(githubEnabled({}), false);
  });

  test('reads a Repository-like store and honours the masked placeholder as "no token"', () => {
    assert.equal(githubEnabled(repoStore({ [SETTINGS_KEYS.enabled]: 'true', [SETTINGS_KEYS.token]: TOKEN })), true);
    assert.equal(githubEnabled(repoStore({ [SETTINGS_KEYS.enabled]: 'true', [SETTINGS_KEYS.token]: '__stored__' })), false);
    assert.equal(githubEnabled(repoStore({ [SETTINGS_KEYS.enabled]: 'false', [SETTINGS_KEYS.token]: TOKEN })), false);
    assert.equal(githubEnabled({ [SETTINGS_KEYS.publishOnImport]: true, [SETTINGS_KEYS.token]: TOKEN }), true);
  });
});

// ───────────────────────────── REST API ─────────────────────────────

describe('validateToken', () => {
  test('returns the login for a working token', async () => {
    const { fn, calls } = happyFetch();
    const res = await validateToken({ fetchImpl: fn, token: TOKEN });
    assert.deepEqual(res, { ok: true, username: OWNER, reason: '' });
    assert.equal(calls[0].url, 'https://api.github.com/user');
    assert.equal(calls[0].headers.authorization, `Basic ${TOKEN_B64}`);
    assertTokenHiddenEverywhere(calls, res);
  });

  test('a 401 yields a readable Chinese reason that hides the token', async () => {
    const { fn, calls } = happyFetch({ 'GET https://api.github.com/user': () => jsonResponse(401, { message: 'Bad credentials' }) });
    const res = await validateToken({ fetchImpl: fn, token: TOKEN });
    assert.equal(res.ok, false);
    assert.equal(res.username, '');
    assert.match(res.reason, /令牌无效或已被撤销/);
    assert.ok(!res.reason.includes(TOKEN));
    assertTokenHiddenEverywhere(calls, res);
  });

  test('a network failure never throws and never echoes the secret', async () => {
    const message = `connect failed while sending ${TOKEN}`;
    const boom = { calls: [] };
    boom.fn = async () => { throw new Error(message); };
    const res = await validateToken({ fetchImpl: boom.fn, token: TOKEN });
    assert.equal(res.ok, false);
    assert.match(res.reason, /无法连接 GitHub/);
    assert.ok(!res.reason.includes(TOKEN), `reason leaked the token: ${res.reason}`);
  });

  test('missing token short-circuits before any request', async () => {
    let touched = 0;
    const res = await validateToken({ fetchImpl: async () => { touched += 1; return jsonResponse(200, {}); }, token: '' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /尚未配置/);
    assert.equal(touched, 0);
  });

  test('reads the token from settings when none is passed', async () => {
    const { fn } = happyFetch();
    const res = await validateToken({ fetchImpl: fn, settings: settingsWith() });
    assert.equal(res.ok, true);
    assert.equal(res.username, OWNER);
  });
});

describe('ensurePrivateRepo', () => {
  test('creates a private, uninitialised repository and reports the URL', async () => {
    const { fn, calls } = happyFetch();
    const res = await ensurePrivateRepo({ fetchImpl: fn, owner: OWNER, name: REPO, token: TOKEN });
    assert.equal(res.ok, true);
    assert.equal(res.created, true);
    assert.equal(res.fullName, 'tester/demo-app');
    assert.equal(res.htmlUrl, 'https://github.com/tester/demo-app');
    assert.equal(res.reason, '');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://api.github.com/user/repos');
    assert.deepEqual(calls[0].body, { name: REPO, private: true, auto_init: false, has_issues: false, has_wiki: false });
    assertTokenHiddenEverywhere(calls, res);
  });

  test('HTTP 422 "already exists" is success, so re-importing never errors', async () => {
    const exists = () => jsonResponse(422, {
      message: 'Validation Failed',
      errors: [{ resource: 'Repository', field: 'name', code: 'custom', message: 'name already exists' }],
      documentation_url: 'https://docs.github.com/rest/repos/repos#create-a-repository',
    });
    const { fn, calls } = happyFetch({ 'POST https://api.github.com/user/repos': exists });
    const res = await ensurePrivateRepo({ fetchImpl: fn, owner: OWNER, name: REPO, token: TOKEN });
    assert.equal(res.ok, true);
    assert.equal(res.created, false);
    assert.equal(res.fullName, 'tester/demo-app');
    assert.equal(res.htmlUrl, 'https://github.com/tester/demo-app');
    assert.match(res.reason, /已存在/);
    assertTokenHiddenEverywhere(calls, res);
  });

  test('any other 422 is a real failure', async () => {
    const { fn } = happyFetch({
      'POST https://api.github.com/user/repos': () => jsonResponse(422, { message: 'Validation Failed', errors: [{ field: 'name', code: 'invalid' }] }),
    });
    const res = await ensurePrivateRepo({ fetchImpl: fn, owner: OWNER, name: REPO, token: TOKEN });
    assert.equal(res.ok, false);
    assert.match(res.reason, /HTTP 422/);
  });

  test('a 401 from the API is reported honestly', async () => {
    const { fn } = happyFetch({ 'POST https://api.github.com/user/repos': () => jsonResponse(401, { message: 'Bad credentials' }) });
    const res = await ensurePrivateRepo({ fetchImpl: fn, owner: OWNER, name: REPO, token: TOKEN });
    assert.equal(res.ok, false);
    assert.match(res.reason, /401/);
    assert.ok(!res.reason.includes(TOKEN));
  });

  test('derives the owner from /user when none is configured', async () => {
    const { fn, calls } = happyFetch();
    const res = await ensurePrivateRepo({ fetchImpl: fn, name: REPO, token: TOKEN });
    assert.equal(res.ok, true);
    assert.equal(calls[0].url, 'https://api.github.com/user');
    assert.equal(calls[1].url, 'https://api.github.com/user/repos');
    assertTokenHiddenEverywhere(calls, res);
  });

  test('the API html_url is turned into a credential-free clone URL', () => {
    const url = plainRemoteUrl({ htmlUrl: 'https://github.com/tester/demo-app' });
    assert.equal(url, 'https://github.com/tester/demo-app.git');
    const chinese = plainRemoteUrl({ fullName: 'tester/中文仓库' });
    assert.equal(chinese, `https://github.com/tester/${encodeURIComponent('中文仓库')}.git`);
    assert.ok(!chinese.includes('@'));
    assert.equal(plainRemoteUrl({ htmlUrl: 'https://user:token@github.com/a/b' }), 'https://user:token@github.com/a/b.git');
  });
});

// ───────────────────────────── local repository preparation ─────────────────────────────

describe('prepareRepository', () => {
  const cwd = 'C:/work/demo-app';

  test('runs a read of an existing clean repository without committing', async () => {
    const git = makeGit();
    const res = await prepareRepository({ git: git.fn, cwd });
    assert.equal(res.ok, true);
    assert.equal(res.branch, 'main');
    assert.equal(res.hadCommits, true);
    assert.equal(res.reason, '');
    assert.ok(!git.calls.some((c) => /git init/.test(c.argv)), 'must not re-init an existing repository');
    assert.ok(!git.calls.some((c) => /git commit/.test(c.argv)), 'nothing to commit must be a clean skip');
    assert.equal(git.calls.some((c) => /config/.test(c.argv)), false, 'must not touch .git/config');
  });

  test('inits a missing repository with the requested branch', async () => {
    const git = makeGit({}, { isRepo: false, hadCommits: false, gitignoreTracked: false, gitignoreUntracked: true, dirty: true });
    const res = await prepareRepository({ git: git.fn, cwd, branch: 'main' });
    assert.equal(res.ok, true);
    assert.equal(res.hadCommits, false);
    assert.equal(res.branch, 'main');
    assert.ok(git.calls.some((c) => c.argv === 'git init -b main'));
    assert.ok(git.calls.some((c) => c.argv === 'git add -A'));
    assert.ok(git.calls.some((c) => /^git commit -m /.test(c.argv)));
  });

  test('creates a .gitignore only when git reports that none exists', async () => {
    const present = makeFiles({ exists: true });
    const gitWithIgnore = makeGit({}, { gitignoreTracked: true });
    await prepareRepository({ git: gitWithIgnore.fn, cwd, files: present });
    assert.equal(present.calls.filter((c) => c.op === 'createIfMissing').length, 0);

    const gitWithoutIgnore = makeGit({}, { gitignoreTracked: false, gitignoreUntracked: false });
    const absent = makeFiles({ exists: false });
    const res = await prepareRepository({ git: gitWithoutIgnore.fn, cwd, files: absent });
    assert.equal(res.ok, true);
    const created = absent.calls.filter((c) => c.op === 'createIfMissing');
    assert.equal(created.length, 1);
    assert.equal(created[0].name, '.gitignore');
    assert.equal(created[0].dir, cwd);
    assert.match(created[0].content, /node_modules\//);
  });

  test('a blocked command is reported instead of worked around', async () => {
    const git = makeGit({ 'git add': blocked('no allowlist rule matches "git add -A"') }, { isRepo: false, hadCommits: false, dirty: true });
    const res = await prepareRepository({ git: git.fn, cwd });
    assert.equal(res.ok, false);
    assert.match(res.reason, /安全策略拦截/);
    assert.ok(!res.reason.includes(TOKEN));
  });

  test('git author identity problems are explained, not hidden', async () => {
    const git = makeGit({
      'git commit': () => fail(128, '*** Please tell me who you are.\n\nerror: unable to auto-detect email address'),
    }, { isRepo: false, hadCommits: false, gitignoreTracked: false, dirty: true });
    const res = await prepareRepository({ git: git.fn, cwd });
    assert.equal(res.ok, false);
    assert.match(res.reason, /提交身份/);
  });

  test('an injected identity reaches git through env, never through argv', async () => {
    const git = makeGit({}, { isRepo: false, hadCommits: false, gitignoreTracked: false, dirty: true });
    const res = await prepareRepository({ git: git.fn, cwd, identity: { name: 'Commander', email: 'bot@example.com' } });
    assert.equal(res.ok, true);
    const commit = git.calls.find((c) => /git commit/.test(c.argv));
    assert.deepEqual(commit.env, { GIT_AUTHOR_NAME: 'Commander', GIT_COMMITTER_NAME: 'Commander', GIT_AUTHOR_EMAIL: 'bot@example.com', GIT_COMMITTER_EMAIL: 'bot@example.com' });
    assert.ok(!commit.argv.includes('bot@example.com'));
  });

  test('refuses to work without a git executor or a path', async () => {
    assert.equal((await prepareRepository({ cwd })).ok, false);
    assert.equal((await prepareRepository({ git: makeGit().fn, cwd: '' })).ok, false);
  });
});

describe('ensureOriginRemote', () => {
  test('adds a plain origin when none exists', async () => {
    const git = makeGit();
    const url = 'https://github.com/tester/demo-app.git';
    const res = await ensureOriginRemote({ git: git.fn, cwd: '/w', url });
    assert.equal(res.ok, true);
    assert.equal(res.action, 'added');
    assert.ok(git.calls.some((c) => c.argv === `git remote add origin ${url}`));
  });

  test('re-points an existing origin and leaves a matching one alone', async () => {
    const url = 'https://github.com/tester/demo-app.git';
    const stale = makeGit({}, { originUrl: 'https://github.com/someone/else.git' });
    const updated = await ensureOriginRemote({ git: stale.fn, cwd: '/w', url });
    assert.equal(updated.ok, true);
    assert.equal(updated.action, 'updated');
    assert.ok(stale.calls.some((c) => c.argv === `git remote set-url origin ${url}`));

    const matching = makeGit({}, { originUrl: url });
    const same = await ensureOriginRemote({ git: matching.fn, cwd: '/w', url });
    assert.equal(same.ok, true);
    assert.equal(same.action, 'unchanged');
    assert.equal(matching.calls.filter((c) => /remote (add|set-url)/.test(c.argv)).length, 0);
  });

  test('rejects a remote URL that carries credentials', async () => {
    const git = makeGit();
    const res = await ensureOriginRemote({ git: git.fn, cwd: '/w', url: `https://x-access-token:${TOKEN}@github.com/a/b.git` });
    assert.equal(res.ok, false);
    assert.match(res.reason, /凭据/);
    assert.ok(!res.reason.includes(TOKEN));
    assert.equal(git.calls.filter((c) => /remote (add|set-url)/.test(c.argv)).length, 0);
  });
});

// ───────────────────────────── executor contract (ADR-003) ─────────────────────────────

describe('executor contract', () => {
  test('the publisher never emits a destructive git verb', async () => {
    const { classifyCommand } = await import('../../src/core/command-runner.js');
    // Whatever the executor ends up allowing, these must stay impossible.
    for (const line of ['push --force origin main', 'push -f origin main', 'reset --hard', 'clean -fd', 'filter-branch', 'rebase main', 'branch -D main']) {
      assert.equal(classifyCommand('git', line.split(' ')).allowed, false, `"git ${line}" must stay blocked`);
    }
    const never = ['--force', '-f', 'reset', 'clean', 'rebase', 'filter-branch', 'checkout'];
    const git = makeGit();
    await publishProject({ fetchImpl: happyFetch().fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    for (const call of git.calls) {
      for (const word of never) {
        assert.ok(!call.args.includes(word), `the publisher used "${word}": ${call.argv}`);
      }
    }
  });

  test('the inspection verbs stay allowed by the read-only rules', async () => {
    const { classifyCommand } = await import('../../src/core/command-runner.js');
    for (const args of [['rev-parse', '--is-inside-work-tree'], ['symbolic-ref', '--short', 'HEAD'], ['status', '--porcelain'], ['ls-files', '--', '.gitignore'], ['remote', 'get-url', 'origin'], ['remote', 'set-url', 'origin', 'https://github.com/o/r.git']]) {
      assert.equal(classifyCommand('git', args).allowed, true, `git ${args.join(' ')} should stay allowed`);
    }
  });

  test('a blocked write verb is surfaced as a reason, not retried or bypassed', async () => {
    const git = makeGit({ 'git push': blocked('no allowlist rule matches "git push --set-upstream origin main"') });
    const result = await publishProject({ fetchImpl: happyFetch().fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /安全策略拦截/);
    assert.equal(git.calls.filter((c) => c.args[0] === 'push').length, 1, 'a blocked command must not be retried');
    assertTokenHiddenEverywhere(git.calls, result);
  });
});

// ───────────────────────────── orchestration ─────────────────────────────

describe('publishProject', () => {
  test('the full happy path pushes with env authentication and returns no secret', async () => {
    const fetchImpl = happyFetch();
    const git = makeGit({}, { isRepo: false, hadCommits: false, gitignoreTracked: false, dirty: true });
    const files = makeFiles({ exists: false });
    const result = await publishProject({
      fetchImpl: fetchImpl.fn, git: git.fn, files, settings: settingsWith(),
      project: { name: '演示 项目/demo', workspace_path: 'C:/work/demo-app' },
    });

    assert.equal(result.ok, true, result.reason);
    assert.equal(result.stage, PUBLISH_STAGES.PUSHED);
    assert.equal(result.fullName, 'tester/demo-app');
    assert.equal(result.htmlUrl, 'https://github.com/tester/demo-app');
    assert.equal(result.username, OWNER);
    assert.equal(result.branch, 'main');
    assert.equal(result.created, true);
    assert.match(result.at, /^\d{4}-\d{2}-\d{2}T/);

    const push = git.calls.find((c) => /git push/.test(c.argv));
    assert.equal(push.argv, 'git push --set-upstream origin main');
    assert.equal(push.env.GIT_CONFIG_COUNT, '1');
    assert.equal(push.env.GIT_CONFIG_KEY_0, 'http.extraheader');
    assert.equal(push.env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${TOKEN_B64}`);
    assert.equal(gitAuthEnv(TOKEN).GIT_CONFIG_VALUE_0, push.env.GIT_CONFIG_VALUE_0);

    const remote = git.calls.find((c) => /remote add origin/.test(c.argv));
    assert.equal(remote.argv, 'git remote add origin https://github.com/tester/demo-app.git');
    const post = fetchImpl.calls.find((c) => c.method === 'POST');
    assert.equal(post.body.name, '演示_项目_demo', 'the Chinese project name must reach the API as a legal slug');
    assert.equal(post.body.private, true);
    assert.equal(git.calls.filter((c) => /config/.test(c.argv)).length, 0, 'git config must never be touched');
    assertTokenHiddenEverywhere([...git.calls, ...fetchImpl.calls.map((c) => ({ args: [c.method, c.url], argv: `${c.method} ${c.url}` }))], result);
    assert.equal(JSON.parse(JSON.stringify(result)).ok, true, 'result must stay serialisable');
  });

  test('reports stage disabled when there is no token and no toggle', async () => {
    const fetchImpl = happyFetch();
    const git = makeGit();
    const result = await publishProject({ fetchImpl: fetchImpl.fn, git: git.fn, settings: {} });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.DISABLED);
    assert.match(result.reason, /未开启/);
    assert.equal(fetchImpl.calls.length, 0, 'nothing may leave the machine while disabled');
    assert.equal(git.calls.length, 0);
    assertTokenHiddenEverywhere(git.calls, result);
  });

  test('reports stage no-token when publishing is on but the token is gone', async () => {
    const result = await publishProject({
      fetchImpl: happyFetch().fn, git: makeGit().fn,
      settings: settingsWith({ [SETTINGS_KEYS.token]: '' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.NO_TOKEN);
    assert.match(result.reason, /令牌/);
    assert.ok(!result.reason.includes(TOKEN));
  });

  test('a failed token validation stops before any git call', async () => {
    const fetchImpl = happyFetch({ 'GET https://api.github.com/user': () => jsonResponse(403, { message: 'Resource not accessible by personal access token' }) });
    const git = makeGit();
    const result = await publishProject({ fetchImpl: fetchImpl.fn, git: git.fn, settings: settingsWith() });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.FAILED);
    assert.match(result.reason, /令牌校验未通过/);
    assert.match(result.reason, /403/);
    assert.equal(git.calls.length, 0);
    assertTokenHiddenEverywhere(git.calls, result);
  });

  test('validateOnly stops after the credential check', async () => {
    const fetchImpl = happyFetch();
    const result = await publishProject({ fetchImpl: fetchImpl.fn, git: makeGit().fn, settings: settingsWith(), validateOnly: true });
    assert.equal(result.ok, true);
    assert.equal(result.stage, PUBLISH_STAGES.VALIDATED);
    assert.equal(fetchImpl.calls.length, 1);
    assertTokenHiddenEverywhere([], result);
  });

  test('is idempotent: a second import reuses the repository and reports repo-exists', async () => {
    let posted = 0;
    const fetchImpl = happyFetch({
      'POST https://api.github.com/user/repos': () => (posted += 1) === 1
        ? jsonResponse(201, { full_name: `${OWNER}/${REPO}`, html_url: `https://github.com/${OWNER}/${REPO}` })
        : jsonResponse(422, { message: 'Validation Failed', errors: [{ field: 'name', code: 'custom', message: 'name already exists' }] }),
    });
    const url = 'https://github.com/tester/demo-app.git';
    // One executor and one workspace state, reused for both publishes.
    const git = makeGit({}, { isRepo: false, hadCommits: false, gitignoreTracked: false, dirty: true });
    const ctx = { fetchImpl: fetchImpl.fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w', files: makeFiles({ exists: false }) };

    const first = await publishProject(ctx);
    const second = await publishProject(ctx);

    assert.equal(first.ok, true, first.reason);
    assert.equal(first.created, true);
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.stage, PUBLISH_STAGES.PUSHED);
    assert.equal(second.created, false, 'the re-import must report that the repo already existed');
    assert.equal(second.fullName, 'tester/demo-app');
    assert.equal(git.calls.filter((c) => /remote add origin/.test(c.argv)).length, 1, 'origin is added once');
    assert.equal(git.calls.filter((c) => /remote set-url/.test(c.argv)).length, 0, 'a matching origin must not be rewritten');
    assert.equal(git.calls.filter((c) => /git push/.test(c.argv)).length, 2);
    assert.equal(git.settings.originUrl, url);
    assertTokenHiddenEverywhere(git.calls, second);
  });

  test('a matching origin is left untouched on re-publish', async () => {
    const url = 'https://github.com/tester/demo-app.git';
    const git = makeGit({}, { originUrl: url });
    const result = await publishProject({ fetchImpl: happyFetch().fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    assert.equal(result.ok, true, result.reason);
    assert.equal(git.calls.filter((c) => /remote (add|set-url)/.test(c.argv)).length, 0);
    assertTokenHiddenEverywhere(git.calls, result);
  });

  test('never throws when the git executor throws', async () => {
    const exploding = async () => { throw new Error(`git died while holding ${TOKEN}`); };
    const result = await publishProject({
      fetchImpl: happyFetch().fn, git: exploding, settings: settingsWith(),
      name: REPO, workspacePath: 'C:/work/demo-app',
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.FAILED);
    assert.match(result.reason, /发布过程出现异常/);
    assert.ok(!result.reason.includes(TOKEN), `reason leaked: ${result.reason}`);
    assert.ok(!result.reason.includes(TOKEN_B64));
    assert.equal(typeof result.at, 'string');
  });

  test('never throws when fetch itself throws', async () => {
    const result = await publishProject({
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
      git: makeGit().fn,
      settings: settingsWith(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.FAILED);
    assert.match(result.reason, /令牌校验未通过/);
    assertTokenHiddenEverywhere([], result);
  });

  test('a rejected push is surfaced with its Chinese reason, token-free', async () => {
    const git = makeGit({
      'git push': () => fail(1, ' ! [rejected]        main -> main (non-fast-forward)\nfatal: Could not read from remote repository'),
    });
    const result = await publishProject({ fetchImpl: happyFetch().fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    assert.equal(result.ok, false);
    assert.equal(result.stage, PUBLISH_STAGES.FAILED);
    assert.match(result.reason, /远端分支已存在/);
    assert.ok(!result.reason.includes(TOKEN));
    assertTokenHiddenEverywhere(git.calls, result);
  });

  test('an executor that ignores per-call env is reported as an authentication problem', async () => {
    const noEnv = async (req) => (req.args[0] === 'push'
      ? fail(128, 'fatal: could not read Username for https://github.com: terminal prompts disabled')
      : ok(''));
    const result = await publishProject({ fetchImpl: happyFetch().fn, git: noEnv, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /认证环境变量/);
    assertTokenHiddenEverywhere([], result);
  });

  test('works against a Repository-like settings store and an object-style executor', async () => {
    const calls = [];
    const runner = {
      run: async (req) => {
        calls.push({ argv: `git ${req.args.join(' ')}`, args: [...req.args], env: req.env ? { ...req.env } : undefined });
        return makeGit({}).fn(req);
      },
    };
    const result = await publishProject({
      fetchImpl: happyFetch().fn, git: runner, repo: repoStore({ [SETTINGS_KEYS.enabled]: 'true', [SETTINGS_KEYS.token]: TOKEN, [SETTINGS_KEYS.owner]: OWNER }),
      name: REPO, workspacePath: '/w',
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.stage, PUBLISH_STAGES.PUSHED);
    assertTokenHiddenEverywhere(calls, result);
  });

  test('the publisher instance exposes a masked status and the last result', async () => {
    const fetchImpl = happyFetch();
    const git = makeGit();
    const publisher = new GitHubPublisher({ fetchImpl: fetchImpl.fn, git: git.fn, settings: settingsWith() });
    const described = publisher.describe();
    assert.equal(described.enabled, true);
    assert.equal(described.hasToken, true);
    assert.equal(described.owner, OWNER);
    assert.ok(!JSON.stringify(described).includes(TOKEN), 'describe() must never expose the token');

    const result = await publisher.publish({ name: REPO, workspacePath: '/w' });
    assert.equal(result.ok, true, result.reason);
    assert.equal(publisher.lastResult, result);
    assertTokenHiddenEverywhere(git.calls, result);
  });

  test('every documented stage is a frozen string', () => {
    assert.equal(Object.isFrozen(PUBLISH_STAGES), true);
    assert.deepEqual(
      [...Object.values(PUBLISH_STAGES)].sort(),
      ['committed', 'disabled', 'failed', 'no-token', 'pushed', 'repo-created', 'repo-exists', 'validated'].sort(),
    );
    for (const stage of Object.values(PUBLISH_STAGES)) assert.equal(typeof stage, 'string');
  });

  test('the result shape stays exactly the serialisable contract', async () => {
    const git = makeGit();
    const result = await publishProject({ fetchImpl: happyFetch().fn, git: git.fn, settings: settingsWith(), name: REPO, workspacePath: '/w' });
    for (const key of ['ok', 'stage', 'fullName', 'htmlUrl', 'reason', 'at']) {
      assert.ok(key in result, `missing key ${key}`);
    }
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.stage, 'string');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.at, 'string');
    assertTokenHiddenEverywhere(git.calls, result);
  });
});
