/**
 * The attention list shows an age per row, so each item must carry the timestamp of the
 * record that produced it — not `Date.now()`, which would make everything look fresh.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../../src/core/app.js';
import { makeTempDir } from '../helpers/tmp.js';

const OPEN = [];

// addProject arms an fs.watch; only app.close() releases it, or the process outlives its own pass.
after(() => { for (const app of OPEN) { try { app.queue.stop(); } catch {}
  try { app.close(); } catch {} } OPEN.length = 0; });

const RUN_TS = '2026-01-05T08:12:00.000Z';
const RISK_TS = '2026-01-04T10:00:00.000Z';
const REG_TS = '2026-01-03T09:00:00.000Z';

function appWithAttention() {
  const app = new App({ dataDir: makeTempDir('apc-attn-'), dbFile: ':memory:', logLevel: 'error' });
  OPEN.push(app);
  const p = app.addProject({ workspacePath: makeTempDir('apc-attn-proj-'), name: 'Demo' });
  app.repo.update('projects', p.id, {
    health: 'critical',
    last_analyzed_at: '2026-01-06T00:00:00.000Z',
    metadata: {
      metadata: { ok: true, fileCount: 5 },
      health: { status: 'critical', ts: '2026-01-06T00:00:00.000Z', reasons: [{ message: 'gate failed' }] },
      tests: { unit: { status: 'fail', total: 10, passed: 7, failed: 3, command: 'npx vitest run', ts: RUN_TS } },
      build: { status: 'fail', command: 'npm run build', ts: '2026-01-02T00:00:00.000Z' },
      drift: null,
    },
  });
  app.repo.insert('risks', { project_id: p.id, code: 'SENSITIVE_FILE', severity: 'high', status: 'open', title: 'secret in repo', created_at: RISK_TS });
  app.repo.insert('regressions', { project_id: p.id, type: 'unit_failed', severity: 'high', ts: REG_TS, acknowledged: 0, before: {}, after: {} });
  return { app, projectId: p.id };
}

describe('attentionCenter timestamps are sourced, not invented', () => {
  test('every item carries a valid ISO observation time', () => {
    const { app } = appWithAttention();
    const { items } = app.attentionCenter();
    assert.ok(items.length >= 4, `expected several items, got ${items.length}`);
    for (const i of items) {
      assert.ok(typeof i.at === 'string' && i.at.length > 0, `${i.kind} has no timestamp`);
      assert.ok(!Number.isNaN(Date.parse(i.at)), `${i.kind} timestamp is not a date: ${i.at}`);
      assert.ok(Date.parse(i.at) <= Date.now(), `${i.kind} timestamp is in the future`);
    }
  });

  test('a failing test run reports the run time, not the analysis time', () => {
    const { app } = appWithAttention();
    const fail = app.attentionCenter().items.find((i) => i.kind === 'test_fail');
    assert.ok(fail, 'the failing suite must surface');
    assert.equal(fail.at, RUN_TS, 'test_fail must carry the run timestamp');
    assert.equal(fail.projectName, 'Demo');
  });

  test('regression and risk items carry their own record times', () => {
    const { app } = appWithAttention();
    const items = app.attentionCenter().items;
    assert.equal(items.find((i) => i.kind === 'regression').at, REG_TS);
    assert.equal(items.find((i) => i.kind === 'risk').at, RISK_TS);
    assert.equal(items.find((i) => i.kind === 'build_fail').at, '2026-01-02T00:00:00.000Z');
  });

  test('items with no per-record time fall back to when the project was analysed', () => {
    const app = new App({ dataDir: makeTempDir('apc-attn2-'), dbFile: ':memory:', logLevel: 'error' });
    OPEN.push(app);
    const p = app.addProject({ workspacePath: makeTempDir('apc-attn2-proj-'), name: 'NoRun' });
    app.repo.update('projects', p.id, {
      health: 'critical',
      last_analyzed_at: '2026-01-06T00:00:00.000Z',
      metadata: { metadata: { ok: true }, health: { status: 'critical', reasons: [] } },
    });
    const items = app.attentionCenter().items;
    const health = items.find((i) => i.kind === 'critical_health');
    assert.ok(health, 'critical health must surface');
    assert.equal(health.at, '2026-01-06T00:00:00.000Z', 'must fall back to the analysis time');
  });
});
