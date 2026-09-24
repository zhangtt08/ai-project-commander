/** API surface. Handlers stay thin: validate → call the container → return data. */
import { Router, requireParam, sendJson } from './http-server.js';
import { ValidationError, NotFoundError } from '../domain/errors.js';
import { JOB_TYPE } from '../domain/constants.js';
import { ManualImportAdapter, MockAgentAdapter, ADAPTER_CATALOGUE } from '../core/agent-sessions.js';
import { analyzeChanges } from '../core/analyzers/change-analyzer.js';
import { detectedCommandSummary, detectAllCommands } from '../core/build-detect.js';
import { parseTestOutput, describeParsers } from '../core/test-parser.js';
import { riskSummary } from '../core/engines/risk.js';
import { regressionSummary } from '../core/engines/regression.js';
import { defaultIgnoreList } from '../core/ignore-engine.js';
import { truncate, toPosix, nowIso } from '../core/util.js';


function needProject(app, id) { return app.getProject(id); }

export function buildRouter(app) {
  const r = new Router();

  // ── Meta ────────────────────────────────────────────────────────────────
  r.get('/api/health', () => ({ ok: true, version: '0.9.0', at: nowIso() }));
  r.get('/api/system', () => app.systemInfo());
  r.get('/api/security', () => app.securityModel());
  r.get('/api/dashboard', () => app.dashboard());
  r.get('/api/attention', () => app.attentionCenter());
  r.get('/api/meta', () => ({
    defaultIgnore: defaultIgnoreList(),
    testParsers: describeParsers(),
    agentAdapters: ADAPTER_CATALOGUE,
    jobTypes: Object.values(JOB_TYPE),
    providers: app.providerRegistry.describe(),
  }));

  r.get('/api/search', ({ query }) => app.search.query(query.q || ''));

  // ── Settings ────────────────────────────────────────────────────────────
  r.get('/api/settings', () => {
    const keys = ['ai.provider', 'ai.baseUrl', 'ai.model', 'ai.timeoutMs', 'watcher.enabled', 'watcher.autoQuickScan', 'scan.maxFiles', 'workspace.searchRoots'];
    const out = {};
    for (const k of keys) {
      const v = app.repo.getSetting(k);
      if (k === 'ai.apiKey') continue;
      out[k] = v === null ? null : v;
    }
    // The key is reported only as present/absent — never returned.
    out['ai.apiKey'] = app.repo.getSetting('ai.apiKey') ? '__stored__' : null;
    out.providers = app.providerRegistry.describe();
    out.aiStats = app.structured.describeStats();
    return out;
  });

  r.patch('/api/settings', ({ body }) => {
    const allowed = ['ai.provider', 'ai.baseUrl', 'ai.model', 'ai.timeoutMs', 'watcher.enabled', 'watcher.autoQuickScan', 'scan.maxFiles', 'workspace.searchRoots'];
    const patch = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = String(body[k]);
    if (body['ai.apiKey'] && body['ai.apiKey'] !== '__stored__') patch['ai.apiKey'] = String(body['ai.apiKey']);
    const described = app.updateProviderSettings(patch);
    if (patch['watcher.autoQuickScan'] !== undefined) app.watcher.autoQuickScan = patch['watcher.autoQuickScan'] === 'true';
    return { providers: described, aiStats: app.structured.describeStats() };
  });

  // ── Workspace resolution (drag & drop import) ──────────────────────────
  r.post('/api/workspaces/resolve', async ({ body }) => {
    const folderName = requireParam(body, 'folderName', { maxLength: 200 });
    let roots = null;
    const raw = app.repo.getSetting('workspace.searchRoots');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) roots = parsed.map(String).slice(0, 12);
      } catch { /* fall back to defaults */ }
    }
    const { findCandidates, recogniseCandidate } = await import('../core/workspace-resolver.js');
    const candidates = findCandidates(folderName, { roots });
    const recognised = [];
    for (const c of candidates.slice(0, 5)) {
      recognised.push(await recogniseCandidate(c.path, { scanner: app.scanner }));
    }
    return {
      query: folderName,
      candidates: recognised,
      roots: roots || null,
      note: recognised.length ? null : 'No matching folder found in the configured search roots. Add the parent folder to Settings → Search roots, or enter the path manually.',
    };
  });

  // ── Projects ────────────────────────────────────────────────────────────
  r.get('/api/projects', ({ query }) => app.listProjects({ includeArchived: query.includeArchived === 'true' }).map((p) => app.projectCard(p)));

  r.post('/api/projects', ({ body }) => {
    const workspacePath = requireParam(body, 'workspacePath', { maxLength: 1000 });
    const project = app.addProject({
      workspacePath,
      name: body.name ? String(body.name).slice(0, 200) : null,
      description: body.description ? String(body.description).slice(0, 2000) : '',
      ignorePatterns: Array.isArray(body.ignorePatterns) ? body.ignorePatterns.map(String).slice(0, 100) : [],
    });
    return app.projectCard(project);
  });

  r.get('/api/projects/:id', ({ params }) => app.projectCard(needProject(app, params.id)));

  r.get('/api/projects/:id/detail', ({ params }) => {
    const project = needProject(app, params.id);
    const meta = project.metadata || {};
    return {
      project: app.projectCard(project),
      metadata: meta.metadata || null,
      commands: meta.metadata ? detectedCommandSummary(detectAllCommands(meta.metadata)) : [],
      git: meta.git || null,
      gitSnapshotId: meta.gitSnapshotId || null,
      build: meta.build || null,
      lint: meta.lint || null,
      typecheck: meta.typecheck || null,
      tests: meta.tests || {},
      gate: meta.gate || null,
      health: meta.health || null,
      progress: meta.progress || null,
      drift: meta.drift || null,
      specSummary: meta.specSummary || null,
      nextAction: meta.nextAction || null,
      aiSummary: meta.aiSummary || null,
      taskSummary: app.taskLedger.summary(project.id),
      riskSummary: riskSummary(app.repo.list('risks', { project_id: project.id })),
      regressionSummary: regressionSummary(app.repo.list('regressions', { project_id: project.id })),
      memoryVersion: (app.memoryStore.latest(project.id) || {}).version || null,
      lastScanDurationMs: meta.lastScanDurationMs || null,
    };
  });

  r.patch('/api/projects/:id', ({ params, body }) => {
    needProject(app, params.id);
    if (body.name !== undefined) app.renameProject(params.id, String(body.name).slice(0, 200));
    if (body.description !== undefined) app.setDescription(params.id, String(body.description).slice(0, 2000));
    if (body.ignorePatterns !== undefined) app.setIgnorePatterns(params.id, Array.isArray(body.ignorePatterns) ? body.ignorePatterns.map(String).slice(0, 100) : []);
    return app.projectCard(app.getProject(params.id));
  });

  r.delete('/api/projects/:id', ({ params, query }) => {
    if (query.mode !== 'record_only') {
      throw new ValidationError(
      'refusing to delete: pass ?mode=record_only — Commander never deletes source directories',
      [{ path: 'mode', message: 'record_only deletes only Commander database rows' }],
    );
    }
    return app.deleteProjectRecord(params.id);
  });

  r.post('/api/projects/:id/archive', ({ params }) => app.projectCard(app.archiveProject(params.id)));
  r.post('/api/projects/:id/unarchive', ({ params }) => app.projectCard(app.unarchiveProject(params.id)));
  r.post('/api/projects/:id/pause-watch', ({ params }) => app.projectCard(app.pauseWatch(params.id)));
  r.post('/api/projects/:id/resume-watch', ({ params }) => { needProject(app, params.id); app.resumeWatch(params.id); return app.projectCard(app.getProject(params.id)); });

  // ── Scanning / jobs ─────────────────────────────────────────────────────
  r.post('/api/projects/:id/scan', ({ params, body }) => {
    needProject(app, params.id);
    const mode = body.mode === 'quick' ? 'quick' : 'full';
    const job = app.queue.enqueue({
      projectId: params.id,
      type: mode === 'quick' ? JOB_TYPE.QUICK_SCAN : JOB_TYPE.FULL_SCAN,
      payload: { projectId: params.id, runCommands: body.runCommands !== false, suites: body.suites },
      priority: body.priority !== undefined ? Number(body.priority) : 3,
      timeoutMs: mode === 'quick' ? 120000 : 900000,
    });
    return { jobId: job.id, mode };
  });

  r.post('/api/projects/:id/scan-sync', async ({ params, body }) => {
    needProject(app, params.id);
    const mode = body.mode === 'quick' ? 'quick' : 'full';
    if (mode === 'quick') {
      const out = await app.orchestrator.quickScan(params.id);
      return { mode, files: out.metadata.fileCount, git: { branch: out.git.branch, clean: out.git.workingTreeClean } };
    }
    const out = await app.orchestrator.fullScan(params.id, { runCommands: body.runCommands !== false, suites: body.suites || ['unit', 'integration', 'e2e'] });
    return {
      mode, files: out.metadata.fileCount, health: out.health.status, gate: out.gate.result,
      snapshotSeq: out.snapshot.seq, durationMs: out.durationMs,
      build: out.build.build ? out.build.build.status : null,
      unit: out.tests.unit ? `${out.tests.unit.passed}/${out.tests.unit.total}` : null,
      e2e: out.tests.e2e ? `${out.tests.e2e.passed}/${out.tests.e2e.total}` : null,
    };
  });

  r.get('/api/jobs', ({ query }) => app.queue.list({ status: query.status || null, limit: Number(query.limit || 50) }));
  r.post('/api/jobs/:id/cancel', ({ params }) => ({ cancelled: app.queue.cancel(params.id) }));
  r.get('/api/jobs/stats', () => app.queue.stats());

  // ── Tasks ───────────────────────────────────────────────────────────────
  r.get('/api/projects/:id/tasks', ({ params, query }) => ({
    summary: app.taskLedger.summary(params.id),
    tasks: app.repo.list('tasks', { project_id: params.id }, { orderBy: 'created_at DESC' })
      .filter((t) => (query.status ? t.status === query.status : true)),
  }));
  r.post('/api/projects/:id/tasks', ({ params, body }) => {
    needProject(app, params.id);
    const title = requireParam(body, 'title', { maxLength: 300 });
    const out = app.taskLedger.addManual(params.id, { title, description: String(body.description || '').slice(0, 2000), priority: body.priority });
    return out.task;
  });
  r.patch('/api/tasks/:id', ({ params, body }) => {
    const task = app.repo.get('tasks', params.id);
    if (!task) throw new NotFoundError('task', params.id);
    const patch = {};
    if (body.status) patch.status = String(body.status);
    if (body.priority) patch.priority = String(body.priority);
    if (body.title) patch.title = String(body.title).slice(0, 300);
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 4000);
    if (body.stageId !== undefined) patch.stage_id = body.stageId || null;
    return app.repo.update('tasks', params.id, patch);
  });

  // ── Stages / acceptance ─────────────────────────────────────────────────
  r.get('/api/projects/:id/stages', ({ params }) => ({
    stages: app.repo.list('stages', { project_id: params.id }, { orderBy: 'order_index' }),
    criteria: app.repo.list('acceptance_criteria', { project_id: params.id }),
  }));

  // ── Tests / Builds / Git ────────────────────────────────────────────────
  r.get('/api/projects/:id/tests', ({ params, query }) => {
    const limit = Number(query.limit || 20);
    const suites = ['unit', 'integration', 'e2e'];
    const history = {};
    for (const s of suites) {
      history[s] = app.repo.list('test_runs', { project_id: params.id, suite: s }, { orderBy: 'ts DESC', limit })
        .map((t) => ({ id: t.id, ts: t.ts, status: t.status, total: t.total, passed: t.passed, failed: t.failed, skipped: t.skipped, framework: t.framework, command: t.command, durationMs: t.duration_ms, parseConfidence: t.parse_confidence }));
    }
    const latest = {};
    for (const s of suites) {
      const run = app.repo.list('test_runs', { project_id: params.id, suite: s }, { orderBy: 'ts DESC', limit: 1 })[0];
      if (!run) { latest[s] = null; continue; }
      latest[s] = { ...run, cases: app.repo.list('test_case_results', { test_run_id: run.id }) };
    }
    return { history, latest, parsers: describeParsers() };
  });

  r.get('/api/projects/:id/builds', ({ params, query }) => ({
    builds: app.repo.list('build_results', { project_id: params.id }, { orderBy: 'ts DESC', limit: Number(query.limit || 30) }),
  }));

  r.get('/api/projects/:id/git', ({ params }) => {
    const project = needProject(app, params.id);
    const meta = project.metadata || {};
    const snapshots = app.repo.list('git_snapshots', { project_id: params.id }, { orderBy: 'ts DESC', limit: 15 });
    return { git: meta.git || null, snapshots };
  });

  r.get('/api/projects/:id/changes', ({ params }) => {
    const project = needProject(app, params.id);
    const meta = project.metadata || {};
    const previous = app.repo.list('project_snapshots', { project_id: params.id }, { orderBy: 'seq DESC', limit: 2 });
    const changes = analyzeChanges({ git: meta.git, previousSnapshot: previous[1] || null });
    const snapshots = app.repo.list('project_snapshots', { project_id: params.id }, { orderBy: 'seq DESC', limit: 20 });
    return { changes, snapshots: snapshots.map((s) => ({ id: s.id, seq: s.seq, ts: s.ts, health: s.health, build: s.build, unit: s.unit, e2e: s.e2e, gate: s.gate, fileCount: s.file_count, stageName: s.stage_name })) };
  });

  r.get('/api/projects/:id/snapshots', ({ params }) => ({ snapshots: app.repo.list('project_snapshots', { project_id: params.id }, { orderBy: 'seq DESC' }) }));

  // ── Risks / Regressions / Issues ────────────────────────────────────────
  r.get('/api/projects/:id/risks', ({ params }) => {
    const risks = app.repo.list('risks', { project_id: params.id }, { orderBy: 'created_at DESC' });
    return { risks, summary: riskSummary(risks) };
  });
  r.patch('/api/risks/:id', ({ params, body }) => {
    const risk = app.repo.get('risks', params.id);
    if (!risk) throw new NotFoundError('risk', params.id);
    return app.repo.update('risks', params.id, { status: String(body.status || 'open') });
  });

  r.get('/api/projects/:id/regressions', ({ params }) => {
    const regressions = app.repo.list('regressions', { project_id: params.id }, { orderBy: 'ts DESC', limit: 50 });
    return { regressions, summary: regressionSummary(regressions) };
  });
  r.post('/api/regressions/:id/acknowledge', ({ params }) => {
    const reg = app.repo.get('regressions', params.id);
    if (!reg) throw new NotFoundError('regression', params.id);
    return app.repo.update('regressions', params.id, { acknowledged: true });
  });

  r.get('/api/projects/:id/issues', ({ params }) => ({ issues: app.repo.list('issues', { project_id: params.id }, { orderBy: 'created_at DESC' }) }));
  r.patch('/api/issues/:id', ({ params, body }) => {
    const issue = app.repo.get('issues', params.id);
    if (!issue) throw new NotFoundError('issue', params.id);
    return app.repo.update('issues', params.id, { status: String(body.status || 'open') });
  });
  r.post('/api/projects/:id/issues', ({ params, body }) => {
    needProject(app, params.id);
    return app.repo.insert('issues', {
      project_id: params.id, title: requireParam(body, 'title', { maxLength: 300 }),
      kind: String(body.kind || 'bug'), severity: String(body.severity || 'medium'),
      description: String(body.description || '').slice(0, 4000), status: 'open', source: 'manual', evidence: [],
    });
  });

  // ── Specification / memory / decisions ──────────────────────────────────
  r.get('/api/projects/:id/specs', ({ params }) => ({
    specs: app.repo.list('specifications', { project_id: params.id }),
    criteria: app.repo.list('acceptance_criteria', { project_id: params.id }),
  }));

  r.get('/api/projects/:id/memory', ({ params }) => {
    const latest = app.memoryStore.latest(params.id);
    return { latest, history: app.memoryStore.history(params.id).map((m) => ({ id: m.id, version: m.version, created_at: m.created_at, author: m.author, note: m.note })), rendered: app.memoryStore.render(latest) };
  });
  r.post('/api/projects/:id/memory', ({ params, body }) => {
    const project = needProject(app, params.id);
    const latest = app.memoryStore.latest(params.id);
    const content = latest ? { ...latest.content } : { purpose: project.description, architecture: {}, businessRules: [], importantConstraints: [], knownIssues: [], recentChanges: {} };
    if (body.note !== undefined) content.manuallyNoted = String(body.note).slice(0, 2000);
    content.editedByUser = true;
    const out = app.memoryStore.version(params.id, content, { author: 'user', note: String(body.note || 'manual edit').slice(0, 200) });
    return { version: out.version, created: out.created, memory: out.memory };
  });

  r.get('/api/projects/:id/decisions', ({ params }) => ({ decisions: app.adrStore.list(params.id) }));
  r.post('/api/projects/:id/decisions', ({ params, body }) => {
    needProject(app, params.id);
    return app.adrStore.create(params.id, {
      title: requireParam(body, 'title', { maxLength: 200 }),
      context: String(body.context || '').slice(0, 4000),
      decision: String(body.decision || '').slice(0, 4000),
      consequences: String(body.consequences || '').slice(0, 4000),
      status: body.status || 'proposed',
    });
  });
  r.patch('/api/decisions/:id', ({ params, body }) => {
    const adr = app.repo.get('architecture_decisions', params.id);
    if (!adr) throw new NotFoundError('decision', params.id);
    return app.adrStore.setStatus(params.id, String(body.status), { supersededBy: body.supersededBy || null });
  });

  // ── Next action / prompts / handoff ─────────────────────────────────────
  r.get('/api/projects/:id/next-action', ({ params }) => {
    const project = needProject(app, params.id);
    return (project.metadata && project.metadata.nextAction) || null;
  });

  r.post('/api/projects/:id/next-action', async ({ params, body }) => {
    needProject(app, params.id);
    if (body.useAI === false) {
      const facts = app.aiService.buildFacts(params.id);
      const action = app.nextActionEngine.decide({
        build: facts.build, unit: facts.unit, integration: facts.integration, e2e: facts.e2e,
        risks: facts.risks, regressions: facts.regressions, drift: facts.drift, gate: facts.gate,
        tasks: facts.tasks, stages: facts.stages,
        currentStage: facts.stages.find((s) => s.id === facts.project.current_stage_id) || facts.stages[0] || null,
        specs: facts.specs, metadata: facts.metadata, git: facts.git, failedCases: facts.failedCases,
      });
      app.repo.update('projects', params.id, { metadata: { ...(facts.project.metadata || {}), nextAction: action } });
      return action;
    }
    return app.aiService.nextAction(params.id, { engine: app.nextActionEngine });
  });

  r.get('/api/projects/:id/prompts', ({ params }) => ({
    prompts: app.repo.list('prompts', { project_id: params.id }, { orderBy: 'created_at DESC', limit: 50 }),
    executions: app.agentSessions.executionsFor(params.id),
  }));

  r.post('/api/projects/:id/prompts', async ({ params, body }) => {
    const project = needProject(app, params.id);
    const facts = app.aiService.buildFacts(params.id);
    const nextAction = (project.metadata && project.metadata.nextAction)
      || await app.aiService.nextAction(params.id, { engine: app.nextActionEngine });
    const memory = app.memoryStore.latest(params.id);
    const stages = facts.stages;
    const result = await app.promptGenerator.generate({
      project, metadata: facts.metadata, git: facts.git, build: facts.build,
      unit: facts.unit, integration: facts.integration, e2e: facts.e2e,
      nextAction, risks: facts.risks, memory, failedCases: facts.failedCases,
      specs: facts.specs, criteria: facts.criteria, tasks: facts.tasks,
      currentStage: stages.find((s) => s.id === project.current_stage_id) || stages[0] || null,
      agentKey: body.agentKey || 'generic_cli',
    });
    const row = app.repo.insert('prompts', {
      project_id: params.id,
      stage_id: project.current_stage_id,
      next_action_id: nextAction.id,
      agent_key: String(body.agentKey || 'generic_cli'),
      title: result.title,
      content: truncate(result.prompt, 20000),
      expected_result: truncate((nextAction.acceptanceCriteria || []).join(' | '), 1000),
      actual_result: '',
      status: 'generated',
      provider: result.provider,
      evidence: nextAction.evidence || [],
    });
    app.events.record(params.id, 'prompt_generated', `Agent prompt generated (${result.provider})`, { promptId: row.id, sections: result.sections });
    return { prompt: row, meta: { provider: result.provider, model: result.model, confidence: result.confidence, fallbackUsed: result.fallbackUsed, sections: result.sections } };
  });

  r.get('/api/projects/:id/handoff', ({ params }) => {
    const project = needProject(app, params.id);
    const facts = app.aiService.buildFacts(params.id);
    return buildHandoff(app, project, facts);
  });

  r.post('/api/projects/:id/handoff/export', async ({ params, body }) => {
    const project = needProject(app, params.id);
    const facts = app.aiService.buildFacts(params.id);
    const pkg = buildHandoff(app, project, facts);
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    const dir = pathMod.join(app.dataDir, 'exports');
    fsMod.mkdirSync(dir, { recursive: true });
    const name = `handoff-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.md`;
    const abs = pathMod.join(dir, name);
    fsMod.writeFileSync(abs, pkg.markdown, 'utf8');
    app.repo.insert('artifacts', { project_id: params.id, kind: 'handoff', name, path: toPosix(abs), meta: { sections: pkg.sections }, id: undefined });
    return { name, url: `/files/${name}`, bytes: Buffer.byteLength(pkg.markdown, 'utf8') };
  });

  // ── Agent sessions ──────────────────────────────────────────────────────
  r.get('/api/projects/:id/sessions', ({ params }) => ({ sessions: app.agentSessions.list(params.id), adapters: ADAPTER_CATALOGUE }));
  r.post('/api/projects/:id/sessions/import', async ({ params, body }) => {
    needProject(app, params.id);
    const provider = String(body.provider || 'manual');
    if (body.mock === true) {
      const adapter = new MockAgentAdapter({ projectName: (app.repo.get('projects', params.id) || {}).name });
      return app.agentSessions.importSession(params.id, { adapter });
    }
    const transcript = requireParam(body, 'transcript', { maxLength: 200000 });
    const adapter = new ManualImportAdapter({
      transcript,
      provider,
      externalId: String(body.externalId || ''),
      startedAt: body.startedAt || null,
      endedAt: body.endedAt || null,
    });
    const session = await app.agentSessions.importSession(params.id, { adapter });
    if (body.promptId) await app.agentSessions.linkPromptExecution(params.id, body.promptId, session.id, { status: session.status, summary: session.summary });
    return session;
  });

  // ── Timeline / events ───────────────────────────────────────────────────
  r.get('/api/projects/:id/timeline', ({ params, query }) => ({ events: app.events.timeline(params.id, { limit: Number(query.limit || 200) }) }));
  r.get('/api/events', ({ query }) => ({ events: app.events.recentGlobal({ limit: Number(query.limit || 100) }) }));

  // ── AI ──────────────────────────────────────────────────────────────────
  r.post('/api/projects/:id/ai/summary', async ({ params }) => app.aiService.summarize(params.id));
  r.post('/api/projects/:id/ai/risks', async ({ params }) => app.aiService.enrichRisks(params.id));
  r.post('/api/projects/:id/ai/tasks', async ({ params }) => app.aiService.extractTasks(params.id));
  r.post('/api/projects/:id/ai/drift', async ({ params }) => app.aiService.analyzeDrift(params.id));
  r.post('/api/projects/:id/ai/enrich', ({ params }) => {
    const job = app.queue.enqueue({ projectId: params.id, type: JOB_TYPE.AI_ANALYSIS, payload: { projectId: params.id }, priority: 6, timeoutMs: 120000 });
    return { jobId: job.id };
  });

  // ── Demo ────────────────────────────────────────────────────────────────
  r.post('/api/demo/seed', async ({ body }) => app.seedDemoAndAnalyze({ rebuild: body.rebuild === true, runCommands: body.runCommands !== false }));

  // ── Diagnostics ─────────────────────────────────────────────────────────
  r.get('/api/diagnostics/commands', () => ({ autoAllowed: 'see /api/security', recentRuns: app.runner.recentRuns(30) }));
  r.get('/api/diagnostics/logs', ({ query }) => ({ lines: loggerTail(app, Number(query.limit || 100)) }));
  r.post('/api/diagnostics/parse-test', ({ body }) => parseTestOutput(String(body.stdout || ''), String(body.stderr || ''), { exitCode: body.exitCode === undefined ? null : Number(body.exitCode), suite: String(body.suite || 'unit') }));

  return r;
}

function buildHandoff(app, project, facts) {
  const stages = facts.stages || [];
  return buildHandoffPackage({
    project, metadata: facts.metadata, git: facts.git, stages,
    currentStage: stages.find((s) => s.id === project.current_stage_id) || stages[0] || null,
    tasks: facts.tasks, criteria: facts.criteria, specs: facts.specs, risks: facts.risks,
    regressions: facts.regressions, gate: facts.gate, health: facts.health, progress: facts.progress,
    memory: app.memoryStore.latest(project.id), memoryStore: app.memoryStore,
    unit: facts.unit, integration: facts.integration, e2e: facts.e2e, build: facts.build,
    nextAction: (project.metadata && project.metadata.nextAction) || null,
    prompts: app.repo.list('prompts', { project_id: project.id }),
    agentSessions: app.agentSessions.list(project.id),
  });
}

import { logger } from '../core/logger.js';
import { buildHandoffPackage } from '../core/engines/handoff.js';

function loggerTail(app, limit) {
  return logger.recent(limit).map((r) => `${r.ts} ${r.level.toUpperCase()} ${r.event}${r.data ? ` ${JSON.stringify(r.data)}` : ''}`);
}

export { sendJson, ValidationError };
