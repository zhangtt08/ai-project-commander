/**
 * Read-only GitHub browsing — "根据 GitHub 上我的仓库读取我的项目".
 *
 * Everything here goes through the GitHub REST API over HTTPS. Nothing is cloned, written to
 * disk, or stored in the database: the point is to look at a repository without downloading it.
 * The token travels only in an Authorization header and is scrubbed from every returned string.
 */
import { GITHUB_API_BASE, basicAuthHeader, githubToken, redact } from './github-publisher.js';

const PER_PAGE = 100;
const MAX_PAGES = 5;
const README_BYTES = 20000;
const TREE_ENTRIES = 150;

async function ghFetch({ fetchImpl = globalThis.fetch, path, token, timeoutMs = 15000, accept = 'application/vnd.github+json' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        authorization: basicAuthHeader(token),
        accept,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ai-project-commander',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err) {
    return { status: 0, ok: false, json: null, text: '', transportError: redact(err && err.message, [token]) };
  } finally {
    clearTimeout(timer);
  }
}

function mapRepo(r) {
  return {
    name: String(r.name || ''),
    fullName: String(r.full_name || r.name || ''),
    private: !!r.private,
    visibility: r.private ? '私有' : (r.visibility === 'internal' ? '内部' : '公开'),
    fork: !!r.fork,
    archived: !!r.archived,
    description: String(r.description || ''),
    language: String(r.language || ''),
    defaultBranch: String(r.default_branch || ''),
    sizeKb: Number(r.size) || 0,
    pushedAt: r.pushed_at || null,
    createdAt: r.created_at || null,
    htmlUrl: String(r.html_url || ''),
    license: r && r.license && r.license.spdx_id ? String(r.license.spdx_id) : '',
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 8) : [],
  };
}

function refuse(token, reason) {
  return { ok: false, reason, tokenPresent: !!token };
}

/**
 * List the account's own repositories. `search` filters locally on name + description so a
 * partial keyword is enough, and the result is capped rather than silently truncated.
 */
export async function listRemoteRepos({ settings = null, fetchImpl = globalThis.fetch, search = '', limit = 200, timeoutMs = 15000 } = {}) {
  const token = githubToken(settings || {});
  if (!token) return refuse('', '尚未保存 GitHub 令牌，无法读取你的仓库。');

  const repos = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await ghFetch({ fetchImpl, token, timeoutMs, path: `/user/repos?affiliation=owner&per_page=${PER_PAGE}&page=${page}&sort=pushed` });
    if (!res.ok) {
      const detail = res.json && res.json.message ? `：${redact(res.json.message, [token])}` : (res.transportError ? `：${res.transportError}` : '');
      return { ...refuse(token, `GitHub 没有返回仓库列表（${res.status || '网络'}）${detail}`), repos: [] };
    }
    const batch = Array.isArray(res.json) ? res.json : [];
    repos.push(...batch.map(mapRepo));
    if (batch.length < PER_PAGE) break;
    if (repos.length >= limit) { truncated = true; break; }
    if (page === MAX_PAGES) truncated = true;
  }

  const needle = String(search || '').trim().toLowerCase();
  const filtered = needle
    ? repos.filter((r) => `${r.name} ${r.description} ${r.language} ${r.topics.join(' ')}`.toLowerCase().includes(needle))
    : repos;
  return {
    ok: true,
    repos: filtered.slice(0, limit),
    total: repos.length,
    truncated,
    privateCount: repos.filter((r) => r.private).length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * One repository, assembled from four read endpoints: detail, languages, README and the root
 * listing. Each part degrades on its own so a 202 ("README being generated") or a missing
 * licence never hides the rest.
 */
export async function readRemoteRepo({ settings = null, fullName = '', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const token = githubToken(settings || {});
  const name = String(fullName || '').trim().replace(/^\/+|\/+$/g, '');
  if (!token) return refuse('', '尚未保存 GitHub 令牌，无法读取你的仓库。');
  if (!name || !/^[\w.-]+\/[\w.-]+$/.test(name)) return refuse(token, '仓库名要写成 owner/repo 的形式。');

  const detail = await ghFetch({ fetchImpl, token, timeoutMs, path: `/repos/${name}` });
  if (!detail.ok) {
    const why = detail.status === 404 ? '仓库不存在，或这个令牌读不到它' : `GitHub 返回 ${detail.status || '网络错误'}`;
    const message = detail.json && detail.json.message ? `（${redact(detail.json.message, [token])}）` : '';
    return { ...refuse(token, `${why}${message}`), fullName: name };
  }

  const [langs, readme, tree] = await Promise.all([
    ghFetch({ fetchImpl, token, timeoutMs, path: `/repos/${name}/languages` }),
    ghFetch({ fetchImpl, token, timeoutMs, accept: 'application/vnd.github.raw+json', path: `/repos/${name}/readme` }),
    ghFetch({ fetchImpl, token, timeoutMs, path: `/repos/${name}/contents` }),
  ]);

  const totalBytes = langs.ok && langs.json
    ? Object.values(langs.json).reduce((a, b) => a + (Number(b) || 0), 0) || 1
    : 0;
  const languages = langs.ok && langs.json
    ? Object.entries(langs.json)
      .map(([language, bytes]) => ({ language, bytes: Number(bytes) || 0, percent: Math.round(((Number(bytes) || 0) / totalBytes) * 1000) / 10 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10)
    : [];

  const raw = readme.ok ? String(readme.text || '') : '';
  const readmeText = Buffer.byteLength(raw, 'utf8') > README_BYTES ? `${raw.slice(0, README_BYTES)}\n\n…（已截断，完整内容请在 GitHub 上查看）` : raw;

  const entries = tree.ok && Array.isArray(tree.json)
    ? tree.json.slice(0, TREE_ENTRIES).map((e) => ({ name: String(e.name || ''), type: String(e.type || ''), size: Number(e.size) || 0, path: String(e.path || '') }))
    : [];

  return {
    ok: true,
    repo: mapRepo(detail.json),
    languages,
    readme: { available: !!readmeText, truncated: readmeText.includes('已截断'), text: readmeText, note: readme.ok ? '' : `README 读取失败（${readme.status || '网络'}）` },
    tree: { entries, truncated: Array.isArray(tree.json) && tree.json.length > TREE_ENTRIES },
    partial: { languages: langs.ok, readme: readme.ok, tree: tree.ok },
    fetchedAt: new Date().toISOString(),
  };
}
