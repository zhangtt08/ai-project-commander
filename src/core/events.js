/**
 * Timeline / event log — requirement #43.
 * Append-only. Also feeds the Search index and the Dashboard "last activity".
 */
import { newId, nowIso } from './util.js';
import { EVENT_TYPE } from '../domain/constants.js';
import { logger } from './logger.js';

const log = logger.child('events');

const LEVEL_BY_TYPE = {
  [EVENT_TYPE.SCAN_FAILED]: 'error',
  [EVENT_TYPE.BUILD_FAILED]: 'error',
  [EVENT_TYPE.ERROR]: 'error',
  [EVENT_TYPE.REGRESSION_DETECTED]: 'warn',
  [EVENT_TYPE.TEST_REGRESSION]: 'warn',
  [EVENT_TYPE.RISK_DETECTED]: 'warn',
  [EVENT_TYPE.DRIFT_DETECTED]: 'warn',
  [EVENT_TYPE.WORKSPACE_CHANGED]: 'debug',
  [EVENT_TYPE.NOTE]: 'info',
};

export class EventLog {
  constructor({ repo }) { this.repo = repo; }

  record(projectId, type, message, payload = {}, { level = null } = {}) {
    const row = this.repo.insert('project_events', {
      id: newId('evt'),
      project_id: projectId || null,
      ts: nowIso(),
      type,
      level: level || LEVEL_BY_TYPE[type] || 'info',
      message: String(message).slice(0, 1000),
      payload,
    });
    log.debug('recorded', { type, projectId });
    return row;
  }

  timeline(projectId, { limit = 200 } = {}) {
    return this.repo.list('project_events', { project_id: projectId }, { orderBy: 'ts DESC', limit });
  }

  recentGlobal({ limit = 50 } = {}) {
    return this.repo.list('project_events', {}, { orderBy: 'ts DESC', limit });
  }

  lastActivity(projectId) {
    const rows = this.repo.list('project_events', { project_id: projectId }, { orderBy: 'ts DESC', limit: 1 });
    return rows[0] ? rows[0].ts : null;
  }

  /** Diff two analysis runs to emit BUILD_RECOVERED / TEST_REGRESSION style milestones. */
  diffAndEmit(projectId, previous, current) {
    const emitted = [];
    const prevBuild = previous && previous.build_json ? previous.build_json : null;
    if (prevBuild && current.build) {
      if (prevBuild.status !== 'pass' && current.build.status === 'pass') {
        emitted.push(this.record(projectId, EVENT_TYPE.BUILD_RECOVERED, 'Build recovered to PASS', { command: current.build.command }));
      } else if (prevBuild.status === 'pass' && current.build.status === 'fail') {
        emitted.push(this.record(projectId, EVENT_TYPE.BUILD_FAILED, 'Build regressed to FAIL', { command: current.build.command, exitCode: current.build.exitCode }));
      }
    }
    for (const key of ['unit', 'e2e', 'integration']) {
      const prev = previous && previous[`${key}_json`];
      const cur = current[key];
      if (!prev || !cur) continue;
      if (prev.status === 'pass' && cur.status !== 'pass') {
        emitted.push(this.record(projectId, EVENT_TYPE.TEST_REGRESSION, `${key} tests regressed`, { from: prev.status, to: cur.status, failed: cur.failed }));
      }
    }
    return emitted;
  }
}

export { EVENT_TYPE };
