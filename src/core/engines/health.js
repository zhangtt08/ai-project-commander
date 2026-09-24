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

const ZH_KEY = { stages: '阶段', tasks: '任务', acceptance: '验收标准' };
const HEALTH_ZH = { healthy: '健康', warning: '警告', critical: '危急', unknown: '未知' };

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
        reasons.push(reason('build_failed', severity.CRITICAL, `构建失败——\`${build.command}\` 退出码 ${build.exitCode}。`, {
          evidence: [evCommand(build.command)], fix: '先修复构建；构建不绿之前，其他一切都不可信。', magnitude: 3,
        }));
        score -= 45;
      } else if (build.status === BUILD_STATUS.TIMEOUT) {
        reasons.push(reason('build_timeout', severity.HIGH, `构建在 ${build.durationMs}ms 后超时。`, { fix: '排查挂起的进程，或在设置中调大构建超时时间。' }));
        score -= 25;
      } else if (build.status === BUILD_STATUS.UNSUPPORTED) {
        reasons.push(reason('build_unsupported', severity.LOW, `未检测到构建命令（${build.unsupportedReason || '不适用'}）。`, { fix: '如果该项目会产生构建产物，请在 package.json 中添加 "build" 脚本。' }));
      } else if (build.status === BUILD_STATUS.PASS) {
        reasons.push(reason('build_passed', 'info', `构建通过，耗时 ${build.durationMs}ms。`, { evidence: [evCommand(build.command)] }));
      }
    } else {
      reasons.push(reason('build_unknown', severity.MEDIUM, '该项目从未运行过构建。', { fix: '运行一次全量扫描，以执行检测到的构建命令。' }));
      score -= 10;
    }

    const checkSuite = (label, run, code) => {
      if (!run) {
        reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} 在该项目中尚未运行。`, { fix: '运行一次全量扫描。' }));
        score -= 2;
        return;
      }
      if (run.status === RUN_STATUS.PASS) {
        reasons.push(reason(`${code}_passed`, 'info', `${label}：${run.passed}/${run.total} 通过（${run.framework}）。`, { evidence: [evTest(code)] }));
        return;
      }
      if (run.status === RUN_STATUS.UNSUPPORTED) {
        reasons.push(reason(`${code}_unsupported`, severity.LOW, `${label} 不适用：${run.unsupportedReason || '无命令'}。`));
        return;
      }
      if (run.status === RUN_STATUS.FAIL) {
        const ratio = run.total ? run.failed / run.total : 1;
        const sev = code === 'unit' && ratio > 0.3 ? severity.CRITICAL : severity.HIGH;
        reasons.push(reason(`${code}_failed`, sev, `${label}：${run.total} 个中 ${run.failed} 个失败（${run.framework}）。`, {
          evidence: [evTest(code)], fix: run.suite === 'e2e' ? '修复失败的端到端流程；它们阻塞了验收门。' : '修复失败的单元测试。', magnitude: 2,
        }));
        score -= code === 'unit' ? 30 : 20;
        return;
      }
      reasons.push(reason(`${code}_error`, severity.HIGH, `${label} 运行以状态“${run.status}”结束（退出码 ${run.exitCode}）。`, { fix: '检查测试命令输出；reporter 格式可能不受支持。' }));
      score -= 15;
    };
    checkSuite('单元测试', unit, 'unit');
    checkSuite('集成测试', integration, 'integration');
    checkSuite('端到端测试', e2e, 'e2e');

    const configuredSuites = [unit, integration, e2e].filter((r) => r && r.status !== RUN_STATUS.UNSUPPORTED);
    if (!configuredSuites.length) {
      reasons.push(reason('no_tests_configured', severity.MEDIUM,
        '未在该项目中检测到可运行的测试套件（既没有测试脚本，也没有可识别的测试框架）。',
        { fix: '在 package.json 中添加 "test" 脚本，或在规范中声明该项目无测试。' }));
      score -= 12;
    }

    const criticalRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.CRITICAL);
    const highRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.HIGH);
    // Some risks are pure hygiene observations (Commander found secrets and protected them).
    // They must be visible but must not degrade the health verdict.
    const HEALTH_NEUTRAL_RISKS = new Set(['SENSITIVE_FILES_PRESENT', 'NO_LOCKFILE']);
    const mediumRisks = risks.filter((r) => r.status === 'open' && r.severity === severity.MEDIUM && !HEALTH_NEUTRAL_RISKS.has(r.code));
    if (criticalRisks.length) {
      reasons.push(reason('critical_risks', severity.CRITICAL, `${criticalRisks.length} 个未解决的危急风险：${criticalRisks.map((r) => r.title).join('；')}。`, {
        evidence: criticalRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: '在推进之前先解决危急风险。', magnitude: 2,
      }));
      score -= 10 * criticalRisks.length;
    }
    if (highRisks.length) {
      reasons.push(reason('high_risks', severity.HIGH, `${highRisks.length} 个未解决的高风险：${highRisks.map((r) => r.title).join('；')}。`, {
        evidence: highRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: '在风险面板中对高风险进行分诊。',
      }));
      score -= 5 * highRisks.length;
    }
    if (!criticalRisks.length && !highRisks.length && mediumRisks.length) {
      reasons.push(reason('medium_risks', severity.MEDIUM, `${mediumRisks.length} 个未解决的中等风险。`, { fix: '方便时查看风险面板。' }));
    }

    const openBlocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
    if (openBlocked.length) {
      reasons.push(reason('blocked_tasks', severity.HIGH, `${openBlocked.length} 个被阻塞的任务：${openBlocked.map((t) => t.title).join('；').slice(0, 300)}。`, {
        fix: '解除阻塞或重新界定这些任务的范围；它们会拖慢当前阶段。', magnitude: 1.5,
      }));
      score -= 8 * openBlocked.length;
    }

    if (git && git.isRepository) {
      const dirty = git.changedFileCount + (git.untracked ? git.untracked.length : 0);
      if (dirty > 40) {
        reasons.push(reason('very_dirty_workspace', severity.HIGH, `${dirty} 个文件与 HEAD 不同——大量未提交的改动会掩盖回归。`, {
          fix: '先提交或 stash，让 Commander 能把变更归因到已知状态。', magnitude: 1.5,
        }));
        score -= 15;
      } else if (dirty > 10) {
        reasons.push(reason('dirty_workspace', severity.MEDIUM, `${dirty} 个文件与 HEAD 不同（未提交）。`, { fix: '考虑提交一个检查点。', magnitude: 1 }));
        score -= 5;
      } else if (!git.workingTreeClean) {
        reasons.push(reason('slightly_dirty_workspace', 'info', `距上次提交有 ${dirty} 个文件被修改。`, {}));
      }
      if (!git.commitHash && git.isUnborn) {
        reasons.push(reason('no_commits', severity.MEDIUM, '仓库还没有任何提交，无法归因变更历史。', { fix: '创建初始提交。' }));
      }
    }

    if (regressions && regressions.length) {
      const worst = regressions.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a), regressions[0]);
      reasons.push(reason('regression_detected', worst.severity, `自上一快照以来检测到 ${regressions.length} 个回归；最严重：${worst.title}。`, {
        evidence: worst.evidence || [], fix: '打开“变更”页对比两个快照，回退或修复回归。', magnitude: 2,
      }));
      score -= 20;
    }

    if (gate) {
      if (gate.result === GATE_RESULT.FAIL) {
        reasons.push(reason('gate_failed', severity.HIGH, `验收门未通过——${gate.explanation}`, { fix: '满足概述页中列出的失败门禁检查。' }));
        score -= 10;
      } else if (gate.result === GATE_RESULT.BLOCKED) {
        reasons.push(reason('gate_blocked', severity.CRITICAL, `验收门被阻塞——${gate.explanation}`, { fix: '先解决阻塞项，再继续推进。' }));
        score -= 25;
      } else if (gate.result === GATE_RESULT.UNKNOWN) {
        reasons.push(reason('gate_unknown', severity.MEDIUM, '验收门为未知——证据不足，无法评估。', { fix: '在文档中声明阶段与验收标准，然后运行全量扫描。' }));
        score -= 5;
      } else {
        reasons.push(reason('gate_passed', 'info', '验收门通过——当前阶段可以推进。', {}));
      }
    }

    if (metadata && metadata.sensitiveCount) {
      // Informational: detection + protection is the desirable outcome, not a defect.
      reasons.push(reason('sensitive_files_present', 'info', `${metadata.sensitiveCount} 个敏感文件已被识别并保护（内容从未被读取、存储或传输）。`, {
        fix: '确认 .gitignore 已覆盖这些文件。',
      }));
    }
    if (metadata && metadata.truncated) {
      reasons.push(reason('scan_truncated', severity.MEDIUM, '上次扫描达到了配置的文件/深度上限，结果不完整。', {
        fix: '在设置中调大扫描上限，或添加忽略规则。',
      }));
    }

    const hasEvidence = !!build || configuredSuites.length > 0;
    let status;
    if (!hasEvidence) {
      status = PROJECT_HEALTH.UNKNOWN;
      reasons.unshift(reason('no_evidence', severity.MEDIUM, '尚未收集到任何构建或测试证据，因此健康状态未知。', { fix: '运行一次全量扫描。' }));
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
      summary: `${HEALTH_ZH[status] || status}——${sortedReasons.filter((r) => r.severity !== 'info').length} 个问题，${sortedReasons.filter((r) => r.severity === 'info').length} 个正面信号。`,
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
      { key: 'stages', value: stageValue, weight: weights.stage, detail: stageValue === null ? '未声明任何阶段' : `${consideredStages.filter((s) => s.status === STAGE_STATUS.COMPLETED).length}/${consideredStages.length} 个阶段已完成` },
      { key: 'tasks', value: taskValue, weight: weights.task, detail: taskValue === null ? '任务账本为空' : `${countedTasks.filter((t) => t.status === TASK_STATUS.DONE).length}/${countedTasks.length} 个任务已完成` },
      { key: 'acceptance', value: acceptanceValue, weight: weights.acceptance, detail: acceptanceValue === null ? '没有验收标准' : `${realCriteria.filter((c) => c.status === 'satisfied').length}/${realCriteria.length} 条验收标准已满足` },
    ];

    const available = parts.filter((p) => p.value !== null);
    if (!available.length) {
      return {
        value: null, percent: null, confidence: CONFIDENCE.UNKNOWN, parts,
        reason: '尚不存在阶段、任务或验收标准，因此进度未知。Commander 不估算百分比。',
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
      reason: available.map((p) => p.detail).join('；'),
      method: `加权平均：${available.map((p) => `${ZH_KEY[p.key] || p.key}（权重 ${p.weight}）`).join('、')}`,
    };
  }
}

export function healthBadge(status) {
  return ({ healthy: 'Healthy', warning: 'Warning', critical: 'Critical', unknown: 'Unknown' })[status] || status;
}

export { runHealthLabel };
