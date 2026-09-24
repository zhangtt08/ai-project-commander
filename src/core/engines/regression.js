/**
 * RegressionDetector — requirement #22.
 * Compares the newest snapshot against the previous one and reports typed regressions
 * with before/after values and evidence. Never reports a regression without both sides.
 */
import {
  REGRESSION_TYPE, SEVERITY, RUN_STATUS, BUILD_STATUS, STAGE_STATUS, SEVERITY_RANK,
} from '../../domain/constants.js';
import { sha1 } from '../util.js';

const ZH_SUITE = { unit: '单元', integration: '集成', e2e: '端到端' };
import { evSnapshot, evTest, evCommand } from '../evidence.js';

function reg(type, severity, title, before, after, evidence, suggestedAction) {
  return {
    type, severity, title,
    before, after,
    evidence, suggested_action: suggestedAction,
    fingerprint: sha1(`${type}::${JSON.stringify(before)}::${JSON.stringify(after)}`).slice(0, 16),
    acknowledged: false,
  };
}

function suiteOf(snapshot, key) {
  if (!snapshot) return null;
  const raw = snapshot[`${key}_json`] || snapshot[key];
  return raw || null;
}

/**
 * @param {{previous:object|null, current:object}} input
 *   `current` shape: {git, build, unit, integration, e2e, risks, stageId, stageName, metadata, criteria}
 */
export function detectRegressions({ previous = null, current } = {}) {
  if (!previous || !current) return [];
  const out = [];

  const prevBuild = suiteOf(previous, 'build');
  const curBuild = current.build;
  if (prevBuild && curBuild) {
    if (prevBuild.status === BUILD_STATUS.PASS && curBuild.status === BUILD_STATUS.FAIL) {
      out.push(reg(REGRESSION_TYPE.BUILD_PASS_TO_FAIL, SEVERITY.CRITICAL,
        '构建从通过退化为失败',
        { status: prevBuild.status, command: prevBuild.command },
        { status: curBuild.status, command: curBuild.command, exitCode: curBuild.exitCode },
        [evSnapshot(previous.id), evCommand(curBuild.command || prevBuild.command)],
        '立即修复构建——构建不绿之前，其他信号都不可靠。'));
    }
  }

  for (const key of ['unit', 'integration', 'e2e']) {
    const prevRun = suiteOf(previous, key);
    const curRun = current[key];
    if (!prevRun || !curRun) continue;
    if (prevRun.status === RUN_STATUS.PASS && (curRun.status === RUN_STATUS.FAIL || curRun.status === RUN_STATUS.ERROR)) {
      out.push(reg(REGRESSION_TYPE.TESTS_PASS_TO_FAIL, key === 'e2e' ? SEVERITY.HIGH : SEVERITY.CRITICAL,
        `${ZH_SUITE[key]}测试从通过退化为失败`,
        { status: prevRun.status, total: prevRun.total, passed: prevRun.passed, failed: prevRun.failed },
        { status: curRun.status, total: curRun.total, passed: curRun.passed, failed: curRun.failed, framework: curRun.framework },
        [evSnapshot(previous.id), evTest(key)],
        `在推进阶段之前，先修复${ZH_SUITE[key]}的失败。`));
      continue;
    }
    const prevPassed = prevRun.passed || 0;
    const curPassed = curRun.passed || 0;
    if (prevPassed > curPassed && (prevRun.total || 0) === (curRun.total || 0) && (prevRun.total || 0) > 0) {
      out.push(reg(REGRESSION_TYPE.PASSED_COUNT_DROP, SEVERITY.HIGH,
        `${ZH_SUITE[key]}：通过数从 ${prevPassed} 降到 ${curPassed}`,
        { passed: prevPassed, total: prevRun.total, status: prevRun.status },
        { passed: curPassed, total: curRun.total, status: curRun.status },
        [evSnapshot(previous.id), evTest(key)],
        '找出不再通过的测试并修复。'));
    }
    const prevTotal = prevRun.total || 0;
    const curTotal = curRun.total || 0;
    if (prevTotal >= 5 && curTotal > 0 && curTotal < prevTotal * 0.8) {
      out.push(reg(REGRESSION_TYPE.TEST_COUNT_DROP, SEVERITY.HIGH,
        `${ZH_SUITE[key]}：测试总数从 ${prevTotal} 降到 ${curTotal}`,
        { total: prevTotal }, { total: curTotal },
        [evSnapshot(previous.id), evTest(key)],
        '测试似乎被删除了。请确认这是有意的；静默删除测试会被视为回归。'));
    }
  }

  if (previous.stage_id && current.stageId && previous.stage_id !== current.stageId) {
    const prevStageName = previous.stage_name;
    if (prevStageName && current.previousStageCompleted && current.currentStageStatus === STAGE_STATUS.NOT_STARTED) {
      out.push(reg(REGRESSION_TYPE.STAGE_REGRESSED, SEVERITY.HIGH,
        `Stage "${prevStageName}" regressed from completed to not started`,
        { stage: prevStageName, status: 'completed' },
        { stage: current.stageName, status: current.currentStageStatus },
        [evSnapshot(previous.id)],
        'Re-open the stage and resolve whatever invalidated its completion.'));
    }
  }

  const prevRiskSummary = previous.risk_summary || {};
  const prevCritical = (prevRiskSummary.bySeverity && prevRiskSummary.bySeverity.critical) || 0;
  const curCritical = (current.risks || []).filter((r) => r.status === 'open' && r.severity === SEVERITY.CRITICAL).length;
  if (curCritical > prevCritical) {
    out.push(reg(REGRESSION_TYPE.CRITICAL_RISK_INCREASED, SEVERITY.HIGH,
      `危急风险从 ${prevCritical} 增加到 ${curCritical}`,
      { critical: prevCritical }, { critical: curCritical },
      [evSnapshot(previous.id)],
      '打开风险面板，清除新增的危急风险。'));
  }

  if (current.metadata && previous.file_count) {
    if (current.metadata.fileCount < previous.file_count && previous.file_count - current.metadata.fileCount >= 5) {
      out.push(reg(REGRESSION_TYPE.KEY_FILE_DELETED, SEVERITY.MEDIUM,
        `工作区文件数从 ${previous.file_count} 降到 ${current.metadata.fileCount}`,
        { fileCount: previous.file_count }, { fileCount: current.metadata.fileCount },
        [evSnapshot(previous.id)],
        '请核实没有删除重要文件。'));
    }
  }

  if (previous.gate_json && current.gate && previous.gate_json.result === 'PASS' && current.gate.result !== 'PASS') {
    out.push(reg(REGRESSION_TYPE.ACCEPTANCE_INVALIDATED, SEVERITY.HIGH,
      `验收门从 ${previous.gate_json.result} 退化为 ${current.gate.result}`,
      { result: previous.gate_json.result }, { result: current.gate.result, explanation: current.gate.explanation },
      [evSnapshot(previous.id)],
      '该阶段无法再推进。请修复失败的门禁检查。'));
  }

  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function regressionSummary(regressions) {
  if (!regressions || !regressions.length) return { count: 0, worst: null, byType: {} };
  const byType = {};
  for (const r of regressions) byType[r.type] = (byType[r.type] || 0) + 1;
  const worst = regressions.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a), regressions[0]);
  return { count: regressions.length, worst: worst.severity, byType, open: regressions.filter((r) => !r.acknowledged).length };
}
