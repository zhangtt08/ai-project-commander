/**
 * Deleting a project must stay safe when it races the analysis queue — especially now that
 * a delete can also wipe the source directory. These tests force the interleaving
 * deterministically instead of trusting timing.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { App } from '../../src/core/app.js';
import { JOB_TYPE } from '../../src/domain/constants.js';
import { makeTempDir } from '../helpers/tmp.js';

const LINKED = [
  'tasks', 'stages', 'milestones', 'specifications', 'acceptance_criteria', 'risks',
  'regressions', 'health_results', 'project_snapshots', 'git_snapshots', 'build_results',
  'test_runs', 'test_case_results', 'prompts', 'executions', 'agent_sessions',
  'project_memory', 'architecture_decisions', 'artifacts', 'analysis_jobs',
  'evidence_refs', 'project_events', 'issues',
];

const OPEN = [];

function freshApp() {
  const app = new App({ dataDir: makeTempDir('apc-race-data-'), dbFile: ':memory:', logLevel: 'error' });
  OPEN.push(app);
  const dir = makeTempDir('apc-race-proj-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'racey', version: '1.0.0', scripts: {} }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'export default 1;\n');
  return { app, dir };
}

// addProject arms an fs.watch and the queue arms an interval; only app.close() releases
// them, and leaving them open keeps the test process alive after every assertion passes.
after(() => {
  for (const app of OPEN) {
    try { app.queue.stop(); } catch { /* noop */ }
    try { app.close(); } catch { /* already closed */ }
  }
  OPEN.length = 0;
});

function orphans(app, projectId) {
  const found = {};
  for (const table of LINKED) {
    const n = app.repo.count(table, { project_id: projectId });
    if (n > 0) found[table] = n;
  }
  return found;
}

describe('deleting a project while the queue is busy', () => {
  test('a completed analysis leaves no rows behind after the project is deleted', () => {
    const { app, dir } = freshApp();
    const p = app.addProject({ workspacePath: dir });
    return app.orchestrator.fullScan(p.id, { runCommands: false, suites: [] }).then(() => {
      // the scan genuinely produced rows, otherwise this test proves nothing
      const before = LINKED.reduce((a, t) => a + app.repo.count(t, { project_id: p.id }), 0);
      assert.ok(before > 0, 'fullScan should have written rows to clean up');
      app.deleteProject(p.id, { purgeSource: false });
      assert.deepEqual(orphans(app, p.id), {}, 'every project-linked row must cascade away');
    });
  });

  test('a job that writes after its project is gone cannot leave orphans or crash the queue', async () => {
    const { app, dir } = freshApp();
    const p = app.addProject({ workspacePath: dir });

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const observed = { threw: null, wroteEvent: false, wroteTask: false };

    // Replace the real handler with one that blocks, so the delete is guaranteed to land
    // while the job is mid-flight, then writes exactly the way the orchestrator does.
    app.queue.register(JOB_TYPE.QUICK_SCAN, async ({ projectId }) => {
      await gate;
      try {
        app.events.record(projectId, 'note', 'written after the project vanished', {});
        observed.wroteEvent = true;
      } catch (err) { observed.threw = `event: ${err.message}`; }
      try {
        app.repo.insert('tasks', { project_id: projectId, title: 'orphan?', status: 'todo' });
        observed.wroteTask = true;
      } catch (err) { if (!observed.threw) observed.threw = `task: ${err.message}`; }
      return { ok: true };
    });

    app.queue.start(40);
    const job = app.queue.enqueue({ projectId: p.id, type: JOB_TYPE.QUICK_SCAN, payload: { projectId: p.id } });
    // wait until the handler is actually inside the gate
    for (let i = 0; i < 100; i += 1) {
      const row = app.repo.get('analysis_jobs', job.id);
      if (row && row.status === 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal((app.repo.get('analysis_jobs', job.id) || {}).status, 'running', 'job should be mid-flight');

    app.deleteProject(p.id, { purgeSource: false });
    release();
    await app.queue.drain({ timeoutMs: 5000 });
    app.queue.stop();

    assert.deepEqual(orphans(app, p.id), {}, 'a late write must not resurrect rows for a deleted project');
    assert.equal(app.repo.get('projects', p.id), null, 'the project must stay deleted');
    // The queue itself must still be usable afterwards.
    const p2 = app.addProject({ workspacePath: makeTempDir('apc-race-proj2-') });
    assert.ok(p2.id, 'the app must accept new projects after the race');
  });

  test('purging the source directory makes an in-flight scan fail cleanly, not hang', async () => {
    const { app, dir } = freshApp();
    const p = app.addProject({ workspacePath: dir });
    const scan = app.orchestrator.fullScan(p.id, { runCommands: false, suites: [] });
    fs.rmSync(dir, { recursive: true, force: true });
    const result = await scan.catch((err) => ({ crashed: true, message: err.message }));
    // Either it finished against the half-deleted tree or it errored — but it must resolve,
    // and the record must remain readable so the UI can explain what happened.
    assert.ok(result, 'fullScan must settle');
    assert.equal(typeof app.getProject(p.id).id, 'string', 'the project row must survive a vanished folder');
    const rescan = await app.orchestrator.quickScan(p.id).catch(() => null);
    assert.ok(rescan === null || rescan.metadata.ok === false, 'rescanning a missing folder must not claim success');
  });

  test('two projects with identical names are distinguished by path', () => {
    const { app, dir } = freshApp();
    const other = path.join(makeTempDir('apc-twin-'), path.basename(dir));
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'racey', version: '1.0.0' }));
    const a = app.addProject({ workspacePath: dir });
    const b = app.addProject({ workspacePath: other });
    assert.equal(a.name, b.name);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.workspace_path, b.workspace_path);
    assert.equal(app.dashboard().counts.total, 2);
  });
});
