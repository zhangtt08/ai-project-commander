/**
 * ProjectMemory (versioned) + Architecture Decision Records — requirements #33 & #34.
 * A new memory version never overwrites an older one; history is append-only.
 */
import { newId, nowIso } from '../util.js';
import { logger } from '../logger.js';

const log = logger.child('memory');

export const ADR_STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded'];

export class ProjectMemoryStore {
  constructor({ repo }) { this.repo = repo; }

  latest(projectId) {
    const rows = this.repo.list('project_memory', { project_id: projectId }, { orderBy: 'version DESC', limit: 1 });
    return rows[0] || null;
  }

  history(projectId) {
    return this.repo.list('project_memory', { project_id: projectId }, { orderBy: 'version DESC' });
  }

  /** Build a fresh memory document from the current analysis. */
  compose({
    project, metadata, git, specs, criteria, tasks, stages, risks, regressions, gate, health, progress,
    summary = '', constraints = [],
  }) {
    const acceptedAdrs = this.repo.list('architecture_decisions', { project_id: project.id, status: 'accepted' });
    return {
      purpose: summary || project.description || (metadata && metadata.packageJson && metadata.packageJson.name) || project.name,
      architecture: {
        language: metadata ? metadata.primaryLanguage : 'unknown',
        framework: metadata ? metadata.framework : 'unknown',
        frameworks: metadata ? metadata.frameworks : [],
        packageManager: metadata ? metadata.packageManager : 'unknown',
        directories: metadata ? metadata.directories : {},
        configFiles: metadata ? metadata.configFiles : {},
        appDecisions: acceptedAdrs.map((a) => ({ title: a.title, decision: a.decision })),
      },
      businessRules: (specs || []).flatMap((s) => ((s.parsed && s.parsed.requirements) || []).map((r) => ({ ref: r.ref || '', text: r.text, source: s.path }))).slice(0, 60),
      outOfScope: (specs || []).flatMap((s) => ((s.parsed && s.parsed.outOfScope) || []).map((o) => o.text)).slice(0, 30),
      currentStage: stages && stages.length ? (stages.find((s) => s.status === 'in_progress') || stages[stages.length - 1]).name : 'unknown',
      stageStatuses: (stages || []).map((s) => ({ name: s.name, status: s.status })),
      importantConstraints: [
        ...((specs || []).flatMap((s) => ((s.parsed && s.parsed.constraints) || []).map((c) => c.text))),
        ...constraints,
      ].slice(0, 30),
      knownIssues: (risks || []).filter((r) => r.status === 'open').slice(0, 25).map((r) => ({ code: r.code, title: r.title, severity: r.severity })),
      recentChanges: git && git.isRepository
        ? {
          branch: git.branch,
          head: git.commitShort,
          clean: git.workingTreeClean,
          changedFiles: git.changedFileCount,
          untracked: (git.untracked || []).length,
          recentCommits: (git.recentCommits || []).slice(0, 8).map((c) => ({ hash: c.hash, subject: c.subject, date: c.date })),
        }
        : { note: 'not a git repository' },
      acceptance: {
        total: (criteria || []).length,
        satisfied: (criteria || []).filter((c) => c.status === 'satisfied').length,
        unmet: (criteria || []).filter((c) => c.status === 'unmet').length,
      },
      openTaskCount: (tasks || []).filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
      health: health ? health.status : 'unknown',
      progress: progress ? progress.percent : null,
      gate: gate ? { result: gate.result, explanation: gate.explanation } : null,
      regressions: (regressions || []).map((r) => ({ type: r.type, severity: r.severity, title: r.title })),
      generatedAt: nowIso(),
    };
  }

  /** Persist a new version unless the content is byte-identical to the latest. */
  version(projectId, content, { author = 'system', note = '' } = {}) {
    const last = this.latest(projectId);
    const serialized = JSON.stringify(content);
    if (last && JSON.stringify(last.content) === serialized) {
      return { memory: last, created: false, version: last.version };
    }
    const version = last ? last.version + 1 : 1;
    const row = this.repo.insert('project_memory', {
      id: newId('mem'),
      project_id: projectId,
      version,
      content,
      author,
      note,
    });
    log.info('versioned', { projectId, version, created: true });
    return { memory: row, created: true, version };
  }

  /** Human/agent-readable rendering — used by the Prompt Generator and Handoff Package. */
  render(memory, { maxChars = 6000 } = {}) {
    if (!memory) return '(no project memory recorded yet)';
    const c = memory.content || {};
    const arch = c.architecture || {};
    const recent = c.recentChanges || {};
    const lines = [
      `# Project Memory v${memory.version} (${memory.created_at})`,
      ``,
      `## Purpose`,
      c.purpose || '(not recorded)',
      ``,
      `## Architecture`,
      `- Language: ${arch.language || 'unknown'}`,
      `- Framework: ${arch.framework || 'unknown'}`,
      `- Other frameworks: ${(arch.frameworks || []).join(', ') || 'none'}`,
      `- Package manager: ${arch.packageManager || 'unknown'}`,
      ``,
      `## Current Stage`,
      c.currentStage || 'unknown',
      ...(c.stageStatuses || []).map((s) => `- ${s.name}: ${s.status}`),
      ``,
      `## Business Rules`,
      ...((c.businessRules || []).slice(0, 20).map((r) => `- ${r.ref ? `[${r.ref}] ` : ''}${r.text}`)),
      ``,
      `## Important Constraints`,
      ...((c.importantConstraints || []).slice(0, 10).map((x) => `- ${x}`)),
      ``,
      `## Known Issues`,
      ...((c.knownIssues || []).slice(0, 15).map((i) => `- (${i.severity}) ${i.title}`)),
      ``,
      `## Recent Changes`,
      `- Branch: ${recent.branch || 'n/a'} @ ${recent.head || 'n/a'}`,
      ...(recent.recentCommits || []).slice(0, 5).map((x) => `- ${x.hash} ${x.subject}`),
      ``,
      `## Decisions`,
      ...((arch.appDecisions || []).map((d) => `- ${d.title}: ${d.decision}`)),
    ];
    const text = lines.join('\n');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [truncated at ${maxChars} chars]` : text;
  }
}

export class AdrStore {
  constructor({ repo }) { this.repo = repo; }

  create(projectId, { title, context = '', decision = '', consequences = '', status = 'proposed' }) {
    return this.repo.insert('architecture_decisions', {
      id: newId('adr'),
      project_id: projectId,
      title,
      status: ADR_STATUSES.includes(status) ? status : 'proposed',
      context,
      decision,
      consequences,
      superseded_by: null,
    });
  }

  setStatus(adrId, status, { supersededBy = null } = {}) {
    if (!ADR_STATUSES.includes(status)) throw new Error(`invalid ADR status: ${status}`);
    return this.repo.update('architecture_decisions', adrId, { status, superseded_by: supersededBy });
  }

  list(projectId) {
    return this.repo.list('architecture_decisions', { project_id: projectId }, { orderBy: 'created_at DESC' });
  }

  /** Machine-readable ADR seed for a managed project's own decisions. */
  static seedFromProject(project) {
    return [
      {
        title: `${project.name}: technology baseline`,
        status: 'accepted',
        context: 'Commander detected the stack during scanning.',
        decision: `Primary language ${project.primaryLanguage}, framework ${project.framework}, package manager ${project.packageManager}.`,
        consequences: 'Analysis engines use this baseline to choose build/test commands.',
      },
    ];
  }
}
