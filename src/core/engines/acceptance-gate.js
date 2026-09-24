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
    checks.push(check('已识别阶段', GATE_RESULT.UNKNOWN, '无法从规范或任务中确定阶段，因此无法评估门禁。'));
    return finalize(GATE_RESULT.UNKNOWN, checks, '无法从规范或任务中确定项目阶段。请在 SPEC.md/README.md 中声明阶段（例如 “## Stage 1 — Foundations”）以启用门禁。');
  }

  if (build) {
    if (build.status === BUILD_STATUS.PASS) checks.push(check('构建通过', GATE_RESULT.PASS, `\`${build.command}\` 退出码 0，耗时 ${build.durationMs}ms。`, [evCommand(build.command)]));
    else if (build.status === BUILD_STATUS.UNSUPPORTED) checks.push(check('构建通过', GATE_RESULT.UNKNOWN, `未检测到构建命令：${build.unsupportedReason || '对该项目类型不适用'}。`));
    else checks.push(check('构建通过', GATE_RESULT.FAIL, `\`${build.command || 'build'}\` 返回状态“${build.status}”（退出码 ${build.exitCode}）。`, [evCommand(build.command || 'build')]));
  } else {
    checks.push(check('构建通过', GATE_RESULT.UNKNOWN, '尚未记录构建结果——请运行全量扫描。'));
  }

  const suiteCheck = (label, run, key) => {
    if (!run) { checks.push(check(label, GATE_RESULT.UNKNOWN, `${label}尚未运行。`)); return; }
    if (run.status === RUN_STATUS.UNSUPPORTED) { checks.push(check(label, GATE_RESULT.UNKNOWN, `不适用：${run.unsupportedReason || '未检测到命令'}。`)); return; }
    if (run.status === RUN_STATUS.PASS) { checks.push(check(label, GATE_RESULT.PASS, `${run.passed}/${run.total} 通过（${run.framework}）。`, [evTest(key)])); return; }
    if (run.status === RUN_STATUS.ERROR) { checks.push(check(label, GATE_RESULT.FAIL, `测试命令失败（退出码 ${run.exitCode}），但输出无法解析（${run.framework}）。${run.parserNote || ''}`.trim())); return; }
    checks.push(check(label, GATE_RESULT.FAIL, `${run.total} 个 ${key} 测试中有 ${run.failed} 个失败（${run.framework}）。`, [evTest(key)]));
  };
  suiteCheck('单元测试通过', unit, 'unit');
  if (integration) suiteCheck('集成测试通过', integration, 'integration');
  suiteCheck('端到端测试通过', e2e, 'e2e');

  const criticalRisks = risks.filter((r) => r.status === 'open' && r.severity === SEVERITY.CRITICAL);
  const highRisks = risks.filter((r) => r.status === 'open' && r.severity === SEVERITY.HIGH);
  if (criticalRisks.length === 0) {
    checks.push(check('危急风险为 0', GATE_RESULT.PASS, highRisks.length
      ? `没有危急风险。仍有 ${highRisks.length} 个高风险，已在风险面板跟踪，但不阻塞门禁。`
      : '没有未解决的危急风险。'));
  } else {
    checks.push(check('危急风险为 0', GATE_RESULT.FAIL, `${criticalRisks.length} 个未解决的危急风险：${criticalRisks.map((r) => r.code).join('、')}。`));
  }
  if (highRisks.length) {
    checks.push(check('高风险预算（建议项）', GATE_RESULT.UNKNOWN, `${highRisks.length} 个未解决的高风险：${highRisks.map((r) => r.code).join('、')}。仅为建议——高风险不阻塞门禁。`));
  }

  const stageTasks = tasks.filter((t) => t.stage_id === stage.id);
  const blocking = stageTasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED);
  if (stageTasks.length === 0) {
    checks.push(check('阶段任务完成', GATE_RESULT.UNKNOWN, '尚无任务关联到该阶段。'));
  } else if (blocking.length === 0) {
    checks.push(check('阶段任务完成', GATE_RESULT.PASS, `该阶段全部 ${stageTasks.length} 个任务已完成。`));
  } else {
    const blocked = blocking.filter((t) => t.status === TASK_STATUS.BLOCKED);
    checks.push(check('阶段任务完成', blocked.length ? GATE_RESULT.BLOCKED : GATE_RESULT.FAIL,
      `${stageTasks.length} 个阶段任务中仍有 ${blocking.length} 个未完成${blocked.length ? `（${blocked.length} 个被阻塞）` : ''}。`));
  }

  const stageCriteria = criteria.filter((c) => c.stage_id === stage.id || (stage.name && c.stage_name === stage.name));
  if (!stageCriteria.length) {
    checks.push(check('验收标准满足', GATE_RESULT.UNKNOWN, '该阶段尚无关联的验收标准。'));
  } else {
    const unmet = stageCriteria.filter((c) => c.status === 'unmet');
    checks.push(check('验收标准满足',
      unmet.length ? GATE_RESULT.FAIL : GATE_RESULT.PASS,
      unmet.length ? `${stageCriteria.length} 条标准中有 ${unmet.length} 条未满足。` : `全部 ${stageCriteria.length} 条标准已满足。`));
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
  if (result === GATE_RESULT.PASS) return `${stageName} 满足所有验收门，项目可以推进到下一阶段。`;
  if (result === GATE_RESULT.UNKNOWN) {
    const unknown = checks.filter((c) => c.status === GATE_RESULT.UNKNOWN).map((c) => c.name);
    return `无法评估${stageName}的门禁，因为有 ${unknown.length} 项检查缺少证据：${unknown.join('、')}。`;
  }
  const blocking = checks.filter((c) => c.status === GATE_RESULT.FAIL || c.status === GATE_RESULT.BLOCKED);
  const reasons = blocking.map((c) => `${c.name} → ${c.detail}`);
  return `${stageName} 无法推进。${blocking.length} 项阻塞检查：${reasons.join(' ')}`;
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
