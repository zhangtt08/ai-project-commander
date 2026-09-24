/**
 * ProjectHealthEngine + ProjectProgressEngine — requirements #29 & #30.
 *
 * Both are 100% deterministic. The LLM has no vote here (ADR-002, ADR-006).
 * Every health verdict carries a transparent, inspectable reason list ("Why?").
 */
import {
  PROJECT_HEALTH, BUILD_STATUS, RUN_STATUS, SEVERITY, SEVERITY_RANK, GATE_RESULT,
  PROGRESS_WEIGHTS, STAGE_STATUS, TASK_STATUS, CONFIDENCE,
} from '../../domain/constants.js';
import { clamp, percent } from '../util.js';
import { evCommand, evTest, evSnapshot } from '../evidence.js';

function reason(code, severity, message, { evidence = [], fix = '', magnitude = 1 } = {}) {
  return { code, severity, message, evidence, fix, magnitude };
}

function runHealthLabel(run) {
  if (!run) return 'not run';
  if (run.status === RUN_STATUS.PASS) return `${run.passed}/${run.total} PASS`;
  if (run.status === RUN_STATUS.UNSUPPORTED) return 'unsupported';
  if (run.status === RUN_STATUS.FAIL) return `${run.failed} FAILED`;
  if (run.status === RUN_STATUS.ERROR) return 'error (unparsed)';
  if (run.status === RUN_STATUS.TIMEOUT) return 'timeout';
  return run.status;
}

export class ProjectHealthEngine {
  /**
   * @param {{build?:object, unit?:object, integration?:object, e2e?:object, risks?:Array,
   *          tasks?:Array, git?:object, gate?:object, regressions?:Array, metadata?:object}} input
   */
  evaluate({
    build = null, unit = null, integration = null, e2e = null,
    risks = [], tasks = [], git = null, gate = null, regressions = [],
    metadata = null, criteria = [],
  } = {}) {
    const reasons = [];
    const severity = SEVERITY;
    let score = 100;

    if (build) {
      if (build.status === BUILD_STATUS.FAIL) {
        reasons.push(reason('build_failed', severity.CRITICAL, `Build FAILED — \`${build.command}\` exited ${build.exitCode}.`, {
          evidence: [evCommand(build.command)], fix: 'Fix the build before any further work; nothing else is trustworthy until it is green.', magnitude: 3,
        }));
        score -= 45;
      } else if (build.status === BUILD_STATUS.TIMEOUT) {
        reasons.push(reason('build_timeout', severity.HIGH, `Build timed out after ${build.durationMs}ms.`, { fix: 'Investigate a hang or raise the build timeout in Settings.' }));
        score -= 25;
      } else if (build.status === BUILD_STATUS.UNSUPPORTED) {
        reasons.push(reason('build_unsupported', severity.LOW, `No build command detected (${build.unsupportedReason || 'not applicable'}).`, { fix: 'Add a "build" script to package.json if this project produces an artifact.' }));
      } else if (build.status === BUILD_STATUS.PASS) {
        reasons.push(reason('build_passed', 'info', `Build PASSED in ${build.durationMs}ms.`, { evidence: [evCommand(build.command)] }));
      }
    } else {
      reasons.push(reason('build_unknown', severity.MEDIUM, 'Build has never been run for this project.', { fix: 'Run a full scan to execute the detected build command.' }));
      score -= 10;
    }

    const checkSuite = (label, run, code) => {
      if (!run) {
        reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} have never been run for this project.`, { fix: 'Run a full scan.' }));
        score -= 2;
        return;
      }
      if (run.status === RUN_STATUS.PASS) {
        reasons.push(reason(`${code}_passed`, 'info', `${label}: ${run.passed}/${run.total} PASS (${run.framework}).`, { evidence: [evTest(code)] }));
        return;
      }
      if (run.status === RUN_STATUS.UNSUPPORTED) {
        reasons.push(reason(`${code}_unsupported`, severity.LOW, `${label} are not applicable: ${run.unsupportedReason || 'no command'}.`));
        return;
      }
      if (run.status === RUN_STATUS.FAIL) {
        const ratio = run.total ? run.failed / run.total : 1;
        const sev = code === 'unit' && ratio > 0.3 ? severity.CRITICAL : severity.HIGH;
        reasons.push(reason(`${code}_failed`, sev, `${label}: ${run.failed} of ${run.total} FAILED (${run.framework}).`, {
          evidence: [evTest(code)], fix: run.suite === 'e2e' ? 'Repair the failing end-to-end flows; they block the acceptance gate.' : 'Fix the failing unit tests.', magnitude: 2,
        }));
        score -= code === 'unit' ? 30 : 20;
        return;
      }
      reasons.push(reason(`${code}_error`, severity.HIGH, `${label} run ended with status "${run.status}" (exit ${run.exitCode}).`, { fix: 'Inspect the test command output; the reporter format may be unsupported.' }));
      score -= 15;
    };
    checkSuite('Unit tests', unit, 'unit');
    checkSuite('Integration tests', integration, 'integration');
    checkSuite('E2E tests', e2e, 'e2e');

    const configuredSuites = [unit, integration, e2e].filter((r) => r && r.status !== RUN_STATUS.UNSUPPORTED);
    if (!configuredSuites.length) {
      reasons.push(reason('no_tests_configured', severity.MEDIUM,
        'No runnable test suite was detected in this project (no test script and no recognised test framework).',
        { fix: 'Add a "test" script to package.json, or declare the project as test-less in its specification.' }));
      score -= 12;
    }

    const criticalRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.CRITICAL);
    const highRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.HIGH);
    // Some risks are pure hygiene observations (Commander found secrets and protected them).
    // They must be visible but must not degrade the health verdict.
    const HEALTH_NEUTRAL_RISKS = new Set(['SENSITIVE_FILES_PRESENT', 'NO_LOCKFILE']);
    const mediumRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.MEDIUM && !HEALTH_NEUTRAL_RISKS.has(r.code));
    if (criticalRisks.length) {
      reasons.push(reason('critical_risks', severity.CRITICAL, `${criticalRisks.length} open critical risk(s): ${criticalRisks.map((r) => r.title).join('; ')}.`, {
        evidence: criticalRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: 'Resolve critical risks before advancing.', magnitude: 2,
      }));
      score -= 10 * criticalRisks.length;
    }
    if (highRisks.length) {
      reasons.push(reason('high_risks', severity.HIGH, `${highRisks.length} open high risk(s): ${highRisks.map((r) => r.title).join('; ')}.`, {
        evidence: highRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: 'Triage high risks in the Risk panel.',
      }));
      score -= 5 * highRisks.length;
    }
    if (!criticalRisks.length && !highRisks.length && mediumRisks.length) {
      reasons.push(reason('medium_risks', severity.MEDIUM, `${mediumRisks.length} open medium risk(s).`, { fix: 'Review the Risk panel when convenient.' }));
    }

    const openBlocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
    if (openBlocked.length) {
      reasons.push(reason('blocked_tasks', severity.HIGH, `${openBlocked.length} blocked task(s): ${openBlocked.map((t) => t.title).join('; ').slice(0, 300)}.`, {
        fix: 'Unblock or re-scope these tasks; they will stall the stage.', magnitude: 1.5,
      }));
      score -= 8 * openBlocked.length;
    }

    if (git && git.isRepository) {
      const dirty = git.changedFileCount + (git.untracked ? git.untracked.length : 0);
      if (dirty > 40) {
        reasons.push(reason('very_dirty_workspace', severity.HIGH, `${dirty} files differ from HEAD — a large uncommitted change set hides regressions.`, {
          fix: 'Commit or stash before continuing so Commander can attribute changes to a known state.', magnitude: 1.5,
        }));
        score -= 15;
      } else if (dirty > 10) {
        reasons.push(reason('dirty_workspace', severity.MEDIUM, `${dirty} files differ from HEAD (uncommitted).`, { fix: 'Consider committing a checkpoint.', magnitude: 1 }));
        score -= 5;
      } else if (!git.workingTreeClean) {
        reasons.push(reason('slightly_dirty_workspace', 'info', `${dirty} file(s) modified since the last commit.`, {}));
      }
      if (!git.commitHash && git.isUnborn) {
        reasons.push(reason('no_commits', severity.MEDIUM, 'The repository has no commits yet, so change history cannot be attributed.', { fix: 'Create an initial commit.' }));
      }
    }

    if (regressions && regressions.length) {
      const worst = regressions.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a), regressions[0]);
      reasons.push(reason('regression_detected', worst.severity, `${regressions.length} regression(s) detected since the previous snapshot; worst: ${worst.title}.`, {
        evidence: worst.evidence || [], fix: 'Open the Changes tab to compare the two snapshots and revert or repair the regression.', magnitude: 2,
      }));
      score -= 20;
    }

    if (gate) {
      if (gate.result === GATE_RESULT.FAIL) {
        reasons.push(reason('gate_failed', severity.HIGH, `Acceptance gate FAIL — ${gate.explanation}`, { fix: 'Satisfy the failing gate checks listed in the Overview tab.' }));
        score -= 10;
      } else if (gate.result === GATE_RESULT.BLOCKED) {
        reasons.push(reason('gate_blocked', severity.CRITICAL, `Acceptance gate BLOCKED — ${gate.explanation}`, { fix: 'Resolve the blocking items before advancing.' }));
        score -= 25;
      } else if (gate.result === GATE_RESULT.UNKNOWN) {
        reasons.push(reason('gate_unknown', severity.MEDIUM, 'Acceptance gate is UNKNOWN — insufficient evidence to evaluate.', { fix: 'Declare stages and acceptance criteria, then run a full scan.' }));
        score -= 5;
      } else {
        reasons.push(reason('gate_passed', 'info', 'Acceptance gate PASS — the current stage may advance.', {}));
      }
    }

    if (metadata && metadata.sensitiveCount) {
      // Informational: detection + protection is the desirable outcome, not a defect.
      reasons.push(reason('sensitive_files_present', 'info', `${metadata.sensitiveCount} sensitive file(s) detected and protected (contents were never read, stored or transmitted).`, {
        fix: 'Confirm .gitignore covers them.',
      }));
    }
    if (metadata && metadata.truncated) {
      reasons.push(reason('scan_truncated', severity.MEDIUM, 'The last scan hit the configured file/depth limit, so results are partial.', {
        fix: 'Raise the scan limits in Settings or add ignore patterns.',
      }));
    }

    const hasEvidence = !!build || configuredSuites.length > 0;
    let status;
    if (!hasEvidence) {
      status = PROJECT_HEALTH.UNKNOWN;
      reasons.unshift(reason('no_evidence', severity.MEDIUM, 'No build or test evidence has been collected yet, so health is Unknown.', { fix: 'Run a full scan.' }));
    } else if (reasons.some((r) => r.severity === severity.CRITICAL)) status = PROJECT_HEALTH.CRITICAL;
    else if (reasons.some((r) => r.severity === severity.HIGH)) status = PROJECT_HEALTH.WARNING;
    else if (reasons.some((r) => r.severity === severity.MEDIUM)) status = PROJECT_HEALTH.WARNING;
    else status = PROJECT_HEALTH.HEALTHY;

    // A failing build always dominates.
    if (build && build.status === BUILD_STATUS.FAIL) status = PROJECT_HEALTH.CRITICAL;

    const sortedReasons = reasons.slice().sort((a, b) => SEVERITY_RANK[b.severity === 'info' ? 'low' : b.severity] - SEVERITY_RANK[a.severity === 'info' ? 'low' : a.severity]);
    return {
      status,
      score: clamp(Math.round(score), 0, 100),
      reasons: sortedReasons,
      summary: `${status.toUpperCase()} — ${sortedReasons.filter((r) => r.severity !== 'info').length} issue(s), ${sortedReasons.filter((r) => r.severity === 'info').length} positive signal(s).`,
      evaluatedAt: new Date().toISOString(),
      evidence: [evSnapshot('current')],
    };
  }
}

export class ProjectProgressEngine {
  /**
   * Progress is derived exclusively from stages, tasks and acceptance criteria.
   * If the inputs are insufficient, the result is `unknown` — never an invented percentage.
   */
  compute({ stages = [], tasks = [], criteria = [], weights = PROGRESS_WEIGHTS } = {}) {
    const consideredStages = stages.filter((s) => s.status !== 'cancelled');
    const stageValue = consideredStages.length
      ? consideredStages.reduce((acc, s) => acc + (s.status === STAGE_STATUS.COMPLETED ? 1 : s.status === STAGE_STATUS.IN_PROGRESS ? 0.5 : 0), 0) / consideredStages.length
      : null;

    const countedTasks = tasks.filter((t) => t.status !== TASK_STATUS.CANCELLED);
    const taskValue = countedTasks.length ? countedTasks.filter((t) => t.status === TASK_STATUS.DONE).length / countedTasks.length : null;

    const realCriteria = criteria.filter((c) => c.kind !== 'out_of_scope');
    const acceptanceValue = realCriteria.length ? realCriteria.filter((c) => c.status === 'satisfied').length / realCriteria.length : null;

    const parts = [
      { key: 'stages', value: stageValue, weight: weights.stage, detail: stageValue === null ? 'no stages declared' : `${consideredStages.filter((s) => s.status === STAGE_STATUS.COMPLETED).length}/${consideredStages.length} stages completed` },
      { key: 'tasks', value: taskValue, weight: weights.task, detail: taskValue === null ? 'no tasks in the ledger' : `${countedTasks.filter((t) => t.status === TASK_STATUS.DONE).length}/${countedTasks.length} tasks done` },
      { key: 'acceptance', value: acceptanceValue, weight: weights.acceptance, detail: acceptanceValue === null ? 'no acceptance criteria' : `${realCriteria.filter((c) => c.status === 'satisfied').length}/${realCriteria.length} criteria satisfied` },
    ];

    const available = parts.filter((p) => p.value !== null);
    if (!available.length) {
      return {
        value: null, percent: null, confidence: CONFIDENCE.UNKNOWN, parts,
        reason: 'No stages, tasks or acceptance criteria exist, so progress is Unknown. Commander does not estimate percentages.',
      };
    }

    const totalWeight = available.reduce((a, p) => a + p.weight, 0);
    const value = available.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
    const confidence = available.length === 3 ? CONFIDENCE.HIGH : available.length === 2 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
    return {
      value: Math.round(value * 1000) / 1000,
      percent: percent(value, 1),
      confidence,
      parts,
      reason: available.map((p) => p.detail).join('; '),
      method: `weighted mean of ${available.map((p) => `${p.key}(${p.weight})`).join(', ')}`,
    };
  }
}

export function healthBadge(status) {
  return ({ healthy: 'Healthy', warning: 'Warning', critical: 'Critical', unknown: 'Unknown' })[status] || status;
}

export { runHealthLabel };
