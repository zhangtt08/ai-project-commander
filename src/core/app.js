/**
 * App container — wires every layer into one object graph.
 *
 * This is the single composition root. Nothing else constructs a Database, a
 * CommandRunner or an AI provider.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getDb, openDatabase } from '../db/database.js';
import { Repository } from '../db/repositories.js';
import { logger, logFileFor } from './logger.js';
import { CommandRunner, describeSecurityModel } from './command-runner.js';
import { ProjectScanner } from './scanner.js';
import { GitAnalyzer } from './git-analyzer.js';
import { BuildAnalyzer } from './analyzers/build-analyzer.js';
import { TestAnalyzer } from './analyzers/test-analyzer.js';
import { analyzeChanges } from './analyzers/change-analyzer.js';
import { SpecificationManager } from './engines/spec-manager.js';
import { TaskLedger } from './engines/task-ledger.js';
import { StageManager } from './engines/stage-manager.js';
import { evaluateGate } from './engines/acceptance-gate.js';
import { ProjectHealthEngine, ProjectProgressEngine } from './engines/health.js';
import { analyzeRisks, riskSummary } from './engines/risk.js';
import { detectRegressions, regressionSummary } from './engines/regression.js';
import { detectDrift } from './engines/drift.js';
import { ProjectMemoryStore, AdrStore } from './engines/memory.js';
import { NextActionEngine } from './engines/next-action.js';
import { PromptGenerator } from './engines/prompt-generator.js';
import { buildHandoffPackage } from './engines/handoff.js';
import { EventLog } from './events.js';
import { SearchService } from './search.js';
import { AnalysisQueue, WorkspaceWatcher } from './jobs.js';
import { Orchestrator } from './orchestrator.js';
import { AgentSessionService } from './agent-sessions.js';
import { ProviderRegistry } from './ai/provider.js';
import { MockAIProvider } from './ai/mock-provider.js';
import { OpenAICompatibleProvider } from './ai/openai-provider.js';
import { StructuredRunner } from './ai/structured.js';
import { AIService } from './ai/service.js';
import { ensureDemoProjects, demoProjectDefinitions } from '../demo/fixture-factory.js';
import { EVENT_TYPE, PROJECT_STATUS, PROJECT_HEALTH, DEFAULT_SCAN_LIMITS } from '../domain/constants.js';
import { newId, nowIso, toPosix } from './util.js';
import { WorkspaceError, ConflictError, NotFoundError } from '../domain/errors.js';

/** Thin adapters so engines expose a uniform `.detect()/.evaluate()` surface. */
class RiskEngine { detect(input) { return analyzeRisks(input); } }
class AcceptanceGate { evaluate(input) { return evaluateGate(input); } }
class RegressionDetector { detect(input) { return detectRegressions(input); } }
class DriftDetector { detect(input) { return detectDrift(input); } }

export class App {
  constructor({ dataDir = null, dbFile = null, logLevel = null } = {}) {
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (logLevel) logger.configure({ level: logLevel });
    logger.configure({ file: logFileFor(this.dataDir) });

    this.dbFile = dbFile || path.join(this.dataDir, 'commander.db');
    this.db = dbFile === ':memory:' ? openDatabase(':memory:') : getDb(this.dbFile);
    this.repo = new Repository(this.db);

    // Infrastructure
    this.runner = new CommandRunner({ defaultTimeoutMs: DEFAULT_SCAN_LIMITS.defaultCommandTimeoutMs });
    this.events = new EventLog({ repo: this.repo });
    this.search = new SearchService({ db: this.db, repo: this.repo });
    this.queue = new AnalysisQueue({ repo: this.repo, concurrency: 2, events: this.events });
    this.watcher = new WorkspaceWatcher({
      events: this.events,
      queue: this.queue,
      autoQuickScan: this.repo.getSetting('watcher.autoQuickScan') === 'true',
    });

    // Analysis
    this.scanner = new ProjectScanner();
    this.gitAnalyzer = new GitAnalyzer({ runner: this.runner });
    this.buildAnalyzer = new BuildAnalyzer({ runner: this.runner, buildTimeoutMs: DEFAULT_SCAN_LIMITS.buildTimeoutMs });
    this.testAnalyzer = new TestAnalyzer({ runner: this.runner, testTimeoutMs: DEFAULT_SCAN_LIMITS.testTimeoutMs });

    // Engines
    this.specManager = new SpecificationManager();
    this.taskLedger = new TaskLedger({ repo: this.repo });
    this.stageManager = new StageManager({ repo: this.repo });
    this.acceptanceGate = new AcceptanceGate();
    this.healthEngine = new ProjectHealthEngine();
    this.progressEngine = new ProjectProgressEngine();
    this.riskEngine = new RiskEngine();
    this.regressionDetector = new RegressionDetector();
    this.driftDetector = new DriftDetector();
    this.memoryStore = new ProjectMemoryStore({ repo: this.repo });
    this.adrStore = new AdrStore({ repo: this.repo });
    this.nextActionEngine = new NextActionEngine();

    // AI
    this.providerRegistry = new ProviderRegistry();
    this.mockProvider = new MockAIProvider();
    this.providerRegistry.register(this.mockProvider, { active: true });
    this.#configureProviderFromSettings();
    this.structured = new StructuredRunner({ registry: this.providerRegistry, mockProvider: this.mockProvider });
    this.promptGenerator = new PromptGenerator({ structured: this.structured, memoryStore: this.memoryStore });

    // Orchestration
    this.orchestrator = new Orchestrator({
      repo: this.repo,
      scanner: this.scanner,
      gitAnalyzer: this.gitAnalyzer,
      buildAnalyzer: this.buildAnalyzer,
      testAnalyzer: this.testAnalyzer,
      specManager: this.specManager,
      taskLedger: this.taskLedger,
      stageManager: this.stageManager,
      riskEngine: this.riskEngine,
      healthEngine: this.healthEngine,
      progressEngine: this.progressEngine,
      acceptanceGate: this.acceptanceGate,
      regressionDetector: this.regressionDetector,
      driftDetector: this.driftDetector,
      memoryStore: this.memoryStore,
      nextActionEngine: this.nextActionEngine,
      events: this.events,
      search: this.search,
    });
    this.orchestrator.registerHandlers(this.queue);

    this.aiService = new AIService({
      repo: this.repo,
      structured: this.structured,
      memoryStore: this.memoryStore,
      taskLedger: this.taskLedger,
      orchestratorRef: this.orchestrator,
    });

    this.agentSessions = new AgentSessionService({ repo: this.repo, events: this.events, eventType: EVENT_TYPE.AGENT_SESSION_IMPORTED });
  }

  startBackground() {
    this.queue.start();
    const autostart = this.repo.getSetting('watcher.enabled') !== 'false';
    if (autostart) {
      for (const p of this.repo.list('projects', { archived_at: null })) {
        if (!p.watch_paused) this.watcher.watch(p);
      }
    }
    return this;
  }

  stopBackground() {
    this.queue.stop();
    this.watcher.unwatchAll();
  }

  #configureProviderFromSettings() {
    const kind = this.repo.getSetting('ai.provider');
    if (kind !== 'openai-compatible') return;
    const provider = new OpenAICompatibleProvider({
      name: 'openai-compatible',
      baseUrl: this.repo.getSetting('ai.baseUrl') || process.env.OPENAI_BASE_URL || '',
      apiKey: this.repo.getSetting('ai.apiKey') || process.env.OPENAI_API_KEY || '',
      model: this.repo.getSetting('ai.model') || 'gpt-4o-mini',
    });
    this.providerRegistry.register(provider);
    if (provider.isConfigured()) this.providerRegistry.setActive(provider.name);
  }

  updateProviderSettings(settings) {
    for (const [k, v] of Object.entries(settings)) {
      if (k.startsWith('ai.')) this.repo.setSetting(k, v);
    }
    if (settings['ai.apiKey'] !== undefined && String(settings['ai.apiKey']).trim() === '') {
      // do not clobber a stored key with an empty string coming from a masked form
      const current = this.repo.getSetting('ai.apiKey');
      if (current) this.repo.setSetting('ai.apiKey', current);
    }
    this.#configureProviderFromSettings();
    if (settings['ai.provider'] === 'mock') this.providerRegistry.setActive('mock');
    return this.providerRegistry.describe();
  }

  // ───────────────────────────── Workspace Registry (#10) ─────────────────────────────

  addProject({ workspacePath, name = null, description = '', ignorePatterns = [], demo = false }) {
    const abs = path.resolve(workspacePath);
    if (!fs.existsSync(abs)) throw new WorkspaceError(`workspace path does not exist: ${abs}`, 'Choose an existing local directory.');
    if (!fs.statSync(abs).isDirectory()) throw new WorkspaceError(`workspace path is not a directory: ${abs}`);
    const existing = this.repo.list('projects', { workspace_path: toPosix(abs) });
    if (existing.length) throw new ConflictError(`this workspace is already registered`, `Project "${existing[0].name}" already points at ${abs}.`);

    const project = this.repo.insert('projects', {
      id: newId('prj'),
      name: name || path.basename(abs),
      description,
      workspace_path: toPosix(abs),
      repository_type: fs.existsSync(path.join(abs, '.git')) ? 'git' : 'unknown',
      status: PROJECT_STATUS.PLANNING,
      health: PROJECT_HEALTH.UNKNOWN,
      is_demo: !!demo,
      watch_paused: false,
      ignore_patterns: ignorePatterns,
      metadata: {},
      progress: { value: null, percent: null, reason: 'not computed yet' },
    });
    this.events.record(project.id, EVENT_TYPE.PROJECT_ADDED, `Project added: ${project.name}`, { path: toPosix(abs) });
    if (!project.watch_paused) this.watcher.watch(project);
    return project;
  }

  renameProject(projectId, name) {
    return this.repo.update('projects', projectId, { name });
  }

  setDescription(projectId, description) {
    return this.repo.update('projects', projectId, { description });
  }

  setIgnorePatterns(projectId, patterns) {
    return this.repo.update('projects', projectId, { ignore_patterns: patterns });
  }

  pauseWatch(projectId) {
    this.watcher.unwatch(projectId);
    return this.repo.update('projects', projectId, { watch_paused: true });
  }

  resumeWatch(projectId) {
    const p = this.repo.get('projects', projectId);
    if (!p) throw new NotFoundError('project', projectId);
    this.repo.update('projects', projectId, { watch_paused: false });
    return this.watcher.watch(this.repo.get('projects', projectId));
  }

  archiveProject(projectId) {
    this.watcher.unwatch(projectId);
    this.events.record(projectId, EVENT_TYPE.PROJECT_ARCHIVED, 'Project archived', {});
    return this.repo.update('projects', projectId, { archived_at: nowIso(), status: PROJECT_STATUS.ARCHIVED, watch_paused: true });
  }

  unarchiveProject(projectId) {
    return this.repo.update('projects', projectId, { archived_at: null, status: PROJECT_STATUS.PLANNING, watch_paused: false });
  }

  /**
   * Remove the Commander record ONLY. The real source directory is never touched (ADR-009).
   */
  deleteProjectRecord(projectId) {
    const project = this.repo.get('projects', projectId);
    if (!project) throw new NotFoundError('project', projectId);
    this.watcher.unwatch(projectId);
    const stats = {
      sourceDirectoryUntouched: project.workspace_path,
      deletedRecords: {
        tasks: this.repo.count('tasks', { project_id: projectId }),
        risks: this.repo.count('risks', { project_id: projectId }),
        snapshots: this.repo.count('project_snapshots', { project_id: projectId }),
        prompts: this.repo.count('prompts', { project_id: projectId }),
        events: this.repo.count('project_events', { project_id: projectId }),
      },
    };
    this.events.record(projectId, EVENT_TYPE.NOTE, 'Project record deleted (source directory untouched)', stats);
    for (const table of ['acceptance_criteria', 'specifications', 'tasks', 'stages', 'milestones', 'risks', 'regressions', 'health_results', 'project_snapshots', 'git_snapshots', 'build_results', 'test_case_results', 'test_runs', 'prompts', 'executions', 'agent_sessions', 'project_memory', 'architecture_decisions', 'artifacts', 'analysis_jobs', 'evidence_refs']) {
      this.repo.removeWhere(table, { project_id: projectId });
    }
    this.repo.remove('projects', projectId);
    return stats;
  }

  listProjects({ includeArchived = false } = {}) {
    const rows = this.repo.list('projects', {}, { orderBy: 'updated_at DESC' });
    return includeArchived ? rows : rows.filter((p) => !p.archived_at);
  }

  getProject(projectId) {
    const p = this.repo.get('projects', projectId);
    if (!p) throw new NotFoundError('project', projectId);
    return p;
  }

  // ───────────────────────────── Demo Mode (#50) ─────────────────────────────

  seedDemoProjects({ rebuild = false } = {}) {
    const base = path.join(this.dataDir, 'demo-projects');
    fs.mkdirSync(base, { recursive: true });
    if (rebuild) {
      for (const def of demoProjectDefinitions(base)) {
        for (const p of this.repo.list('projects', { workspace_path: toPosix(def.dir) })) this.deleteProjectRecord(p.id);
      }
    }
    const created = ensureDemoProjects(base);
    const out = [];
    for (const def of created) {
      const existing = this.repo.list('projects', { workspace_path: toPosix(def.dir) })[0];
      if (existing) { out.push({ project: existing, alreadyPresent: true }); continue; }
      const project = this.addProject({ workspacePath: def.dir, name: def.name, description: def.description, demo: true });
      for (const adr of AdrStore.seedFromProject({ ...project, primaryLanguage: 'unknown', framework: 'unknown', packageManager: 'unknown' })) {
        this.adrStore.create(project.id, adr);
      }
      out.push({ project, alreadyPresent: false });
    }
    return out;
  }

  async seedDemoAndAnalyze({ rebuild = false, runCommands = true } = {}) {
    const seeded = this.seedDemoProjects({ rebuild });
    const results = [];
    for (const s of seeded) {
      if (s.alreadyPresent) { results.push({ projectId: s.project.id, skipped: true }); continue; }
      const r = await this.orchestrator.fullScan(s.project.id, { runCommands, suites: ['unit', 'integration', 'e2e'] });
      this.queue.enqueue({ projectId: s.project.id, type: 'ai_analysis', payload: { projectId: s.project.id }, priority: 6, timeoutMs: 60000 });
      results.push({ projectId: s.project.id, health: r.health.status, gate: r.gate.result, files: r.metadata.fileCount });
    }
    await this.queue.drain({ timeoutMs: 30000 });
    return results;
  }

  // ───────────────────────────── Aggregations (Dashboard/Attention) ─────────────────────────────

  dashboard() {
    const projects = this.listProjects();
    const counts = { total: projects.length, healthy: 0, warning: 0, critical: 0, unknown: 0, blocked: 0, archived: this.repo.list('projects', {}).filter((p) => p.archived_at).length };
    for (const p of projects) {
      counts[p.health] = (counts[p.health] || 0) + 1;
      if (p.status === PROJECT_STATUS.BLOCKED) counts.blocked += 1;
    }
    const cards = projects.map((p) => this.projectCard(p));
    return { counts, cards, generatedAt: nowIso() };
  }

  projectCard(project) {
    const meta = project.metadata || {};
    const tasks = this.repo.list('tasks', { project_id: project.id });
    const risks = this.repo.list('risks', { project_id: project.id });
    const regressions = this.repo.list('regressions', { project_id: project.id }, { orderBy: 'ts DESC', limit: 5 });
    return {
      id: project.id,
      name: project.name,
      workspacePath: project.workspace_path,
      description: project.description,
      status: project.status,
      health: project.health,
      isDemo: !!project.is_demo,
      watchPaused: !!project.watch_paused,
      currentStage: (meta.stages && meta.stages.current) || meta.currentStageName || (this.repo.get('stages', project.current_stage_id || '') || {}).name || null,
      progress: project.progress || meta.progress || { value: null, reason: 'not computed' },
      build: meta.build || null,
      unit: (meta.tests && meta.tests.unit) || null,
      e2e: (meta.tests && meta.tests.e2e) || null,
      integration: (meta.tests && meta.tests.integration) || null,
      git: meta.git ? { branch: meta.git.branch, head: meta.git.commitShort, clean: meta.git.workingTreeClean, changed: meta.git.changedFileCount, untracked: (meta.git.untracked || []).length } : null,
      gate: meta.gate || null,
      drift: meta.drift ? { verdict: meta.drift.verdict, count: (meta.drift.drifts || []).length } : null,
      lastActivity: this.events.lastActivity(project.id) || project.updated_at,
      lastAnalyzedAt: project.last_analyzed_at,
      nextAction: meta.nextAction || null,
      taskSummary: { total: tasks.length, done: tasks.filter((t) => t.status === 'done').length, blocked: tasks.filter((t) => t.status === 'blocked').length },
      riskSummary: riskSummary(risks),
      regressionSummary: regressionSummary(regressions),
      primaryLanguage: project.primary_language,
      framework: project.framework,
    };
  }

  attentionCenter() {
    const items = [];
    for (const project of this.listProjects()) {
      const card = this.projectCard(project);
      if (card.health === PROJECT_HEALTH.CRITICAL) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'critical_health', severity: 'critical', title: `${project.name} is Critical`, detail: (project.metadata && project.metadata.health && project.metadata.health.reasons || []).slice(0, 2).map((r) => r.message).join(' ') || 'Critical health status.' });
      }
      if (card.build && (card.build.status === 'fail' || card.build.status === 'timeout')) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'build_fail', severity: 'critical', title: `${project.name}: build ${card.build.status}`, detail: card.build.command || '' });
      }
      for (const suite of ['unit', 'e2e', 'integration']) {
        const run = card[suite];
        if (run && (run.status === 'fail' || run.status === 'error')) {
          items.push({ projectId: project.id, projectName: project.name, kind: 'test_fail', severity: suite === 'unit' ? 'high' : 'high', title: `${project.name}: ${suite} ${run.failed}/${run.total} failing`, detail: run.command || '' });
        }
      }
      if (card.regressionSummary.count) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'regression', severity: 'high', title: `${project.name}: ${card.regressionSummary.count} regression(s)`, detail: `worst severity: ${card.regressionSummary.worst}` });
      }
      if (card.taskSummary.blocked) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'blocked_task', severity: 'high', title: `${project.name}: ${card.taskSummary.blocked} blocked task(s)`, detail: '' });
      }
      if (card.git && !card.git.clean && (card.git.changed + card.git.untracked) > 25) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'dirty_workspace', severity: 'medium', title: `${project.name}: ${card.git.changed + card.git.untracked} uncommitted files`, detail: '' });
      }
      const openRisks = card.riskSummary.bySeverity.critical + card.riskSummary.bySeverity.high;
      if (openRisks > 0) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'risk', severity: card.riskSummary.bySeverity.critical ? 'critical' : 'high', title: `${project.name}: ${openRisks} high/critical risk(s)`, detail: '' });
      }
      if (card.drift && card.drift.verdict === 'possible_drift') {
        items.push({ projectId: project.id, projectName: project.name, kind: 'drift', severity: 'medium', title: `${project.name}: possible spec drift`, detail: `${card.drift.count} signal(s)` });
      }
      const pendingReview = this.repo.list('prompts', { project_id: project.id, status: 'generated' });
      if (pendingReview.length) {
        items.push({ projectId: project.id, projectName: project.name, kind: 'pending_review', severity: 'low', title: `${project.name}: ${pendingReview.length} generated prompt(s) not yet executed`, detail: '' });
      }
    }
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return { items: items.sort((a, b) => rank[a.severity] - rank[b.severity]), generatedAt: nowIso() };
  }

  securityModel() {
    return {
      commandRunner: describeSecurityModel(),
      sensitiveFiles: {
        policy: 'Contents of sensitive files are never read, stored, logged or sent to any AI provider.',
        patterns: 'See SENSITIVE_PATTERNS in src/domain/constants.js',
      },
      managedWorkspace: 'READ ONLY — Commander has no code path that writes into a managed workspace (ADR-009).',
      aiDataBoundary: 'Only paths, counts, statistics, short excerpts and failure messages are sent. Secrets are masked before transmission.',
      secretsStorage: 'API keys are stored in the local SQLite settings table and never returned to the frontend.',
    };
  }

  systemInfo() {
    return {
      version: '0.9.0',
      nodeVersion: process.version,
      platform: process.platform,
      dataDir: toPosix(this.dataDir),
      dbFile: toPosix(this.dbFile),
      ftsAvailable: this.db.ftsAvailable,
      os: `${os.type()} ${os.release()}`,
      queue: this.queue.stats(),
      watcher: this.watcher.status(),
      providers: this.providerRegistry.describe(),
      aiStats: this.structured.describeStats(),
      search: this.search.describe(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  close() {
    this.stopBackground();
    this.db.close();
  }
}

export { openDatabase, Repository };
