/**
 * AcceptanceGate — requirement #28.
 * A stage may only be considered complete when every check passes.
 * The gate always explains WHY it cannot advance — never a bare FAIL.
 */
import { GATE_RESULT, BUILD_STATUS, RUN_STATUS, SEVERITY, TASK_STATUS, STAGE_STATUS, SEVERITY_RANK } from '../../domain/constants.js';
import { evCommand, evTest } from '../evidence.js';

function check(name, status, detail, evidence = []) {
  return { name, status, detail, evidence };
}

export function evaluateGate({
  stage = null,
  build = null,
  unit = null,
  e2e = null,
  integration = null,
  risks = [],
  tasks = [],
  criteria = [],
} = {}) {
  const checks = [];

  if (!stage) {
    checks.push(check('Stage identified', GATE_RESULT.UNKNOWN, 'No stage could be determined from specs or tasks, so the gate cannot be evaluated.'));
    return finalize(GATE_RESULT.UNKNOWN, checks, 'The project stage is Unknown. Declare stages in SPEC.md/README.md (for example "## Stage 1 — Foundations") to enable gating.');
  }

  if (build) {
    if (build.status === BUILD_STATUS.PASS) checks.push(check('Build PASS', GATE_RESULT.PASS, `\`${build.command}\` exited 0 in ${build.durationMs}ms.`, [evCommand(build.command)]));
    else if (build.status === BUILD_STATUS.UNSUPPORTED) checks.push(check('Build PASS', GATE_RESULT.UNKNOWN, `No build command detected: ${build.unsupportedReason || 'not applicable for this project type'}.`));
    else checks.push(check('Build PASS', GATE_RESULT.FAIL, `\`${build.command || 'build'}\` returned status "${build.status}" (exit ${build.exitCode}).`, [evCommand(build.command || 'build')]));
  } else {
    checks.push(check('Build PASS', GATE_RESULT.UNKNOWN, 'No build result recorded yet — run a full scan.'));
  }

  const suiteCheck = (label, run, key) => {
    if (!run) { checks.push(check(label, GATE_RESULT.UNKNOWN, `${label} has not been run yet.`)); return; }
    if (run.status === RUN_STATUS.UNSUPPORTED) { checks.push(check(label, GATE_RESULT.UNKNOWN, `Not applicable: ${run.unsupportedReason || 'no command detected'}.`)); return; }
    if (run.status === RUN_STATUS.PASS) { checks.push(check(label, GATE_RESULT.PASS, `${run.passed}/${run.total} passed (${run.framework}).`, [evTest(key)])); return; }
    if (run.status === RUN_STATUS.ERROR) { checks.push(check(label, GATE_RESULT.FAIL, `The test command failed (exit ${run.exitCode}) but output could not be parsed (${run.framework}). ${run.parserNote || ''}`.trim())); return; }
    checks.push(check(label, GATE_RESULT.FAIL, `${run.failed} of ${run.total} ${key} tests failed (${run.framework}).`, [evTest(key)]));
  };
  suiteCheck('Unit tests PASS', unit, 'unit');
  if (integration) suiteCheck('Integration tests PASS', integration, 'integration');
  suiteCheck('E2E tests PASS', e2e, 'e2e');

  const criticalRisks = risks.filter((r) => r.status === 'open' && r.severity === SEVERITY.CRITICAL);
  const highRisks = risks.filter((r) => r.status === 'open' && r.severity === SEVERITY.HIGH);
  if (criticalRisks.length === 0) {
    checks.push(check('Critical Risk = 0', GATE_RESULT.PASS, highRisks.length
      ? `No critical risks. ${highRisks.length} high risk(s) remain and are tracked in the Risk panel, but do not gate the stage.`
      : 'No open critical risks.'));
  } else {
    checks.push(check('Critical Risk = 0', GATE_RESULT.FAIL, `${criticalRisks.length} open critical risk(s): ${criticalRisks.map((r) => r.code).join(', ')}.`));
  }
  if (highRisks.length) {
    checks.push(check('High risk budget (advisory)', GATE_RESULT.UNKNOWN, `${highRisks.length} open high risk(s): ${highRisks.map((r) => r.code).join(', ')}. Advisory only — high risks do not block the gate.`));
  }

  const stageTasks = tasks.filter((t) => t.stage_id === stage.id);
  const blocking = stageTasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED);
  if (stageTasks.length === 0) {
    checks.push(check('Stage tasks done', GATE_RESULT.UNKNOWN, 'No tasks are linked to this stage yet.'));
  } else if (blocking.length === 0) {
    checks.push(check('Stage tasks done', GATE_RESULT.PASS, `All ${stageTasks.length} stage task(s) are done.`));
  } else {
    const blocked = blocking.filter((t) => t.status === TASK_STATUS.BLOCKED);
    checks.push(check('Stage tasks done', blocked.length ? GATE_RESULT.BLOCKED : GATE_RESULT.FAIL,
      `${blocking.length} of ${stageTasks.length} stage task(s) are still open${blocked.length ? ` (${blocked.length} blocked)` : ''}.`));
  }

  const stageCriteria = criteria.filter((c) => c.stage_id === stage.id || (stage.name && c.stage_name === stage.name));
  if (!stageCriteria.length) {
    checks.push(check('Acceptance criteria satisfied', GATE_RESULT.UNKNOWN, 'No acceptance criteria are linked to this stage.'));
  } else {
    const unmet = stageCriteria.filter((c) => c.status === 'unmet');
    checks.push(check('Acceptance criteria satisfied',
      unmet.length ? GATE_RESULT.FAIL : GATE_RESULT.PASS,
      unmet.length ? `${unmet.length} of ${stageCriteria.length} criteria are unmet.` : `All ${stageCriteria.length} criteria satisfied.`));
  }

  const statuses = checks.map((c) => c.status);
  let result;
  if (statuses.includes(GATE_RESULT.FAIL)) result = GATE_RESULT.FAIL;
  else if (statuses.includes(GATE_RESULT.BLOCKED)) result = GATE_RESULT.BLOCKED;
  else if (statuses.every((s) => s === GATE_RESULT.PASS)) result = GATE_RESULT.PASS;
  else if (statuses.filter((s) => s === GATE_RESULT.UNKNOWN).length > statuses.length / 2) result = GATE_RESULT.UNKNOWN;
  else result = GATE_RESULT.PASS;

  const explanation = buildExplanation(result, checks, stage);
  return finalize(result, checks, explanation);
}

function finalize(result, checks, explanation) {
  return {
    result,
    checks,
    explanation,
    failedChecks: checks.filter((c) => c.status === GATE_RESULT.FAIL || c.status === GATE_RESULT.BLOCKED).map((c) => c.name),
    unknownChecks: checks.filter((c) => c.status === GATE_RESULT.UNKNOWN).map((c) => c.name),
    evaluatedAt: new Date().toISOString(),
  };
}

function buildExplanation(result, checks, stage) {
  const stageName = stage ? stage.name : 'the current stage';
  if (result === GATE_RESULT.PASS) return `${stageName} satisfies every acceptance gate. The project may advance to the next stage.`;
  if (result === GATE_RESULT.UNKNOWN) {
    const unknown = checks.filter((c) => c.status === GATE_RESULT.UNKNOWN).map((c) => c.name);
    return `The gate cannot be evaluated for ${stageName} because ${unknown.length} check(s) lack evidence: ${unknown.join(', ')}.`;
  }
  const blocking = checks.filter((c) => c.status === GATE_RESULT.FAIL || c.status === GATE_RESULT.BLOCKED);
  const reasons = blocking.map((c) => `${c.name} → ${c.detail}`);
  return `${stageName} cannot advance. ${blocking.length} blocking check(s): ${reasons.join(' ')}`;
}

export function gateSeverity(gate) {
  if (!gate) return SEVERITY_RANK.low;
  if (gate.result === GATE_RESULT.FAIL) return SEVERITY_RANK.high;
  if (gate.result === GATE_RESULT.BLOCKED) return SEVERITY_RANK.critical;
  if (gate.result === GATE_RESULT.UNKNOWN) return SEVERITY_RANK.medium;
  return SEVERITY_RANK.low;
}

export function gateSummaryLine(gate) {
  if (!gate) return 'not evaluated';
  return `${gate.result} — ${gate.explanation}`;
}

export { STAGE_STATUS };
