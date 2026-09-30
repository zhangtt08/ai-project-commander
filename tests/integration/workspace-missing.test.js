/**
 * A workspace can be moved or deleted outside Commander. The panel must then say so instead of
 * replaying cached verdicts as if they were current, and the user must be able to repoint the
 * record at the new folder without re-importing it.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { App } from '../../src/core/app.js';
import { buildRouter } from '../../src/server/routes.js';
import { createHttpServer } from '../../src/server/http-server.js';
import { expandShortPath } from '../../src/core/fs-safe.js';
import { toPosix } from '../../src/core/util.js';
import { makeTempDir, removeTempDir } from '../helpers/tmp.js';

const OPEN = [];
after(() => {
  for (const app of OPEN) {
    try { app.queue.stop(); } catch { /* noop */ }
    try { app.close(); } catch { /* already closed */ }
  }
  OPEN.length = 0;
});

/** Commander normalises paths on write; comparisons have to use the same shape. */
function stored(p) { return toPosix(expandShortPath(path.resolve(p))); }

/** A project carrying a full set of cached verdicts, so staleness is unmistakable. */
function withCachedVerdicts() {
  const app = new App({ dataDir: makeTempDir('apc-gone-data-'), dbFile: ':memory:', logLevel: 'error' });
  OPEN.push(app);
  const dir = makeTempDir('apc-gone-proj-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gone', version: '1.0.0', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'export default 1;\n');
  const project = app.addProject({ workspacePath: dir, name: '一键上传' });
  app.repo.update('projects', project.id, {
    last_analyzed_at: '2026-09-24T14:48:36.577Z',
    health: 'warning',
    metadata: {
      classification: { category: 'web-app', label: 'Web 应用', confidence: 'high', reasons: [{ text: '依赖里有 react', weight: 3 }], manual: false },
      purpose: { purpose: '展示作品集', declared: false, summary: '结构推断', evidence: [] },
      suggestions: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: `建议 ${i}`, why: 'w', action: 'a', evidence: 'e', impact: 'medium', effort: 'low', area: '质量' })),
      suggestionSummary: { count: 9, counts: { critical: 0, high: 2, medium: 5, low: 2 }, top: ['建议 0'] },
      git: { isRepository: true, branch: 'main', workingTreeClean: false, changedFileCount: 30, untracked: Array.from({ length: 20 }, (_, i) => `f${i}.js`) },
    },
  });
  return { app, dir, id: project.id };
}

/** Release the watcher first — on Windows a live handle can keep the folder undeletable. */
function vanish({ app, id, dir }) {
  app.watcher.unwatch(id);
  assert.equal(removeTempDir(dir), true, `fixture folder should be deletable: ${dir}`);
  assert.equal(fs.existsSync(dir), false);
}

describe('a workspace that disappeared', () => {
  test('the card hides cached classification, purpose and advice', () => {
    const fix = withCachedVerdicts();
    vanish(fix);
    const card = fix.app.projectCard(fix.app.getProject(fix.id));
    assert.equal(card.workspaceMissing, true);
    assert.equal(card.classification, null);
    assert.equal(card.purpose, null);
    assert.equal(card.suggestionSummary, null);
    assert.equal(card.suggestionCount, 1);
    assert.equal(card.health, 'unknown', 'the warning verdict came from files that are gone');
  });

  test('suggestions report the missing folder as the only item, with real evidence', () => {
    const fix = withCachedVerdicts();
    // Snapshot the path while the folder still exists: expandShortPath needs a real path,
    // and the record is what Commander has to quote.
    const quoted = fix.app.getProject(fix.id).workspace_path;
    vanish(fix);
    const view = fix.app.suggestionsView(fix.app.getProject(fix.id));
    assert.equal(view.workspaceMissing, true);
    assert.equal(view.suggestions.length, 1);
    const [only] = view.suggestions;
    assert.equal(only.id, 'workspace-missing');
    assert.ok(only.evidence.includes(quoted), `evidence should quote the path: ${only.evidence}`);
    assert.ok(only.evidence.includes('2026-09-24T14:48:36.577Z'), 'evidence quotes the real analysis time');
    assert.equal(view.generatedAt, null);
    assert.equal(view.summary, null);
  });

  test('attention lists one critical entry and drops everything that needed to read the folder', () => {
    const fix = withCachedVerdicts();
    assert.ok(fix.app.attentionCenter().items.some((i) => i.projectId === fix.id && i.kind === 'dirty_workspace'), 'while readable, 50 uncommitted files are reported');
    vanish(fix);
    const items = fix.app.attentionCenter().items.filter((i) => i.projectId === fix.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'workspace_missing');
    assert.equal(items[0].severity, 'critical');
    assert.equal(items[0].at, '2026-09-24T14:48:36.577Z');
    assert.match(items[0].detail, /不代表磁盘现状/);
  });

  test('dashboard counts it as critical instead of its old health', () => {
    const fix = withCachedVerdicts();
    assert.equal(fix.app.dashboard().counts.warning, 1);
    vanish(fix);
    const { counts, cards } = fix.app.dashboard();
    assert.equal(counts.total, 1);
    assert.equal(counts.warning, 0);
    assert.equal(counts.critical, 1);
    assert.equal(counts.missing, 1);
    assert.equal(cards[0].workspaceMissing, true);
  });

  test('a scan of a vanished folder fails and rewrites nothing', async () => {
    const app = new App({ dataDir: makeTempDir('apc-gonescan-data-'), dbFile: ':memory:', logLevel: 'error' });
    OPEN.push(app);
    const dir = makeTempDir('apc-gonescan-proj-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gs', version: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'index.js'), 'export default 1;\n');
    const project = app.addProject({ workspacePath: dir });
    await app.orchestrator.quickScan(project.id);
    const analysed = app.getProject(project.id);
    assert.ok(analysed.last_analyzed_at, 'a real scan stamps an analysis time');
    assert.ok(analysed.metadata.classification, 'and produces a classification');

    app.watcher.unwatch(project.id);
    assert.equal(removeTempDir(dir), true);
    await assert.rejects(() => app.orchestrator.quickScan(project.id), /workspace scan failed: workspace_not_found/);

    const after = app.getProject(project.id);
    assert.equal(after.last_analyzed_at, analysed.last_analyzed_at, 'the failed scan must not claim a fresh analysis');
    assert.deepEqual(after.metadata.classification, analysed.metadata.classification, 'no verdict rewritten out of nothing');
    assert.equal(app.projectCard(after).workspaceMissing, true);
  });

  test('a project whose folder is present keeps every cached verdict', () => {    const fix = withCachedVerdicts();
    const view = fix.app.suggestionsView(fix.app.getProject(fix.id));
    assert.equal(view.workspaceMissing, false);
    assert.equal(view.suggestions.length, 9);
    assert.equal(fix.app.projectCard(fix.app.getProject(fix.id)).classification.category, 'web-app');
    assert.equal(fix.app.dashboard().counts.missing, 0);
  });
});

describe('repointing a moved project', () => {
  test('a new path replaces the record and clears the stale verdicts', () => {
    const fix = withCachedVerdicts();
    vanish(fix);
    const moved = makeTempDir('apc-gone-moved-');
    fs.writeFileSync(path.join(moved, 'package.json'), JSON.stringify({ name: 'moved', version: '1.0.0' }));
    fs.mkdirSync(path.join(moved, '.git'));
    const updated = fix.app.setWorkspacePath(fix.id, moved);
    assert.equal(updated.workspace_path, stored(moved));
    assert.equal(updated.repository_type, 'git');
    assert.equal(updated.health, 'unknown');
    assert.equal(updated.last_analyzed_at, null);
    assert.deepEqual(updated.metadata, {});
    const card = fix.app.projectCard(fix.app.getProject(fix.id));
    assert.equal(card.workspaceMissing, false);
    assert.equal(card.suggestionCount, 0);
    assert.equal(fix.app.watcher.watchers.has(fix.id), true, 'watching re-armed on the new folder');
  });

  test('an automatic category is forgotten, a manual one survives the move', () => {
    const fix = withCachedVerdicts();
    fix.app.repo.update('projects', fix.id, { category: 'web-app', category_manual: 0 });
    fix.app.setWorkspacePath(fix.id, makeTempDir('apc-move-auto-'));
    assert.equal(fix.app.getProject(fix.id).category, 'uncategorized', 'inference described the old folder');
    fix.app.setCategory(fix.id, 'desktop-app');
    fix.app.setWorkspacePath(fix.id, makeTempDir('apc-move-manual-'));
    assert.equal(fix.app.getProject(fix.id).category, 'desktop-app');
    assert.equal(fix.app.getProject(fix.id).category_manual, 1);
  });

  test('a path that does not exist is refused and the record keeps the old one', () => {
    const fix = withCachedVerdicts();
    const before = fix.app.getProject(fix.id).workspace_path;
    assert.throws(() => fix.app.setWorkspacePath(fix.id, path.join(fix.dir, 'no-such-folder')), /目录不存在/);
    assert.equal(fix.app.getProject(fix.id).workspace_path, before);
    assert.equal(fix.app.getProject(fix.id).health, 'warning', 'the refused attempt changed nothing');
  });

  test('a file instead of a folder is refused', () => {
    const fix = withCachedVerdicts();
    const file = path.join(fix.dir, 'index.js');
    assert.throws(() => fix.app.setWorkspacePath(fix.id, file), /不是目录/);
  });

  test('a path another project already owns is refused', () => {
    const fix = withCachedVerdicts();
    const other = fix.app.addProject({ workspacePath: makeTempDir('apc-other-proj-'), name: 'other' });
    assert.throws(() => fix.app.setWorkspacePath(other.id, fix.dir), /已经由/);
  });

  test('backslashes and a trailing slash are accepted as the same folder', () => {
    const fix = withCachedVerdicts();
    const moved = makeTempDir('apc-move-slashes-');
    const updated = fix.app.setWorkspacePath(fix.id, `${moved}\\`);
    assert.equal(updated.workspace_path, stored(moved));
  });
});

describe('the missing workspace over HTTP', () => {
  function request(baseUrl, method, p, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}${p}`, { method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  test('read endpoints report it and PATCH relinks it', async () => {
    const fix = withCachedVerdicts();
    const server = createHttpServer({ router: buildRouter(fix.app), app: fix.app });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const get = (method, p, body) => request(baseUrl, method, p, body);
    vanish(fix);

    const sug = await get('GET', `/api/projects/${fix.id}/suggestions`);
    assert.equal(sug.status, 200);
    assert.equal(sug.json.data.workspaceMissing, true);
    assert.equal(sug.json.data.suggestions.length, 1);
    assert.equal(sug.json.data.purpose, null);

    const detail = await get('GET', `/api/projects/${fix.id}/detail`);
    assert.equal(detail.json.data.workspaceMissing, true);
    assert.equal(detail.json.data.suggestions.length, 1);
    assert.equal(detail.json.data.project.workspaceMissing, true);

    const dash = await get('GET', '/api/dashboard');
    assert.equal(dash.json.data.counts.missing, 1);
    assert.equal(dash.json.data.cards[0].workspaceMissing, true);

    const moved = makeTempDir('apc-http-moved-');
    fs.writeFileSync(path.join(moved, 'package.json'), JSON.stringify({ name: 'moved', version: '1.0.0' }));
    const patch = await get('PATCH', `/api/projects/${fix.id}`, { workspacePath: moved });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.data.workspaceMissing, false);
    assert.equal(patch.json.data.workspacePath, stored(moved));

    const bad = await get('PATCH', `/api/projects/${fix.id}`, { workspacePath: `${moved}/ghost` });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error.message, /目录不存在/);
    assert.equal(fix.app.getProject(fix.id).workspace_path, stored(moved), 'the refused PATCH left the good path in place');

    await new Promise((resolve) => server.close(resolve));
  });
});
