/**
 * AIService — the only place that combines deterministic engines with an LLM.
 *
 * Responsibilities (requirement #48 / #49 / ADR-002):
 *   - build a *facts-only* context from deterministic engine output
 *   - call the structured runner (schema validation + retry + mock fallback)
 *   - persist the result with provider/confidence/evidence so the UI can label it
 *   - never let an LLM opinion override a deterministic fact
 */
import {
  ProjectSummarySchema, RiskAnalysisSchema, TaskExtractionSchema, NextActionSchema,
  ChangeClassificationSchema, DriftAnalysisSchema, StageInferenceSchema,
} from '../../domain/ai-schemas.js';
import { PROJECT_HEALTH, RUN_STATUS, CONFIDENCE } from '../../domain/constants.js';
import { newId, nowIso, truncate } from '../util.js';
import { logger } from '../logger.js';

const log = logger.child('ai.service');

export class AIService {
  constructor({ repo, structured, memoryStore, taskLedger, orchestratorRef }) {
    this.repo = repo;
    this.structured = structured;
    this.memoryStore = memoryStore;
    this.taskLedger = taskLedger;
    this.orchestrator = orchestratorRef;
  }

  #project(projectId) {
    const p = this.repo.get('projects', projectId);
    if (!p) throw new Error(`project not found: ${projectId}`);
    return p;
  }

  /** Assemble a facts-only context. No source code beyond short excerpts, no secrets. */
  buildFacts(projectId, { maxTodoFiles = 10 } = {}) {
    const project = this.#project(projectId);
    const meta = project.metadata || {};
    const metadata = meta.metadata || null;
    const git = meta.git || null;
    const tests = meta.tests || {};
    const risks = this.repo.list('risks', { project_id: projectId });
    const tasks = this.repo.list('tasks', { project_id: projectId });
    const criteria = this.repo.list('acceptance_criteria', { project_id: projectId });
    const specs = this.repo.list('specifications', { project_id: projectId });
    const stages = this.repo.list('stages', { project_id: projectId }, { orderBy: 'order_index' });
    const regressions = this.repo.list('regressions', { project_id: projectId }, { orderBy: 'ts DESC', limit: 10 });
    const failedCases = [];
    for (const suite of ['unit', 'integration', 'e2e']) {
      const last = this.repo.list('test_runs', { project_id: projectId, suite }, { orderBy: 'ts DESC', limit: 1 })[0];
      if (!last || (last.status !== 'fail' && last.status !== 'error')) continue;
      for (const c of this.repo.list('test_case_results', { test_run_id: last.id }).slice(0, 10)) {
        failedCases.push({ suite, name: c.name, file: c.file, errorSummary: c.error_summary });
      }
    }
    return {
      projectName: project.name,
      project,
      metadata,
      git,
      build: meta.build || null,
      unit: tests.unit || null,
      integration: tests.integration || null,
      e2e: tests.e2e || null,
      specs,
      criteria,
      tasks,
      risks,
      regressions,
      stages,
      gate: meta.gate || null,
      drift: meta.drift || null,
      health: meta.health || { status: project.health, reasons: [] },
      progress: meta.progress || project.progress,
      failedCases,
      relevantFiles: this.#relevantFiles(metadata, git, failedCases),
      todoSummary: (metadata && metadata.todos ? metadata.todos.slice(0, maxTodoFiles) : []),
    };
  }

  #relevantFiles(metadata, git, failedCases) {
    const files = new Set();
    for (const c of failedCases) if (c.file) files.add(c.file);
    if (git) {
      for (const p of (git.modified || []).slice(0, 12)) files.add(p);
      for (const p of (git.deleted || []).slice(0, 5)) files.add(p);
    }
    if (metadata) {
      for (const d of (metadata.specCandidates || []).slice(0, 5)) files.add(d);
      for (const f of (metadata.largestFiles || []).slice(0, 5)) files.add(f.path);
      for (const d of Object.entries(metadata.directories || {}).filter(([, v]) => v).slice(0, 5)) files.add(`${d[0]}/`);
    }
    return [...files].slice(0, 25);
  }

  async summarize(projectId) {
    const facts = this.buildFacts(projectId);
    const result = await this.structured.run({
      schemaName: 'projectSummary',
      schema: ProjectSummarySchema,
      system: 'You summarise software projects strictly from the supplied evidence. Reply with JSON only. Never invent facts.',
      prompt: [
        'Summarise this project for a new engineer.',
        `Name: ${facts.projectName}`,
        `Workspace: ${facts.project.workspace_path}`,
        `Stack evidence: ${JSON.stringify({ language: facts.metadata && facts.metadata.primaryLanguage, frameworks: facts.metadata && facts.metadata.frameworks, packageManager: facts.metadata && facts.metadata.packageManager })}`,
        `Specs: ${JSON.stringify((facts.specs || []).map((s) => ({ path: s.path, kind: s.kind, title: s.title })))}`,
        `Stage: ${(facts.stages.find((s) => s.status === 'in_progress') || facts.stages[facts.stages.length - 1] || {}).name || 'unknown'}`,
        `Test signals: ${JSON.stringify({ unit: facts.unit, e2e: facts.e2e, build: facts.build })}`,
      ].join('\n'),
      context: facts,
    });
    this.repo.update('projects', projectId, {
      metadata: { ...(facts.project.metadata || {}), aiSummary: { ...result.data, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, generatedAt: nowIso() } },
    });
    return result;
  }

  async enrichRisks(projectId) {
    const facts = this.buildFacts(projectId);
    const result = await this.structured.run({
      schemaName: 'riskAnalysis',
      schema: RiskAnalysisSchema,
      system: 'You explain engineering risk using ONLY the supplied evidence. Reply with JSON only. If the evidence is insufficient, return fewer risks.',
      prompt: [
        'Explain the most important risks for this project.',
        `Deterministic risks already detected: ${JSON.stringify(facts.risks.map((r) => ({ code: r.code, title: r.title, severity: r.severity })))}`,
        `Build: ${JSON.stringify(facts.build)}`,
        `Unit: ${JSON.stringify(facts.unit)}`,
        `E2E: ${JSON.stringify(facts.e2e)}`,
        `Regressions: ${JSON.stringify(facts.regressions.map((r) => ({ type: r.type, title: r.title })))}`,
        `Gate: ${JSON.stringify(facts.gate)}`,
        'Do not contradict the deterministic severities. Add explanation and suggested actions.',
      ].join('\n'),
      context: facts,
    });
    // AI risks are additive and clearly labelled; deterministic risks are never removed.
    for (const r of result.data.risks || []) {
      const code = `AI_${String(r.title).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30)}`;
      const existing = this.repo.list('risks', { project_id: projectId, code });
      if (existing.length) continue;
      this.repo.insert('risks', {
        id: newId('rsk'), project_id: projectId, code, title: truncate(r.title, 200), severity: r.severity,
        description: truncate(r.description, 1500), suggested_action: truncate(r.suggestedAction || '', 800),
        status: 'open', source: result.provider === 'mock' ? 'ai_mock' : 'ai', confidence: r.confidence || CONFIDENCE.MEDIUM,
        evidence: r.evidence || [], fingerprint: code,
      });
    }
    return result;
  }

  async extractTasks(projectId) {
    const facts = this.buildFacts(projectId);
    const result = await this.structured.run({
      schemaName: 'taskExtraction',
      schema: TaskExtractionSchema,
      system: 'You extract actionable engineering tasks from specification text and current failures. Reply with JSON only.',
      prompt: [
        'Extract tasks that are implied by the specification and current failures but not yet tracked.',
        `Existing tasks: ${JSON.stringify(facts.tasks.map((t) => t.title))}`,
        `Unmet criteria: ${JSON.stringify(facts.criteria.filter((c) => c.status === 'unmet').map((c) => c.text))}`,
        `Failures: ${JSON.stringify(facts.failedCases)}`,
      ].join('\n'),
      context: facts,
    });
    const created = [];
    for (const t of result.data.tasks || []) {
      const out = this.taskLedger.addManual(projectId, {
        title: truncate(t.title, 300),
        description: `${truncate(t.description || '', 900)}\n\n[AI-extracted via ${result.provider}${result.fallbackUsed ? ' (fallback)' : ''}; confidence: ${t.confidence || 'medium'}]`,
      });
      if (out.created) created.push(out.task);
    }
    return { ...result, created };
  }

  /** Deterministic next action + optional AI enrichment (never changes the chosen objective). */
  async nextAction(projectId, { engine }) {
    const facts = this.buildFacts(projectId);
    const deterministic = engine.decide({
      build: facts.build, unit: facts.unit, integration: facts.integration, e2e: facts.e2e,
      risks: facts.risks, regressions: facts.regressions, drift: facts.drift, gate: facts.gate,
      tasks: facts.tasks, stages: facts.stages,
      currentStage: facts.stages.find((s) => s.id === facts.project.current_stage_id) || facts.stages.find((s) => s.status === 'in_progress') || facts.stages[0] || null,
      specs: facts.specs, metadata: facts.metadata, git: facts.git, failedCases: facts.failedCases,
    });

    const result = await this.structured.run({
      schemaName: 'nextAction',
      schema: NextActionSchema,
      system: 'You must NOT invent a different objective. Rewrite and sharpen the deterministically chosen objective using the supplied evidence. Reply with JSON only.',
      prompt: [
        'Sharpen this next-action recommendation.',
        JSON.stringify(deterministic, null, 2),
        '',
        'Keep objective, priority and verification commands consistent with the deterministic decision. Improve the wording of reason/scope/acceptance and add relevant files.',
      ].join('\n'),
      context: { ...facts, deterministic },
    });

    const merged = {
      ...deterministic,
      objective: result.data.objective || deterministic.objective,
      reason: result.data.reason || deterministic.reason,
      scope: (result.data.scope && result.data.scope.length) ? result.data.scope : deterministic.scope,
      relevantFiles: (result.data.relevantFiles && result.data.relevantFiles.length) ? result.data.relevantFiles : deterministic.relevantFiles,
      constraints: (result.data.constraints && result.data.constraints.length) ? result.data.constraints : deterministic.constraints,
      acceptanceCriteria: (result.data.acceptanceCriteria && result.data.acceptanceCriteria.length) ? result.data.acceptanceCriteria : deterministic.acceptanceCriteria,
      verificationCommands: (result.data.verificationCommands && result.data.verificationCommands.length) ? result.data.verificationCommands : deterministic.verificationCommands,
      risks: (result.data.risks && result.data.risks.length) ? result.data.risks : deterministic.risks,
      priority: result.data.priority || deterministic.priority,
      confidence: result.fallbackUsed ? deterministic.confidence : (result.data.confidence || deterministic.confidence),
      aiProvider: result.provider,
      aiFallbackUsed: result.fallbackUsed,
      deterministicRule: deterministic.rule,
    };

    this.repo.update('projects', projectId, {
      metadata: { ...(facts.project.metadata || {}), nextAction: merged },
    });
    this.repo.insert('evidence_refs', {
      id: newId('evd'), project_id: projectId, owner_table: 'next_action', owner_id: merged.id,
      type: 'command', ref: (merged.verificationCommands || []).join(' | ').slice(0, 500) || 'none', note: 'verification commands',
      created_at: nowIso(),
    });
    return merged;
  }

  async classifyChanges(projectId, changes) {
    const facts = this.buildFacts(projectId);
    return this.structured.run({
      schemaName: 'changeClassification',
      schema: ChangeClassificationSchema,
      system: 'Classify code changes. Reply with JSON only.',
      prompt: `Classify these changed files. Deterministic classification is provided as a hint; only override it when the file content clearly disagrees.\n${JSON.stringify(changes, null, 2)}`,
      context: { ...facts, changes },
    });
  }

  async analyzeDrift(projectId) {
    const facts = this.buildFacts(projectId);
    return this.structured.run({
      schemaName: 'driftAnalysis',
      schema: DriftAnalysisSchema,
      system: 'You assess whether the codebase has drifted from its specification. Be conservative: report "possible drift" unless evidence is conclusive. Reply with JSON only.',
      prompt: [
        'Assess specification drift.',
        `Goals/requirements: ${JSON.stringify(facts.criteria.filter((c) => c.kind === 'requirement').slice(0, 25).map((c) => ({ ref: c.requirement_ref, text: c.text })))}`,
        `Deterministic drift signals: ${JSON.stringify((facts.drift && facts.drift.drifts) || [])}`,
        `Recent commits: ${JSON.stringify((facts.git && facts.git.recentCommits || []).slice(0, 10).map((c) => c.subject))}`,
        `Changed files: ${JSON.stringify(facts.relevantFiles)}`,
      ].join('\n'),
      context: facts,
    });
  }

  /** One-shot enrichment used by the AI_ANALYSIS job. */
  async enrichProject(projectId) {
    const summary = await this.summarize(projectId);
    let risks = null;
    let tasks = null;
    try { risks = await this.enrichRisks(projectId); } catch (err) { log.warn('risk_enrichment_failed', { error: err.message }); }
    try { tasks = await this.extractTasks(projectId); } catch (err) { log.warn('task_extraction_failed', { error: err.message }); }
    return {
      summary: { provider: summary.provider, fallbackUsed: summary.fallbackUsed },
      risks: risks ? { count: (risks.data.risks || []).length, provider: risks.provider } : null,
      tasks: tasks ? { created: tasks.created.length, provider: tasks.provider } : null,
    };
  }

  providerInfo() {
    return this.structured.describeStats();
  }
}

export { PROJECT_HEALTH, RUN_STATUS, StageInferenceSchema };
