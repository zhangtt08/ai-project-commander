/**
 * TaskLedger — requirement #24.
 * Aggregates tasks from six sources with provenance, confidence and evidence.
 * Idempotent: each task carries a fingerprint so rescans update instead of duplicating.
 */
import { TASK_SOURCE, TASK_STATUS, CONFIDENCE, TASK_PRIORITY } from '../../domain/constants.js';
import { newId, sha1, nowIso } from '../util.js';
import { evFile, evSpec, evSession } from '../evidence.js';
import { logger } from '../logger.js';

const log = logger.child('task-ledger');

function fp(source, title) {
  return sha1(`${source}::${String(title).toLowerCase().replace(/\s+/g, ' ').trim()}`).slice(0, 16);
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export class TaskLedger {
  constructor({ repo } = {}) { this.repo = repo; }

  /** Derive task candidates from every deterministic source. */
  derive({ specs = [], criteria = [], metadata = null, sessions = [] } = {}) {
    const tasks = [];
    const seen = new Set();
    const push = (t) => {
      const key = fp(t.source, t.title);
      if (seen.has(key)) return;
      seen.add(key);
      tasks.push({ ...t, fingerprint: key });
    };

    for (const c of criteria) {
      if (c.kind === 'out_of_scope') continue;
      if (c.kind === 'checkbox' && c.status === 'satisfied') continue;
      push({
        title: c.kind === 'checkbox' ? `Complete acceptance criterion: ${c.text}` : `Implement requirement ${c.requirement_ref || ''}: ${c.text}`,
        description: `Derived from ${c.spec_path} (${c.kind}).`,
        priority: c.kind === 'checkbox' ? TASK_PRIORITY.P1 : TASK_PRIORITY.P2,
        status: TASK_STATUS.TODO,
        source: TASK_SOURCE.SPEC,
        confidence: CONFIDENCE.HIGH,
        evidence: c.evidence || [evSpec(c.spec_path)],
      });
    }

    for (const spec of specs) {
      const parsed = spec.parsed || {};
      for (const cb of parsed.checkboxes || []) {
        if (cb.checked) continue;
        if ((parsed.acceptance || []).some((a) => a.line === cb.line)) continue;
        push({
          title: cb.text,
          description: `Unchecked checkbox in ${spec.path} (line ${cb.line}).`,
          priority: TASK_PRIORITY.P2,
          status: TASK_STATUS.TODO,
          source: TASK_SOURCE.CHECKBOX,
          confidence: CONFIDENCE.HIGH,
          evidence: [evFile(spec.path, `line ${cb.line}`)],
        });
      }
      for (const sec of ['requirements']) {
        for (const item of parsed[sec] || []) {
          const covered = criteria.some((c) => c.requirement_ref && item.ref && c.requirement_ref === item.ref);
          if (!covered) continue;
        }
      }
    }

    if (metadata && Array.isArray(metadata.todos)) {
      for (const m of metadata.todos) {
        push({
          title: `${m.kind}: ${m.text}`,
          description: `Marker found in ${m.path} at line ${m.line}.`,
          priority: m.kind === 'FIXME' ? TASK_PRIORITY.P1 : TASK_PRIORITY.P2,
          status: TASK_STATUS.TODO,
          source: TASK_SOURCE.TODO_COMMENT,
          confidence: CONFIDENCE.HIGH,
          evidence: [evFile(m.path, `line ${m.line}`)],
        });
      }
    }

    for (const s of sessions) {
      const files = (s.changed_files || []).slice(0, 10);
      for (const f of files) {
        push({
          title: `Review agent change in ${f}`,
          description: `File was touched by an imported agent session (${s.provider}).`,
          priority: TASK_PRIORITY.P3,
          status: TASK_STATUS.TODO,
          source: TASK_SOURCE.AGENT_LOG,
          confidence: CONFIDENCE.MEDIUM,
          evidence: [evSession(s.id), evFile(f)],
        });
      }
    }

    log.info('derived', { total: tasks.length });
    return tasks;
  }

  /** Persist tasks, updating existing ones by fingerprint and never clobbering `done`. */
  sync(projectId, tasks, { replaceSources = [TASK_SOURCE.SPEC, TASK_SOURCE.CHECKBOX, TASK_SOURCE.TODO_COMMENT] } = {}) {
    if (!this.repo) throw new Error('TaskLedger requires a repository');
    const existing = this.repo.list('tasks', { project_id: projectId });
    const byFp = new Map(existing.map((t) => [t.fingerprint, t]));
    let created = 0;
    let updated = 0;
    const touched = [];

    for (const t of tasks) {
      const found = byFp.get(t.fingerprint);
      if (found) {
        const patch = {};
        if (found.title !== t.title) patch.title = t.title;
        if (found.description !== t.description) patch.description = t.description;
        if (found.evidence !== t.evidence) patch.evidence = t.evidence;
        if (Object.keys(patch).length) {
          this.repo.update('tasks', found.id, patch);
          updated += 1;
        }
        touched.push(found.id);
        continue;
      }
      const row = this.repo.insert('tasks', {
        id: newId('tsk'),
        project_id: projectId,
        stage_id: null,
        title: t.title.slice(0, 300),
        description: t.description || '',
        priority: t.priority || TASK_PRIORITY.P2,
        status: t.status || TASK_STATUS.TODO,
        source: t.source,
        confidence: t.confidence || CONFIDENCE.MEDIUM,
        evidence: t.evidence || [],
        fingerprint: t.fingerprint,
      });
      byFp.set(t.fingerprint, row);
      touched.push(row.id);
      created += 1;
    }

    // Auto-derived tasks that no longer exist in the source disappear; manual/AI tasks are kept.
    let removed = 0;
    for (const t of existing) {
      if (!replaceSources.includes(t.source)) continue;
      if (touched.includes(t.id)) continue;
      if (t.status === TASK_STATUS.IN_PROGRESS || t.status === TASK_STATUS.BLOCKED) continue;
      this.repo.remove('tasks', t.id);
      removed += 1;
    }

    log.info('synced', { created, updated, removed });
    return { created, updated, removed, total: this.repo.count('tasks', { project_id: projectId }) };
  }

  addManual(projectId, { title, description = '', priority = TASK_PRIORITY.P2, stageId = null }) {
    const fingerprint = fp(TASK_SOURCE.MANUAL, title);
    const existing = this.repo.list('tasks', { project_id: projectId }).find((t) => t.fingerprint === fingerprint);
    if (existing) return { task: existing, created: false };
    const row = this.repo.insert('tasks', {
      id: newId('tsk'),
      project_id: projectId,
      stage_id: stageId,
      title: title.slice(0, 300),
      description,
      priority,
      status: TASK_STATUS.TODO,
      source: TASK_SOURCE.MANUAL,
      confidence: CONFIDENCE.HIGH,
      evidence: [],
      fingerprint,
    });
    return { task: row, created: true };
  }

  setStatus(taskId, status) {
    return this.repo.update('tasks', taskId, { status });
  }

  summary(projectId) {
    const tasks = this.repo.list('tasks', { project_id: projectId });
    const byStatus = {};
    const bySource = {};
    const byPriority = {};
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      bySource[t.source] = (bySource[t.source] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }
    const done = byStatus[TASK_STATUS.DONE] || 0;
    return {
      total: tasks.length,
      byStatus,
      bySource,
      byPriority,
      done,
      open: tasks.length - done - (byStatus[TASK_STATUS.CANCELLED] || 0),
      blocked: byStatus[TASK_STATUS.BLOCKED] || 0,
      inProgress: byStatus[TASK_STATUS.IN_PROGRESS] || 0,
      generatedAt: nowIso(),
    };
  }
}

export { slug };
