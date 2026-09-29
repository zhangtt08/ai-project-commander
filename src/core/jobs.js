/**
 * AnalysisQueue + WorkspaceWatcher — requirements #40 & #41.
 *
 * Queue: bounded concurrency, per-job timeout, retry with attempt counter, cancellation.
 * Watcher: debounced, ignores generated/vendor paths, rate-limited, and NEVER calls an LLM
 *          directly — it only emits a `workspace_changed` event (ADR-010).
 */
import fs from 'node:fs';
import { JOB_TYPE, JOB_STATUS, EVENT_TYPE } from '../domain/constants.js';
import { newId, nowIso, sleep, sleepCancellable } from './util.js';
import { expandShortPath } from './fs-safe.js';
import { logger } from './logger.js';

const qlog = logger.child('queue');
const wlog = logger.child('watcher');

export class AnalysisQueue {
  constructor({ repo, concurrency = 2, events = null }) {
    this.repo = repo;
    this.concurrency = concurrency;
    this.events = events;
    this.handlers = new Map();
    this.running = new Map();
    this.cancelled = new Set();
    this.timer = null;
    this.stopped = true;
  }

  register(type, handler) {
    if (!JOB_TYPE[type.toUpperCase()]) throw new Error(`unknown job type: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }

  enqueue({ projectId, type, payload = {}, priority = 5, timeoutMs = 600000, maxAttempts = 2 }) {
    const job = this.repo.insert('analysis_jobs', {
      id: newId('job'),
      project_id: projectId || null,
      type,
      status: JOB_STATUS.QUEUED,
      priority,
      attempts: 0,
      max_attempts: maxAttempts,
      timeout_ms: timeoutMs,
      payload,
      result: {},
      error: '',
    });
    qlog.info('enqueued', { type, projectId, id: job.id });
    if (!this.stopped) this.#tick();
    return job;
  }

  start(intervalMs = 300) {
    if (!this.stopped) return this;
    this.stopped = false;
    this.timer = setInterval(() => this.#tick(), intervalMs);
    if (this.timer.unref) this.timer.unref();
    qlog.info('started', { concurrency: this.concurrency });
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  cancel(jobId) {
    this.cancelled.add(jobId);
    const job = this.repo.get('analysis_jobs', jobId);
    if (job && (job.status === JOB_STATUS.QUEUED || job.status === JOB_STATUS.RUNNING)) {
      this.repo.update('analysis_jobs', jobId, { status: JOB_STATUS.CANCELLED, finished_at: nowIso(), error: 'cancelled by user' });
    }
    return true;
  }

  list({ status = null, limit = 50 } = {}) {
    const rows = this.repo.list('analysis_jobs', status ? { status } : {}, { orderBy: 'created_at DESC', limit });
    return rows.map((j) => ({ ...j, payload: undefined }));
  }

  stats() {
    const all = this.repo.list('analysis_jobs', {}, { orderBy: 'created_at DESC', limit: 500 });
    const byStatus = {};
    for (const j of all) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    return { total: all.length, byStatus, running: this.running.size, concurrency: this.concurrency, paused: this.stopped };
  }

  #tick() {
    if (this.running.size >= this.concurrency) return;
    const queued = this.repo.list('analysis_jobs', { status: JOB_STATUS.QUEUED }, { orderBy: 'priority ASC, created_at ASC', limit: 10 });
    for (const job of queued) {
      if (this.running.size >= this.concurrency) break;
      if (this.running.has(job.id)) continue;
      this.#run(job);
    }
  }

  async #run(job) {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.repo.update('analysis_jobs', job.id, { status: JOB_STATUS.FAILED, error: `no handler registered for ${job.type}`, finished_at: nowIso() });
      return;
    }
    this.running.set(job.id, true);
    this.repo.update('analysis_jobs', job.id, { status: JOB_STATUS.RUNNING, started_at: nowIso(), attempts: job.attempts + 1 });
    const started = Date.now();
    const timeout = sleepCancellable(job.timeout_ms || 600000);
    try {
      const result = await Promise.race([
        handler(job.payload || {}, job),
        timeout.promise.then(() => { throw new Error(`job timed out after ${job.timeout_ms}ms`); }),
      ]);
      if (this.cancelled.has(job.id)) throw new Error('cancelled by user');
      this.repo.update('analysis_jobs', job.id, {
        status: JOB_STATUS.COMPLETED, finished_at: nowIso(), result: result || {}, error: '',
      });
      qlog.info('completed', { id: job.id, type: job.type, durationMs: Date.now() - started });
    } catch (err) {
      const attempts = (this.repo.get('analysis_jobs', job.id) || {}).attempts || 1;
      const retryable = attempts < (job.max_attempts || 2) && !/cancelled/.test(err.message);
      this.repo.update('analysis_jobs', job.id, {
        status: retryable ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED,
        error: err.message.slice(0, 500),
        finished_at: retryable ? null : nowIso(),
      });
      qlog.warn(retryable ? 'retrying' : 'failed', { id: job.id, type: job.type, error: err.message, attempt: attempts });
    } finally {
      timeout.cancel();
      this.running.delete(job.id);
      this.cancelled.delete(job.id);
    }
  }

  async drain({ timeoutMs = 120000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const pending = this.repo.count('analysis_jobs', { status: JOB_STATUS.QUEUED }) + this.running.size;
      if (pending === 0) return true;
      await sleep(60);
    }
    return false;
  }
}

const WATCH_IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|out|coverage|\.next|\.cache|\.turbo|\.venv|__pycache__)([\\/]|$)/i;

export class WorkspaceWatcher {
  /**
   * @param {{events:object, queue?:object, onSkip?:(p:string)=>void}} deps
   */
  constructor({ events, queue = null, debounceMs = 500, maxEventsPerMinute = 120, autoQuickScan = false } = {}) {
    this.events = events;
    this.queue = queue;
    this.debounceMs = debounceMs;
    this.maxEventsPerMinute = maxEventsPerMinute;
    this.autoQuickScan = autoQuickScan;
    this.watchers = new Map();
    this.timers = new Map();
    this.windowStart = Date.now();
    this.windowCount = 0;
    this.dropped = 0;
  }

  watch(project) {
    if (this.watchers.has(project.id)) return { watching: true, already: true };
    let watcher;
    try {
      watcher = fs.watch(expandShortPath(project.workspace_path), { recursive: true, persistent: false }, (eventType, filename) => {
        this.#onChange(project, filename || '');
      });
    } catch (err) {
      wlog.warn('watch_failed', { projectId: project.id, error: err.message });
      return { watching: false, error: err.message };
    }
    this.watchers.set(project.id, watcher);
    wlog.info('watching', { projectId: project.id, path: project.workspace_path });
    return { watching: true };
  }

  unwatch(projectId) {
    const w = this.watchers.get(projectId);
    if (w) { try { w.close(); } catch { /* noop */ } this.watchers.delete(projectId); }
    const t = this.timers.get(projectId);
    if (t) { clearTimeout(t); this.timers.delete(projectId); }
    return { watching: false };
  }

  unwatchAll() {
    for (const id of [...this.watchers.keys()]) this.unwatch(id);
  }

  status() {
    return {
      watching: [...this.watchers.keys()],
      debounceMs: this.debounceMs,
      maxEventsPerMinute: this.maxEventsPerMinute,
      droppedInWindow: this.dropped,
      autoQuickScan: this.autoQuickScan,
    };
  }

  #onChange(project, filename) {
    if (!filename || WATCH_IGNORE.test(filename)) return;
    const now = Date.now();
    if (now - this.windowStart > 60000) { this.windowStart = now; this.windowCount = 0; this.dropped = 0; }
    this.windowCount += 1;
    if (this.windowCount > this.maxEventsPerMinute) { this.dropped += 1; return; }

    const existing = this.timers.get(project.id);
    if (existing) clearTimeout(existing);
    this.timers.set(project.id, setTimeout(() => {
      this.timers.delete(project.id);
      // Only an event — never an LLM call (ADR-010).
      this.events.record(project.id, EVENT_TYPE.WORKSPACE_CHANGED, `Workspace changed: ${filename}`, { file: filename });
      if (this.autoQuickScan && this.queue) {
        this.queue.enqueue({ projectId: project.id, type: JOB_TYPE.QUICK_SCAN, payload: { projectId: project.id, reason: 'watcher' }, priority: 8, timeoutMs: 120000 });
      }
    }, this.debounceMs));
  }
}
