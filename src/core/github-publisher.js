/**
 * GitHub publisher — "import a project, get a PRIVATE GitHub repository".
 *
 * This module is deliberately dependency-free and side-effect-light: it talks to the
 * GitHub REST API through Node's built-in global `fetch` (no axios/undici import) and it
 * talks to git through an INJECTED executor (ADR-003).
 *
 * Security rules it exists to enforce (see docs/agent/NEXT_ACTION.md "Do Not Break"):
 *
 *  1. The Personal Access Token is a secret. It never appears in process argv, in a
 *     command string, in a log line, in the returned objects or in the database (it lives
 *     only in `app_settings`, written by the Settings route). Every string this module
 *     hands back or logs passes through `redact()`, which scrubs both known PAT shapes and
 *     the literal token value (plus its base64 forms) supplied by the caller.
 *  2. The token never lands in the managed project's `.git/config`. The remote URL stays a
 *     plain `https://github.com/<owner>/<repo>.git`; authentication is handed to git as
 *     per-process environment variables supported by git >= 2.31 (see `gitAuthEnv`).
 *  3. No child process may be spawned from here — `src/core/command-runner.js` is the only
 *     module allowed to do that, and `tools/lint.js` enforces it.
 *
 * ── WHY `git` IS INJECTED (required executor capability) ───────────────────────────
 * `CommandRunner.run({ command, args, cwd, timeoutMs, purpose })` does NOT accept per-call
 * environment variables: it always spawns with `{ ...process.env, CI, NO_COLOR,
 * FORCE_COLOR }`. Rule #2 above depends on per-call env, so this module cannot be wired to
 * CommandRunner as it stands. The caller therefore supplies an executor that honours one
 * extra field on the same request shape:
 *
 *   runGit({ command: 'git', args: [...], cwd, purpose, timeoutMs, env: { GIT_CONFIG_COUNT: '1', ... } })
 *
 * The `env` object must be merged into the child environment by that executor. Once
 * CommandRunner grows `env` support (that file is owned by another agent — do not edit it
 * from here), the same call site keeps working unchanged.
 *
 * CommandRunner's allowlist covers the read-only verbs this module uses (`rev-parse`,
 * `symbolic-ref`, `status`, `ls-files`, `remote get-url/set-url/add`), but NOT `init`,
 * `add`, `commit` or `push` — those four must be allowed by whatever executor is
 * supplied. If a call comes back flagged `blocked`, this module reports that honestly
 * instead of silently working around the guard.
 */
import { logger } from './logger.js';
import { nowIso, summarizeOutput } from './util.js';

const log = logger.child('github');

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_WEB_BASE = 'https://github.com';

/** Settings keys owned by the Settings route (`app.repo.setSetting`). */
export const SETTINGS_KEYS = Object.freeze({
  token: 'github.token',
  enabled: 'github.enabled',
  owner: 'github.owner',
  /** Accepted alias for the publish toggle. */
  publishOnImport: 'github.publishOnImport',
});

export const PUBLISH_STAGES = Object.freeze({
  DISABLED: 'disabled',
  NO_TOKEN: 'no-token',
  VALIDATED: 'validated',
  REPO_CREATED: 'repo-created',
  REPO_EXISTS: 'repo-exists',
  COMMITTED: 'committed',
  PUSHED: 'pushed',
  FAILED: 'failed',
});

export const DEFAULT_BRANCH = 'main';
export const MAX_REPO_NAME_LENGTH = 100;
export const FALLBACK_REPO_NAME = 'project';

const REDACTED = '[REDACTED]';
const MIN_TOKEN_LENGTH = 8;
/** The Settings API hands back this mask instead of the secret — it is never a real token. */
const STORED_PLACEHOLDER = '__stored__';

/** Known secret shapes; `redact` also scrubs caller-supplied literal values. */
const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{6,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{6,}\b/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{16,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:authorization|x-access-token|access_token|password|passwd|secret|token)\s*[:=]\s*\S+/gi,
  /\/\/[^/@\s:]+:[^@\s/]+@/g,
];

/**
 * Remove every trace of a secret from a string.
 *
 * `secrets` is the belt-and-braces half: arbitrary PATs do not all match a known shape, so
 * the caller passes the literal token (and anything derived from it) to be scrubbed. Base64
 * and URL-encoded variants are scrubbed too, because the token is handed to git as a base64
 * Authorization header and could come back inside git's own error output.
 *
 * @param {unknown} text
 * @param {string[]} [secrets]
 * @returns {string}
 */
export function redact(text, secrets = []) {
  if (text === null || text === undefined) return '';
  let out = String(text);
  const literals = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of literals) {
    const value = String(secret || '');
    if (value.length < 4) continue;
    for (const variant of secretVariants(value)) out = out.split(variant).join(REDACTED);
  }
  for (const rx of SECRET_PATTERNS) out = out.replace(rx, REDACTED);
  return out.slice(0, 4000);
}

function secretVariants(value) {
  const out = new Set([value]);
  try {
    out.add(Buffer.from(value, 'utf8').toString('base64'));
    out.add(Buffer.from(`x-access-token:${value}`, 'utf8').toString('base64'));
    out.add(encodeURIComponent(value));
  } catch { /* non-string input: the literal alone is enough */ }
  return [...out].filter((v) => v && v.length >= 4);
}

// ───────────────────────────── settings access ─────────────────────────────

/**
 * Read one setting from either a `Repository`-like store (`.getSetting(key)`) or a plain
 * object map (`{ 'github.token': '...' }`), so the module is usable with or without a DB.
 */
function readSetting(settings, key) {
  if (!settings) return null;
  try {
    if (typeof settings.getSetting === 'function') return settings.getSetting(key);
    if (typeof settings === 'function') return settings(key);
    if (key in Object(settings)) return settings[key];
  } catch { /* a broken store must degrade to "not configured" */ }
  return null;
}

/** The stored PAT, trimmed. Empty string when unset or when only the UI mask is present. */
export function githubToken(settings) {
  const raw = readSetting(settings, SETTINGS_KEYS.token);
  const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!value || value === STORED_PLACEHOLDER || value.length < MIN_TOKEN_LENGTH) return '';
  return value;
}

function isToggleOn(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return false;
  return !(text === 'false' || text === '0' || text === 'off' || text === 'no');
}

/** True only when a publish toggle is on AND a usable token has been stored. */
export function githubEnabled(settings) {
  let toggle = readSetting(settings, SETTINGS_KEYS.enabled);
  if (toggle === null || toggle === undefined) toggle = readSetting(settings, SETTINGS_KEYS.publishOnImport);
  return isToggleOn(toggle) && Boolean(githubToken(settings));
}

function readOwner(settings, fallback = '') {
  const raw = readSetting(settings, SETTINGS_KEYS.owner);
  const value = String(raw || '').trim().replace(/^@+/, '');
  return value || String(fallback || '').trim().replace(/^@+/, '');
}

// ───────────────────────────── authentication ─────────────────────────────

/** `Authorization: Basic base64("x-access-token:<token>")` — the only place the token is encoded. */
export function basicAuthHeader(token) {
  const value = String(token || '');
  if (!value) return '';
  return `Basic ${Buffer.from(`x-access-token:${value}`, 'utf8').toString('base64')}`;
}

/**
 * Per-call git environment that authenticates WITHOUT touching the repository config.
 *
 * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` (git >= 2.31) inject a
 * throwaway config entry for this one process only, so nothing is written into
 * `.git/config` and nothing secret ever reaches argv.
 *
 * @param {string} token
 * @returns {Record<string,string>}
 */
export function gitAuthEnv(token) {
  const header = basicAuthHeader(token);
  if (!header) return {};
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: ${header}`,
  };
}

function apiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'ai-project-commander',
    authorization: basicAuthHeader(token),
  };
}

function requestSignal(timeoutMs) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs);
  } catch { /* very old runtime: no timeout support */ }
  return undefined;
}

// ───────────────────────────── repo naming ─────────────────────────────

/**
 * Deterministic GitHub-legal repository slug.
 *
 * Chinese and other non-ASCII characters are KEPT — GitHub accepts them — while path
 * separators and shell/URL-hostile characters become `_`. Leading/trailing dots and dashes
 * are stripped (git ref and URL rules), runs of `_` collapse, and the result is capped at
 * 100 characters. Never returns an empty string.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeRepoName(name) {
  const raw = name === null || name === undefined ? '' : String(name);
  const trimmed = raw
    .trim()
    .normalize('NFKC')
    .replace(/[\s/\\:*?"<>|]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^[.\-_]+/, '')
    .replace(/[.\-_]+$/, '')
    .replace(/_{2,}/g, '_')
    .slice(0, MAX_REPO_NAME_LENGTH)
    .replace(/[.\-_]+$/, '');
  return trimmed || FALLBACK_REPO_NAME;
}

/**
 * Plain, secret-free clone URL. The API's own `html_url` wins when present (it is already
 * correctly percent-encoded for non-ASCII names); otherwise the URL is built from parts.
 */
export function plainRemoteUrl({ fullName = '', htmlUrl = '', owner = '', name = '' } = {}) {
  const web = String(htmlUrl || '').trim();
  if (/^https:\/\//i.test(web)) {
    const base = web.replace(/\/+$/, '');
    return /\.git$/i.test(base) ? base : `${base}.git`;
  }
  const full = String(fullName || '').trim().replace(/^\/+|\/+$/g, '');
  const path = full || [owner, name].filter(Boolean).map((part) => String(part).trim().replace(/^@+/, '')).join('/');
  if (!path || !path.includes('/')) return '';
  const [repoOwner, ...rest] = path.split('/');
  return `${GITHUB_WEB_BASE}/${encodeURIComponent(repoOwner)}/${encodeURIComponent(rest.join('/'))}.git`;
}

/** Refuse to build a remote URL that smuggles credentials — that is how tokens leak into .git/config. */
function isCredentialFreeUrl(url) {
  const text = String(url || '');
  if (!/^https:\/\//i.test(text)) return false;
  const hostPart = text.slice(text.indexOf('://') + 3).split('/')[0];
  return !hostPart.includes('@');
}

// ───────────────────────────── git executor plumbing ─────────────────────────────

/**
 * @typedef {(req: {command: string, args: string[], cwd: string, purpose?: string, timeoutMs?: number, env?: Record<string,string>}) => Promise<object>|object} GitExec
 * An executor that behaves like `CommandRunner.run` plus per-call `env` (see file header).
 */

/**
 * @typedef {object} WorkspaceFiles
 * @property {(dir: string, name: string) => (boolean|Promise<boolean>)} [exists]
 * @property {(dir: string, name: string, content: string) => (unknown|Promise<unknown>)} [createIfMissing]
 */

function normalizeGitResult(raw) {
  const res = raw && typeof raw === 'object' ? raw : {};
  const exitNumber = Number(res.exitCode);
  const exitCode = Number.isFinite(exitNumber) ? exitNumber : (res.ok === true ? 0 : 1);
  return {
    ok: res.ok === undefined ? exitCode === 0 : Boolean(res.ok),
    blocked: Boolean(res.blocked),
    timedOut: Boolean(res.timedOut),
    exitCode,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
  };
}

async function execGit(git, req) {
  if (!git) throw new Error('no git executor was injected');
  const raw = typeof git === 'function' ? await git(req) : await git.run(req);
  return normalizeGitResult(raw);
}

function blockedReason(res) {
  const detail = redact(res.stderr || '不在允许清单内');
  return `命令被命令执行器的安全策略拦截（${detail}）。发布流程需要 git 的 init/add/commit/remote/push 权限，请在执行器允许清单中放行。`;
}

/** Minimal `.gitignore` created only when the repository genuinely has none. */
export const DEFAULT_GITIGNORE = [
  'node_modules/',
  'dist/',
  'build/',
  '.env',
  '.env.*',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n');

/**
 * Prepare a workspace for publishing.
 *
 * ⚠ DELIBERATE EXCEPTION TO THE READ-ONLY RULE (ADR-009) ⚠
 * A managed workspace is otherwise never written to. Creating a git repository, an initial
 * commit and a `.gitignore` inside the user's project is a *user-initiated* action: it only
 * ever runs from `publishProject`, which the user triggers from the UI after pasting a
 * token. It is additive (`git init`, `.gitignore` when absent, `git add -A`, one commit) and
 * never deletes, rewrites or force-pushes anything. Files are touched through the injected
 * `WorkspaceFiles` facade — this module itself imports no filesystem at all (lint-enforced).
 *
 * @param {{git?: GitExec, cwd: string, branch?: string, files?: WorkspaceFiles|null,
 *          identity?: {name?: string, email?: string}|null, message?: string,
 *          timeoutMs?: number, secrets?: string[]}} options
 * @returns {Promise<{ok: boolean, branch: string, hadCommits: boolean, reason: string}>}
 */
export async function prepareRepository({ git = null, cwd = '', branch = DEFAULT_BRANCH, files = null, identity = null, message = 'chore: 导入 AI Project Commander 管理的项目', timeoutMs = 60000, secrets = [] } = {}) {
  const target = String(cwd || '').trim();
  if (!git) return { ok: false, branch: '', hadCommits: false, reason: redact('未注入 git 执行器，无法准备本地仓库。', secrets) };
  if (!target) return { ok: false, branch: '', hadCommits: false, reason: redact('缺少项目路径（cwd），无法准备本地仓库。', secrets) };

  const baseBranch = String(branch || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  const run = (args, purpose, env) => execGit(git, { command: 'git', args, cwd: target, purpose, timeoutMs, env });
  const pushEnv = identityEnv(identity);

  // 1. a git repository must exist
  const probe = await run(['rev-parse', '--is-inside-work-tree'], 'github publish: detect repository');
  if (probe.blocked) return { ok: false, branch: '', hadCommits: false, reason: blockedReason(probe) };
  let hadCommits = false;
  if (!probe.ok) {
    const init = await run(['init', '-b', baseBranch], 'github publish: init repository');
    if (init.blocked) return { ok: false, branch: '', hadCommits: false, reason: blockedReason(init) };
    if (!init.ok) return { ok: false, branch: '', hadCommits: false, reason: redact(`初始化 git 仓库失败：${summarizeOutput(init.stderr || init.stdout, 400)}`, secrets) };
  } else {
    const head = await run(['rev-parse', '--verify', 'HEAD'], 'github publish: existing commit check');
    hadCommits = head.ok;
  }

  // 2. resolve the branch we are about to publish
  let resolvedBranch = hadCommits ? '' : baseBranch;
  if (!resolvedBranch) {
    const symbolic = await run(['symbolic-ref', '--short', 'HEAD'], 'github publish: current branch');
    resolvedBranch = symbolic.ok ? symbolic.stdout.trim() : '';
  }
  if (!resolvedBranch) {
    const short = await run(['rev-parse', '--abbrev-ref', 'HEAD'], 'github publish: current branch');
    resolvedBranch = short.ok ? short.stdout.trim() : '';
  }
  if (!resolvedBranch || resolvedBranch === 'HEAD') resolvedBranch = baseBranch;

  // 3. a .gitignore, but only when the project truly has none
  const ignore = await ensureGitignore({ run, files, cwd: target, secrets });
  if (!ignore.ok) return { ok: false, branch: resolvedBranch, hadCommits, reason: ignore.reason };

  // 4. stage everything and make one commit — never amend, never force
  const add = await run(['add', '-A'], 'github publish: stage files');
  if (add.blocked) return { ok: false, branch: resolvedBranch, hadCommits, reason: blockedReason(add) };
  if (!add.ok) return { ok: false, branch: resolvedBranch, hadCommits, reason: redact(`暂存文件失败：${summarizeOutput(add.stderr || add.stdout, 400)}`, secrets) };

  const status = await run(['status', '--porcelain'], 'github publish: staged changes');
  const hasChanges = status.ok ? String(status.stdout || '').trim().length > 0 : !hadCommits;
  if (hasChanges) {
    const commit = await run(['commit', '-m', message], 'github publish: initial commit', pushEnv);
    if (commit.blocked) return { ok: false, branch: resolvedBranch, hadCommits, reason: blockedReason(commit) };
    if (!commit.ok) {
      const output = `${commit.stderr || ''} ${commit.stdout || ''}`;
      // git exits 1 for "nothing to commit"; that is a clean skip, not a failure.
      if (/nothing (to commit|added)/i.test(output)) {
        log.info('commit_skipped', { cwd: target, reason: 'nothing to commit' });
        return { ok: true, branch: resolvedBranch, hadCommits, reason: '' };
      }
      if (/author identity|user\.email|user\.name|auto-detect email|please tell me who you are/i.test(output)) {
        return { ok: false, branch: resolvedBranch, hadCommits, reason: 'git 尚未配置提交身份（user.name / user.email），无法创建提交。请先配置 git 身份或在发布时传入 identity。' };
      }
      return { ok: false, branch: resolvedBranch, hadCommits, reason: redact(`创建提交失败：${summarizeOutput(output, 400)}`, secrets) };
    }
    return { ok: true, branch: resolvedBranch, hadCommits, reason: '' };
  }

  // Nothing to commit: an already-imported, clean repository. Idempotent success.
  return { ok: true, branch: resolvedBranch, hadCommits, reason: '' };
}

function identityEnv(identity) {
  if (!identity || typeof identity !== 'object') return undefined;
  const name = String(identity.name || '').trim();
  const email = String(identity.email || '').trim();
  if (!name && !email) return undefined;
  const env = {};
  if (name) {
    env.GIT_AUTHOR_NAME = name;
    env.GIT_COMMITTER_NAME = name;
  }
  if (email) {
    env.GIT_AUTHOR_EMAIL = email;
    env.GIT_COMMITTER_EMAIL = email;
  }
  return env;
}

/** Detect the ignore file with git only (no filesystem read), then create it via the facade. */
async function ensureGitignore({ run, files, cwd, secrets }) {
  const tracked = await run(['ls-files', '--', '.gitignore'], 'github publish: tracked .gitignore');
  if (tracked.ok && String(tracked.stdout || '').trim()) return { ok: true };
  const untracked = await run(['status', '--porcelain', '--untracked-files=all', '--', '.gitignore'], 'github publish: untracked .gitignore');
  if (untracked.ok && String(untracked.stdout || '').trim()) return { ok: true };
  if (untracked.blocked) return { ok: false, reason: blockedReason(untracked) };

  const canCreate = files && typeof files.createIfMissing === 'function';
  if (!canCreate) {
    // No writer facade supplied: publishing still works, the project just keeps its own rules.
    log.warn('gitignore_skipped', { reason: 'no workspace file writer was injected' });
    return { ok: true };
  }
  if (typeof files.exists === 'function') {
    try {
      if (await files.exists(cwd, '.gitignore')) return { ok: true };
    } catch { /* the git probe above is authoritative; keep going */ }
  }
  try {
    await files.createIfMissing(cwd, '.gitignore', DEFAULT_GITIGNORE);
    log.info('gitignore_created', { name: '.gitignore' });
  } catch (err) {
    return { ok: false, reason: redact(`创建 .gitignore 失败：${err && err.message}`, secrets) };
  }
  return { ok: true };
}

// ───────────────────────────── GitHub REST API ─────────────────────────────

async function readJsonSafe(res) {
  if (!res || typeof res !== 'object') return {};
  if (typeof res.json === 'function') {
    try { return (await res.json()) || {}; } catch { /* fall through to text */ }
  }
  if (typeof res.text === 'function') {
    try { return JSON.parse(String(await res.text())); } catch { return {}; }
  }
  return typeof res.body === 'object' && res.body ? res.body : {};
}

function httpFailureReason(status, payload) {
  const apiMessage = String((payload && payload.message) || '').trim();
  const detail = apiMessage ? `：${apiMessage}` : '';
  if (status === 401) return `令牌无效或已被撤销（GitHub 返回 401）${detail}`;
  if (status === 403) return `GitHub 拒绝了请求（403），令牌权限不足或已触发限流${detail}`;
  if (status === 404) return `GitHub 接口不存在或不可访问（404）${detail}`;
  if (status >= 500) return `GitHub 服务暂时不可用（HTTP ${status}），请稍后重试${detail}`;
  return `GitHub 请求失败（HTTP ${status || 'unknown'}）${detail}`;
}

function alreadyExists(payload) {
  const errors = Array.isArray(payload && payload.errors) ? payload.errors : [];
  for (const item of errors) {
    if (/already[_ ]exists/i.test(String((item && item.code) || ''))) return true;
    if (/already exists/i.test(String((item && item.message) || ''))) return true;
  }
  return /already exists/i.test(String((payload && payload.message) || ''));
}

/**
 * GET /user — does the stored token work, and who owns it?
 *
 * @param {{fetchImpl?: typeof globalThis.fetch, token?: string, settings?: unknown,
 *          baseUrl?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, username: string, reason: string}>}
 */
export async function validateToken({ fetchImpl = globalThis.fetch, token = '', settings = null, baseUrl = GITHUB_API_BASE, timeoutMs = 15000 } = {}) {
  const value = String(token || '') || githubToken(settings);
  const secrets = value ? [value] : [];
  if (!value) return { ok: false, username: '', reason: redact('尚未配置 GitHub 访问令牌，请在设置中粘贴令牌。', secrets) };
  if (typeof fetchImpl !== 'function') return { ok: false, username: '', reason: redact('当前 Node 运行时没有内置 fetch，无法访问 GitHub API。', secrets) };

  try {
    const init = { method: 'GET', headers: apiHeaders(value) };
    const signal = requestSignal(timeoutMs);
    if (signal) init.signal = signal;
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/user`, init);
    const status = Number((res && res.status) || 0);
    const payload = await readJsonSafe(res);
    if (res && res.ok === false) return { ok: false, username: '', reason: redact(httpFailureReason(status, payload), secrets) };
    if (status !== 0 && status !== 200) return { ok: false, username: '', reason: redact(httpFailureReason(status, payload), secrets) };
    const username = String(payload.login || payload.name || '').trim();
    if (!username) return { ok: false, username: '', reason: redact('GitHub 未返回登录用户名，无法确定仓库归属。', secrets) };
    log.info('token_validated', { username });
    return { ok: true, username, reason: '' };
  } catch (err) {
    return { ok: false, username: '', reason: redact(`无法连接 GitHub：${(err && err.message) || '未知错误'}`, secrets) };
  }
}

/**
 * POST /user/repos — create the private repository, tolerating "already exists".
 *
 * Re-importing a project must not error, so HTTP 422 with an "already exists" payload is
 * reported as success with `created: false`.
 *
 * @param {{fetchImpl?: typeof globalThis.fetch, owner?: string, name: string, token?: string,
 *          settings?: unknown, baseUrl?: string, timeoutMs?: number}} options
 * @returns {Promise<{ok: boolean, fullName: string, htmlUrl: string, created: boolean, reason: string}>}
 */
export async function ensurePrivateRepo({ fetchImpl = globalThis.fetch, owner = '', name = '', token = '', settings = null, baseUrl = GITHUB_API_BASE, timeoutMs = 20000 } = {}) {
  const repoName = sanitizeRepoName(name);
  const value = String(token || '') || githubToken(settings);
  const secrets = value ? [value] : [];
  const result = { ok: false, fullName: '', htmlUrl: '', created: false, reason: '' };
  if (!value) return { ...result, reason: redact('尚未配置 GitHub 访问令牌，无法创建私有仓库。', secrets) };
  if (typeof fetchImpl !== 'function') return { ...result, reason: redact('当前 Node 运行时没有内置 fetch，无法访问 GitHub API。', secrets) };

  let ownerName = String(owner || '').trim().replace(/^@+/, '') || readOwner(settings);
  if (!ownerName) {
    const who = await validateToken({ fetchImpl, token: value, baseUrl, timeoutMs });
    ownerName = who.username;
  }

  try {
    const init = {
      method: 'POST',
      headers: apiHeaders(value),
      body: JSON.stringify({ name: repoName, private: true, auto_init: false, has_issues: false, has_wiki: false }),
    };
    const signal = requestSignal(timeoutMs);
    if (signal) init.signal = signal;
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/user/repos`, init);
    const status = Number((res && res.status) || 0);
    const payload = await readJsonSafe(res);

    if (status === 422 && alreadyExists(payload)) {
      const fullName = String(payload.full_name || '').trim() || (ownerName ? `${ownerName}/${repoName}` : repoName);
      log.info('repo_exists', { fullName });
      return {
        ok: true,
        fullName,
        htmlUrl: String(payload.html_url || '').trim() || `${GITHUB_WEB_BASE}/${fullName}`,
        created: false,
        reason: 'GitHub 上已存在同名私有仓库，直接复用。',
      };
    }
    if (res && res.ok === false) return { ...result, reason: redact(httpFailureReason(status, payload), secrets) };
    if (status !== 200 && status !== 201) return { ...result, reason: redact(httpFailureReason(status, payload), secrets) };

    const fullName = String(payload.full_name || (ownerName ? `${ownerName}/${repoName}` : repoName)).trim();
    const htmlUrl = String(payload.html_url || '').trim() || `${GITHUB_WEB_BASE}/${fullName}`;
    log.info('repo_created', { fullName });
    return { ok: true, fullName, htmlUrl, created: true, reason: '' };
  } catch (err) {
    return { ...result, reason: redact(`创建仓库时无法连接 GitHub：${(err && err.message) || '未知错误'}`, secrets) };
  }
}

// ───────────────────────────── orchestrator ─────────────────────────────

export class GitHubPublisher {
  /**
   * @param {{fetchImpl?: typeof globalThis.fetch, git?: GitExec, repo?: unknown,
   *          settings?: unknown, logger?: object, files?: WorkspaceFiles|null,
   *          baseUrl?: string, branch?: string, timeoutMs?: number}} [deps]
   */
  constructor({ fetchImpl = globalThis.fetch, git = null, repo = null, settings = null, logger: injectedLogger = null, files = null, baseUrl = GITHUB_API_BASE, branch = DEFAULT_BRANCH, timeoutMs = 120000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.git = git;
    this.repo = repo;
    this.settings = settings || repo || null;
    this.files = files;
    this.baseUrl = baseUrl;
    this.branch = branch;
    this.timeoutMs = timeoutMs;
    this.lastResult = null;
    this.log = !injectedLogger ? log
      : typeof injectedLogger.child === 'function' ? injectedLogger.child('github')
        : injectedLogger;
  }

  /** UI-safe status: presence only, never the secret. */
  describe() {
    return {
      enabled: githubEnabled(this.#store()),
      hasToken: Boolean(githubToken(this.#store())),
      owner: readOwner(this.#store()),
      apiBase: this.baseUrl,
      defaultBranch: this.branch,
    };
  }

  #store() {
    return this.settings || this.repo;
  }

  /**
   * validate → ensure private repo → prepare workspace → set remote → push.
   *
   * @param {{project?: {name?: string, workspace_path?: string, workspacePath?: string},
   *          name?: string, workspacePath?: string, cwd?: string, owner?: string,
   *          token?: string, settings?: unknown, enabledOverride?: boolean,
   *          branch?: string, git?: GitExec, files?: WorkspaceFiles|null,
   *          fetchImpl?: typeof globalThis.fetch, validateOnly?: boolean,
   *          identity?: {name?: string, email?: string}, message?: string}} [context]
   * @returns {Promise<{ok: boolean, stage: string, fullName: string, htmlUrl: string,
   *            reason: string, at: string, username: string, branch: string, created: boolean}>}
   */
  async publish(context = {}) {
    const store = context.settings || this.#store();
    const token = String(context.token || '') || githubToken(store);
    const secrets = token ? [token] : [];
    const outcome = {
      ok: false,
      stage: PUBLISH_STAGES.DISABLED,
      fullName: '',
      htmlUrl: '',
      reason: '',
      at: nowIso(),
      username: '',
      branch: '',
      created: false,
    };
    const finish = (patch) => this.#finish({ ...outcome, ...patch }, secrets);

    try {
      const primary = context.enabledOverride !== undefined ? context.enabledOverride : readSetting(store, SETTINGS_KEYS.enabled);
      const alias = readSetting(store, SETTINGS_KEYS.publishOnImport);
      const toggle = primary === null || primary === undefined ? alias : primary;
      // A token handed over explicitly (a "publish now" click) is itself the opt-in; the
      // stored toggle alone decides for the automatic import path.
      if (!isToggleOn(toggle) && !context.token) {
        return finish({ stage: PUBLISH_STAGES.DISABLED, reason: 'GitHub 自动发布未开启（设置中的 github.enabled 为关），项目仅保存在本地。' });
      }
      if (!token) {
        return finish({ stage: PUBLISH_STAGES.NO_TOKEN, reason: '已开启 GitHub 自动发布，但没有找到可用的访问令牌，请在设置中重新粘贴令牌。' });
      }

      const fetchImpl = context.fetchImpl || this.fetchImpl;
      const project = context.project || {};
      const rawName = context.name || project.name || project.displayName || '';
      const repoName = sanitizeRepoName(rawName);
      const cwd = String(context.workspacePath || context.cwd || project.workspace_path || project.workspacePath || '').trim();

      const checked = await validateToken({ fetchImpl, token, baseUrl: this.baseUrl });
      if (!checked.ok) return finish({ stage: PUBLISH_STAGES.FAILED, reason: `令牌校验未通过：${checked.reason}` });
      outcome.username = checked.username;
      const owner = readOwner(store, context.owner || checked.username);

      if (context.validateOnly) {
        return finish({ ok: true, stage: PUBLISH_STAGES.VALIDATED, reason: '令牌校验通过，GitHub 账号可用。' });
      }

      const repoResult = await ensurePrivateRepo({ fetchImpl, owner, name: repoName, token, baseUrl: this.baseUrl });
      if (!repoResult.ok) return finish({ stage: PUBLISH_STAGES.FAILED, reason: `创建私有仓库失败：${repoResult.reason}` });
      outcome.fullName = repoResult.fullName;
      outcome.htmlUrl = repoResult.htmlUrl;
      outcome.created = repoResult.created;
      outcome.stage = repoResult.created ? PUBLISH_STAGES.REPO_CREATED : PUBLISH_STAGES.REPO_EXISTS;

      const remoteUrl = plainRemoteUrl({ fullName: repoResult.fullName, htmlUrl: repoResult.htmlUrl, owner, name: repoName });
      if (!isCredentialFreeUrl(remoteUrl)) {
        return finish({ stage: PUBLISH_STAGES.FAILED, reason: '生成的仓库地址不是可信的 HTTPS 地址，已中止推送以避免凭据外泄。' });
      }

      const git = context.git || this.git;
      const files = context.files !== undefined ? context.files : this.files;
      const branch = String(context.branch || this.branch || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;

      if (!git) return finish({ stage: PUBLISH_STAGES.FAILED, reason: '未注入 git 执行器，无法准备本地仓库并推送。' });
      if (!cwd) return finish({ stage: PUBLISH_STAGES.FAILED, reason: '缺少项目路径，无法准备本地仓库。' });

      const prepared = await prepareRepository({ git, cwd, branch, files, identity: context.identity, message: context.message, secrets, timeoutMs: this.timeoutMs });
      if (!prepared.ok) return finish({ stage: PUBLISH_STAGES.FAILED, reason: `准备本地仓库失败：${prepared.reason}` });
      outcome.branch = prepared.branch;
      outcome.stage = PUBLISH_STAGES.COMMITTED;

      const remote = await ensureOriginRemote({ git, cwd, url: remoteUrl, secrets, timeoutMs: this.timeoutMs });
      if (!remote.ok) return finish({ stage: PUBLISH_STAGES.FAILED, reason: `配置 origin 远端失败：${remote.reason}` });

      const pushed = await pushBranch({ git, cwd, branch: prepared.branch, token, secrets, timeoutMs: this.timeoutMs });
      if (!pushed.ok) return finish({ stage: PUBLISH_STAGES.FAILED, reason: pushed.reason });

      this.log.info('published', { fullName: repoResult.fullName, branch: prepared.branch, created: repoResult.created, stage: PUBLISH_STAGES.PUSHED });
      return finish({ ok: true, stage: PUBLISH_STAGES.PUSHED, reason: '' });
    } catch (err) {
      // Publishing must never throw: the UI renders `reason` verbatim.
      const message = redact((err && err.message) || '未知异常', secrets);
      this.log.error('publish_crashed', { message });
      return finish({ stage: PUBLISH_STAGES.FAILED, reason: `发布过程出现异常：${message}` });
    }
  }

  /** Last line of defence: every string in a result is scrubbed before it leaves. */
  #finish(merged, secrets) {
    const result = { ...merged, at: merged.at || nowIso() };
    for (const key of ['reason', 'fullName', 'htmlUrl', 'username', 'branch']) {
      result[key] = String(result[key] || '').length ? redact(result[key], secrets) : '';
    }
    this.lastResult = result;
    return result;
  }
}

/**
 * `git remote get-url|set-url|add origin <plain-url>`.
 * The URL never carries credentials, so the token cannot reach `.git/config`.
 */
export async function ensureOriginRemote({ git = null, cwd = '', url = '', timeoutMs = 30000, secrets = [] } = {}) {
  const result = { ok: false, action: 'none', previous: '', reason: '' };
  if (!git || !cwd) return { ...result, reason: redact('未注入 git 执行器或项目路径，无法配置远端。', secrets) };
  if (!isCredentialFreeUrl(url)) return { ...result, reason: redact('远端地址含凭据或格式非法，已拒绝写入。', secrets) };

  const run = (args, purpose) => execGit(git, { command: 'git', args, cwd, purpose, timeoutMs });
  const current = await run(['remote', 'get-url', 'origin'], 'github publish: read origin');
  if (current.blocked) return { ...result, reason: blockedReason(current) };
  const existing = current.ok ? current.stdout.trim() : '';
  result.previous = existing;

  if (existing && sameRemoteUrl(existing, url)) return { ...result, ok: true, action: 'unchanged' };
  if (existing) {
    const setUrl = await run(['remote', 'set-url', 'origin', url], 'github publish: point origin at the private repo');
    if (setUrl.blocked) return { ...result, reason: blockedReason(setUrl) };
    if (!setUrl.ok) return { ...result, reason: redact(`更新 origin 失败：${summarizeOutput(setUrl.stderr || setUrl.stdout, 300)}`, secrets) };
    return { ...result, ok: true, action: 'updated' };
  }
  const add = await run(['remote', 'add', 'origin', url], 'github publish: add origin');
  if (add.blocked) return { ...result, reason: blockedReason(add) };
  if (!add.ok) {
    // "remote origin already exists" (a remote with no URL): recover by setting its URL.
    const fallback = await run(['remote', 'set-url', 'origin', url], 'github publish: set origin url');
    if (fallback.ok) return { ...result, ok: true, action: 'updated' };
    return { ...result, reason: redact(`添加 origin 失败：${summarizeOutput(add.stderr || add.stdout, 300)}`, secrets) };
  }
  return { ...result, ok: true, action: 'added' };
}

function sameRemoteUrl(a, b) {
  const norm = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return Boolean(a) && norm(a) === norm(b);
}

/** Push with env-based authentication. Never force, never rewrite history. */
export async function pushBranch({ git = null, cwd = '', branch = DEFAULT_BRANCH, token = '', timeoutMs = 120000, secrets = [] } = {}) {
  if (!git || !cwd) return { ok: false, reason: redact('未注入 git 执行器或项目路径，无法推送。', secrets) };
  if (!token) return { ok: false, reason: redact('缺少访问令牌，无法推送。', secrets) };
  const target = String(branch || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  let res;
  try {
    res = await execGit(git, {
      command: 'git',
      args: ['push', '--set-upstream', 'origin', target],
      cwd,
      purpose: 'github publish: push',
      timeoutMs,
      // The token travels here and ONLY here — env, not argv, not repository config.
      env: { ...gitAuthEnv(token), GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    return { ok: false, reason: redact(`推送时 git 执行失败：${(err && err.message) || '未知错误'}`, secrets) };
  }
  if (res.blocked) return { ok: false, reason: blockedReason(res) };
  if (res.timedOut) return { ok: false, reason: '推送超时：网络较慢或仓库体积较大，请稍后重试。' };
  if (!res.ok) {
    const combined = `${res.stderr || ''} ${res.stdout || ''}`;
    if (/authentication failed|permission denied|invalid (credentials|username or password)|could not read username|terminal prompts disabled/i.test(combined)) {
      return { ok: false, reason: 'GitHub 拒绝了推送：令牌权限不足，或命令执行器没有把认证环境变量传给 git（需要支持每次调用的 env）。' };
    }
    if (/rejected|non-fast-forward|fetch first/i.test(combined)) {
      return { ok: false, reason: '远端分支已存在且不接受本次推送（历史不同步）。为避免覆盖远端提交，未执行强制推送。' };
    }
    if (/unable to access|could not resolve host|connection/i.test(combined)) {
      return { ok: false, reason: `无法连接 GitHub：${redact(summarizeOutput(combined, 300), secrets)}` };
    }
    return { ok: false, reason: redact(`推送失败：${summarizeOutput(combined, 400)}`, secrets) };
  }
  return { ok: true, reason: '' };
}

/**
 * One-shot convenience used by the import pipeline: `ctx` is both the dependency bag and the
 * publish context, so callers do not have to construct the class themselves.
 *
 * @param {object} ctx
 * @returns {Promise<object>} always resolves to a serialisable, token-free result
 */
export async function publishProject(ctx = {}) {
  const publisher = new GitHubPublisher(ctx);
  return publisher.publish(ctx);
}
