/**
 * NextActionEngine — requirement #37. The core of the product.
 *
 * A fully deterministic decision chain over real evidence. The LLM may later re-word the
 * action, but the choice of WHAT to do next is computed here and is reproducible.
 */
import {
  BUILD_STATUS, RUN_STATUS, SEVERITY, SEVERITY_RANK, GATE_RESULT, TASK_STATUS, TASK_PRIORITY,
  STAGE_STATUS, CONFIDENCE,
} from '../../domain/constants.js';
import { evCommand, evTest, evSnapshot, evSpec, evFile, evTask } from '../evidence.js';
import { newId, nowIso } from '../util.js';

export const NEXT_ACTION_RULES = [
  'build_failed', 'unit_failed', 'e2e_failed', 'integration_failed',
  'critical_risk', 'regression', 'drift', 'blocked_task', 'gate_failed',
  'open_task', 'next_stage', 'no_spec',
];

function action({ rule, priority, objective, reason, scope = [], relevantFiles = [], constraints = [], acceptance = [], verification = [], risks = [], evidence = [] }) {
  return {
    id: newId('nxa'),
    rule,
    objective,
    reason,
    scope,
    relevantFiles,
    constraints,
    acceptanceCriteria: acceptance,
    verificationCommands: verification,
    risks,
    priority,
    confidence: CONFIDENCE.HIGH,
    evidence,
    createdAt: nowIso(),
  };
}

const BASE_CONSTRAINTS = [
  'Do not delete, skip or weaken existing tests to make the suite pass.',
  'Do not modify the project specification unless the acceptance criteria genuinely changed.',
  'Keep the change set scoped to the objective.',
];

export class NextActionEngine {
  /**
   * @param {{build, unit, integration, e2e, unitHistory, risks, regressions, drift, gate,
   *          tasks, stages, currentStage, specs, metadata, git, failedCases}} ctx
   */
  decide(ctx = {}) {
    const {
      build, unit, integration, e2e, risks = [], regressions = [], drift = null, gate = null,
      tasks = [], stages = [], currentStage = null, specs = [], metadata = null, git = null,
    } = ctx;

    const openTasks = tasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED);
    const blockedTasks = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
    const openRisks = risks.filter((r) => r.status === 'open');
    const criticalRisks = openRisks.filter((r) => r.severity === SEVERITY.CRITICAL);
    const highRisks = openRisks.filter((r) => r.severity === SEVERITY.HIGH);
    const failedCommands = [build, unit, integration, e2e].filter(Boolean).map((r) => r.command).filter(Boolean);
    const relevantFiles = this.#relevantFiles({ metadata, failedCases: ctx.failedCases || [], git });

    // 1. Build failure dominates everything.
    if (build && build.status === BUILD_STATUS.FAIL) {
      return action({
        rule: 'build_failed',
        priority: TASK_PRIORITY.P0,
        objective: 'Restore a passing build',
        reason: `The build command \`${build.command}\` exits ${build.exitCode}. While the build is red, no test, health or gate signal can be trusted.`,
        scope: ['Reproduce the build failure locally', 'Fix the compile/bundle error at its root cause', 'Re-run the build to green'],
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['Build exits with code 0', 'No test was disabled to make the build pass'],
        verification: [build.command || 'npm run build'],
        risks: openRisks.slice(0, 5).map((r) => `${r.title}`),
        evidence: [evCommand(build.command)],
      });
    }

    // 2. Unit tests.
    if (unit && unit.status === RUN_STATUS.FAIL) {
      return action({
        rule: 'unit_failed',
        priority: TASK_PRIORITY.P0,
        objective: `Fix the ${unit.failed} failing unit test${unit.failed === 1 ? '' : 's'}`,
        reason: `Unit tests report ${unit.failed} failure(s) out of ${unit.total} (${unit.framework}). Unit failures localise the defect, so they must be resolved before end-to-end work.`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'unit').slice(0, 8).map((c) => `Fix: ${c.name}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`All ${unit.total} unit tests pass`, 'No test was deleted or marked skipped'],
        verification: [unit.command || 'npm test'],
        risks: openRisks.slice(0, 5).map((r) => r.title),
        evidence: [evTest('unit'), ...(ctx.failedCases || []).slice(0, 3).map((c) => evTest(c.name))],
      });
    }

    // 3. E2E tests.
    if (e2e && e2e.status === RUN_STATUS.FAIL) {
      return action({
        rule: 'e2e_failed',
        priority: TASK_PRIORITY.P0,
        objective: `Repair the ${e2e.failed} failing end-to-end test${e2e.failed === 1 ? '' : 's'} blocking the acceptance gate`,
        reason: `Unit tests are green${unit ? ` (${unit.passed}/${unit.total})` : ''} but E2E reports ${e2e.passed}/${e2e.total}, so ${gate && gate.result !== GATE_RESULT.PASS ? 'the acceptance gate cannot pass' : 'the user-facing flows are unverified'}.`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'e2e').slice(0, 8).map((c) => `Fix: ${c.name}${c.file ? ` (${c.file})` : ''}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`E2E reaches ${e2e.total}/${e2e.total} PASS`, 'Unit tests remain green', 'No E2E test was deleted or skipped'],
        verification: [e2e.command || 'npm run test:e2e', unit && unit.command ? unit.command : 'npm test'],
        risks: openRisks.slice(0, 5).map((r) => r.title),
        evidence: [evTest('e2e'), ...(ctx.failedCases || []).slice(0, 3).map((c) => evTest(c.name))],
      });
    }

    // 4. Integration tests.
    if (integration && integration.status === RUN_STATUS.FAIL) {
      return action({
        rule: 'integration_failed',
        priority: TASK_PRIORITY.P0,
        objective: `Fix the ${integration.failed} failing integration test${integration.failed === 1 ? '' : 's'}`,
        reason: `Integration tests report ${integration.failed} of ${integration.total} failing (${integration.framework}).`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'integration').slice(0, 8).map((c) => `Fix: ${c.name}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`All ${integration.total} integration tests pass`],
        verification: [integration.command || 'npm run test:integration'],
        evidence: [evTest('integration')],
      });
    }

    // 5. Critical risks.
    if (criticalRisks.length) {
      const worst = criticalRisks[0];
      return action({
        rule: 'critical_risk',
        priority: TASK_PRIORITY.P0,
        objective: `Resolve critical risk: ${worst.title}`,
        reason: `${criticalRisks.length} open critical risk(s) exist. ${worst.description}`,
        scope: criticalRisks.map((r) => `${r.title} — ${r.suggested_action || 'no suggested action recorded'}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['All critical risks are resolved or explicitly accepted', 'No new critical risk is introduced'],
        verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
        risks: criticalRisks.map((r) => r.title),
        evidence: criticalRisks.flatMap((r) => r.evidence || []).slice(0, 5),
      });
    }

    // 6. Regressions.
    if (regressions.length) {
      const worst = regressions.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a), regressions[0]);
      return action({
        rule: 'regression',
        priority: TASK_PRIORITY.P0,
        objective: `Investigate regression: ${worst.title}`,
        reason: `A regression was detected between two snapshots (${worst.type}). ${worst.suggested_action || ''}`.trim(),
        scope: regressions.map((r) => `${r.type}: ${r.title}`),
        relevantFiles,
        constraints: [...BASE_CONSTRAINTS, 'Restore the previous behaviour rather than adjusting the expectations.'],
        acceptance: ['The regressed metric returns to its previous value', 'The fix is covered by a test'],
        verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
        risks: highRisks.map((r) => r.title),
        evidence: worst.evidence || [evSnapshot(worst.before && worst.before.id)],
      });
    }

    // 7. Drift.
    if (drift && drift.verdict === 'possible_drift' && (drift.drifts || []).some((d) => SEVERITY_RANK[d.severity] >= SEVERITY_RANK[SEVERITY.HIGH])) {
      const worst = drift.drifts[0];
      return action({
        rule: 'drift',
        priority: TASK_PRIORITY.P1,
        objective: `Verify possible specification drift: ${worst.title}`,
        reason: `Drift analysis flagged ${drift.drifts.length} signal(s). ${worst.description}`,
        scope: drift.drifts.slice(0, 6).map((d) => `${d.title} — ${d.description}`),
        relevantFiles,
        constraints: [...BASE_CONSTRAINTS, 'If the drift is intentional, update the specification instead of the code.'],
        acceptance: ['Each drift signal is either resolved or documented as intentional', 'Specification and code agree'],
        verification: ['npm run build', 'npm test'],
        evidence: worst.evidence || [],
      });
    }

    // 8. Blocked tasks.
    if (blockedTasks.length) {
      return action({
        rule: 'blocked_task',
        priority: TASK_PRIORITY.P1,
        objective: `Unblock: ${blockedTasks[0].title}`,
        reason: `${blockedTasks.length} task(s) are blocked${currentStage ? ` and are stalling stage "${currentStage.name}"` : ''}.`,
        scope: blockedTasks.map((t) => t.title),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['The blocking dependency is resolved or the task is re-scoped and unblocked'],
        verification: failedCommands.length ? failedCommands : ['npm test'],
        evidence: blockedTasks.slice(0, 3).map((t) => evTask(t.id)),
      });
    }

    // 9. Gate.
    if (gate && (gate.result === GATE_RESULT.FAIL || gate.result === GATE_RESULT.BLOCKED)) {
      return action({
        rule: 'gate_failed',
        priority: TASK_PRIORITY.P1,
        objective: `Clear the acceptance gate for ${currentStage ? currentStage.name : 'the current stage'}`,
        reason: gate.explanation,
        scope: gate.checks.filter((c) => c.status !== GATE_RESULT.PASS).map((c) => `${c.name}: ${c.detail}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: gate.checks.filter((c) => c.status !== GATE_RESULT.PASS).map((c) => `${c.name} becomes PASS`),
        verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
        evidence: gate.checks.flatMap((c) => c.evidence || []).slice(0, 5),
      });
    }

    // 10. Open tasks.
    if (openTasks.length) {
      const prioritized = openTasks.slice().sort((a, b) => String(a.priority).localeCompare(String(b.priority)));
      const next = prioritized[0];
      return action({
        rule: 'open_task',
        priority: next.priority || TASK_PRIORITY.P2,
        objective: String(next.title).slice(0, 200),
        reason: `${openTasks.length} open task(s) remain in the ledger. This is the highest-priority item (${next.priority}, source: ${next.source}).`,
        scope: [String(next.description || next.title).slice(0, 400)],
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['The task is implemented and reflected in the ledger', 'Existing tests remain green'],
        verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
        evidence: (next.evidence && next.evidence.length ? next.evidence : [evTask(next.id)]),
      });
    }

    // 11. Next stage.
    if (stages.length) {
      const notStarted = stages.find((s) => s.status === STAGE_STATUS.NOT_STARTED);
      if (notStarted) {
        return action({
          rule: 'next_stage',
          priority: TASK_PRIORITY.P2,
          objective: `Begin stage "${notStarted.name}"`,
          reason: `All work in the current stage is complete and "${notStarted.name}" has not started yet.`,
          scope: [notStarted.description || `Define and execute the work for ${notStarted.name}`],
          relevantFiles,
          constraints: [...BASE_CONSTRAINTS, 'Do not start work that belongs to a later stage.'],
          acceptance: [`Tasks for "${notStarted.name}" are defined in the ledger`, 'Build and tests remain green'],
          verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
          evidence: [],
        });
      }
    }

    // 12. Nothing actionable.
    const hasSpec = specs.length > 0;
    return action({
      rule: 'no_spec',
      priority: TASK_PRIORITY.P3,
      objective: hasSpec ? 'Extend the specification with the next milestone' : 'Create a specification so progress can be measured',
      reason: hasSpec
        ? 'No open tasks, no gate failures and no risks were found. The specification must define the next unit of work.'
        : 'No specification document was found in this workspace, so Commander has no baseline to measure progress, acceptance or drift against.',
      scope: hasSpec
        ? ['Add the next milestone/stage to the specification', 'Derive tasks from it']
        : ['Add SPEC.md with Goals, Requirements and Acceptance Criteria', 'Re-run a full scan'],
      relevantFiles: relevantFiles.length ? relevantFiles : ['SPEC.md'],
      constraints: BASE_CONSTRAINTS,
      acceptance: hasSpec ? ['New stage is declared in the specification'] : ['SPEC.md exists with at least one acceptance criterion'],
      verification: failedCommands.length ? failedCommands : ['npm run build', 'npm test'],
      evidence: specs.slice(0, 2).map((s) => evSpec(s.path)),
      confidence: CONFIDENCE.MEDIUM,
    });
  }

  #relevantFiles({ metadata, failedCases, git }) {
    const files = new Set();
    for (const c of failedCases) if (c.file) files.add(c.file);
    if (git) {
      for (const p of (git.modified || []).slice(0, 10)) files.add(p);
      for (const p of (git.deleted || []).slice(0, 5)) files.add(p);
    }
    if (metadata) {
      for (const d of metadata.markdownDocs || []) if (d.isSpecCandidate) files.add(d.path);
      for (const f of (metadata.largestFiles || []).slice(0, 5)) files.add(f.path);
    }
    return [...files].slice(0, 25);
  }
}

export function nextActionToText(a) {
  const scope = a.scope || [];
  const acceptance = a.acceptanceCriteria || [];
  const verification = a.verificationCommands || [];
  return [
    `Objective: ${a.objective || '(none)'}`,
    a.reason ? `Reason: ${a.reason}` : '',
    a.priority ? `Priority: ${a.priority}` : '',
    scope.length ? `Scope:${scope.map((s) => `\n  - ${s}`).join('')}` : '',
    acceptance.length ? `Acceptance:${acceptance.map((s) => `\n  - ${s}`).join('')}` : '',
    verification.length ? `Verify:${verification.map((s) => `\n  - ${s}`).join('')}` : '',
  ].filter(Boolean).join('\n');
}

export { evFile };
