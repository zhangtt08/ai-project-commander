/**
 * The read-only GitHub browser must never write anything, never leak the token, and must degrade
 * per endpoint instead of failing the whole panel. All of that is exercised against a fake fetch.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listRemoteRepos, readRemoteRepo } from '../../src/core/github-remote.js';

const TOKEN = 'gho_secrettokenvalue1234567890abcdefghij';
const settings = { 'github.token': TOKEN, 'github.enabled': 'true', 'github.owner': 'ztt' };

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    for (const [pattern, res] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
        return { ok: res.ok ?? true, status: res.status ?? 200, text: async () => body };
      }
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) };
  };
  impl.calls = calls;
  return impl;
}

describe('listRemoteRepos', () => {
  test('without a token it refuses instead of calling GitHub', async () => {
    const fetchImpl = fakeFetch({});
    const out = await listRemoteRepos({ settings: {}, fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.reason, /尚未保存 GitHub 令牌/);
    assert.equal(fetchImpl.calls.length, 0, 'no network call may be made');
  });

  test('maps the fields the panel shows and keeps the token out of the payload', async () => {
    const fetchImpl = fakeFetch({
      '/user/repos': { body: [
        { name: 'alpha', full_name: 'ztt/alpha', private: true, description: 'A thing', language: 'TypeScript', default_branch: 'main', size: 2048, pushed_at: '2026-09-28T10:00:00Z', html_url: 'https://github.com/ztt/alpha', topics: ['x'] },
        { name: 'beta', full_name: 'ztt/beta', private: false, description: '', language: null, default_branch: 'master', size: 0, pushed_at: null, html_url: 'https://github.com/ztt/beta' },
      ] },
    });
    const out = await listRemoteRepos({ settings, fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.total, 2);
    assert.equal(out.privateCount, 1);
    assert.deepEqual(out.repos[0], {
      name: 'alpha', fullName: 'ztt/alpha', private: true, visibility: '私有', fork: false, archived: false,
      description: 'A thing', language: 'TypeScript', defaultBranch: 'main', sizeKb: 2048,
      pushedAt: '2026-09-28T10:00:00Z', createdAt: null, htmlUrl: 'https://github.com/ztt/alpha', license: '', topics: ['x'],
    });
    assert.equal(out.repos[1].visibility, '公开');
    assert.ok(!JSON.stringify(out).includes(TOKEN), 'the token must never appear in the result');
    assert.equal(fetchImpl.calls[0].headers.authorization, `Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`);
  });

  test('filters locally on name, description, language or topic', async () => {
    const fetchImpl = fakeFetch({
      '/user/repos': { body: [
        { name: 'downloader', full_name: 'ztt/downloader', private: true, description: '视频下载', language: 'JavaScript', size: 1, topics: [] },
        { name: 'other', full_name: 'ztt/other', private: true, description: '', language: 'Rust', size: 1, topics: ['downloader'] },
      ] },
    });
    const out = await listRemoteRepos({ settings, fetchImpl, search: 'downloader' });
    assert.equal(out.repos.length, 2, 'both the name and the topic match');
    const byLang = await listRemoteRepos({ settings, fetchImpl: fakeFetch({ '/user/repos': { body: [{ name: 'a', full_name: 'ztt/a', language: 'Rust', size: 1 }] } }), search: 'rust' });
    assert.equal(byLang.repos.length, 1);
    const none = await listRemoteRepos({ settings, fetchImpl, search: 'zzz-nothing' });
    assert.equal(none.repos.length, 0);
    assert.equal(none.ok, true, 'an empty filter is a success, not an error');
  });

  test('surfaces a GitHub error as a readable reason without echoing the token', async () => {
    const fetchImpl = fakeFetch({ '/user/repos': { ok: false, status: 401, body: { message: `Bad credentials for ${TOKEN}` } } });
    const out = await listRemoteRepos({ settings, fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.reason, /401/);
    assert.ok(!out.reason.includes(TOKEN), 'the reason must be scrubbed');
    assert.equal(out.tokenPresent, true);
  });

  test('a transport failure reports 网络 instead of throwing', async () => {
    const fetchImpl = async () => { throw new Error('socket hang up'); };
    const out = await listRemoteRepos({ settings, fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.reason, /网络/);
  });
});

describe('readRemoteRepo', () => {
  // The module asks for `application/vnd.github.raw+json`, so README arrives as plain text.
  const readmeText = '# Alpha\n\nReal readme text.\n';
  const routes = {
    '/repos/ztt/alpha/languages': { body: { TypeScript: 7000, JavaScript: 3000 } },
    '/repos/ztt/alpha/readme': { body: readmeText },
    '/repos/ztt/alpha/contents': { body: [{ name: 'src', type: 'dir', size: 0, path: 'src' }, { name: 'package.json', type: 'file', size: 412, path: 'package.json' }] },
    '/repos/ztt/alpha': { body: { name: 'alpha', full_name: 'ztt/alpha', private: true, size: 12, default_branch: 'main', html_url: 'https://github.com/ztt/alpha', language: 'TypeScript', license: { spdx_id: 'MIT' } } },
  };

  test('assembles detail, languages, readme and root listing from four reads', async () => {
    const fetchImpl = fakeFetch(routes);
    const out = await readRemoteRepo({ settings, fullName: 'ztt/alpha', fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.repo.private, true);
    assert.equal(out.repo.license, 'MIT');
    assert.deepEqual(out.languages.map((l) => l.language), ['TypeScript', 'JavaScript']);
    assert.equal(out.languages[0].percent, 70);
    assert.equal(out.readme.text.includes('Real readme text.'), true, 'raw README text is passed through');
    assert.equal(out.tree.entries.length, 2);
    assert.deepEqual(out.partial, { languages: true, readme: true, tree: true });
    assert.ok(!JSON.stringify(out).includes(TOKEN));
  });

  test('an unreadable README degrades alone and says so', async () => {
    const out = await readRemoteRepo({
      settings,
      fullName: 'ztt/alpha',
      fetchImpl: fakeFetch({ ...routes, '/repos/ztt/alpha/readme': { ok: false, status: 403, body: { message: 'reserved' } } }),
    });
    assert.equal(out.ok, true);
    assert.equal(out.readme.available, false);
    assert.match(out.readme.note, /403/);
    assert.equal(out.partial.readme, false);
    assert.equal(out.repo.private, true, 'the rest of the panel still loads');
  });

  test('a missing repository is a readable refusal, not a crash', async () => {
    const out = await readRemoteRepo({ settings, fullName: 'ztt/nope', fetchImpl: fakeFetch({}) });
    assert.equal(out.ok, false);
    assert.match(out.reason, /不存在|404/);
  });

  test('rejects a name that is not owner/repo before touching the network', async () => {
    const fetchImpl = fakeFetch({});
    const out = await readRemoteRepo({ settings, fullName: 'just-a-name', fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.reason, /owner\/repo/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('truncates a huge README rather than shipping it whole', async () => {
    const big = 'x'.repeat(60000);
    const out = await readRemoteRepo({ settings, fullName: 'ztt/alpha', fetchImpl: fakeFetch({ ...routes, '/repos/ztt/alpha/readme': { body: big } }) });
    assert.equal(out.readme.truncated, true);
    assert.ok(out.readme.text.length < 21000);
  });
});
