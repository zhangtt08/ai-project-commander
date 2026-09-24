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
  '不得删除、跳过或弱化现有测试来让测试套件通过。',
  '除非验收标准确实变化，否则不得修改项目规范。',
  '变更范围仅限于上述目标。',
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
        objective: '恢复构建通过',
        reason: `构建命令 \`${build.command}\` 退出码为 ${build.exitCode}。构建不通过时，测试、健康与验收门的所有信号都不可信。`,
        scope: ['在本地复现构建失败', '从根源修复编译/打包错误', '重新运行构建直至通过'],
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['构建退出码为 0', '没有为了通过构建而禁用任何测试'],
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
        objective: `修复 ${unit.failed} 个失败的单元测试`,
        reason: `单元测试 ${unit.total} 个中有 ${unit.failed} 个失败（${unit.framework}）。单元失败能定位缺陷，必须先于端到端工作解决。`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'unit').slice(0, 8).map((c) => `Fix: ${c.name}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`全部 ${unit.total} 个单元测试通过`, '没有删除或跳过任何测试'],
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
        objective: `修复阻塞验收门的 ${e2e.failed} 个失败端到端测试`,
        reason: `单元测试已通过${unit ? `（${unit.passed}/${unit.total}）` : ''}，但端到端为 ${e2e.passed}/${e2e.total}，因此${gate && gate.result !== GATE_RESULT.PASS ? '验收门无法通过' : '面向用户的流程未被验证'}。`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'e2e').slice(0, 8).map((c) => `Fix: ${c.name}${c.file ? ` (${c.file})` : ''}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`端到端测试达到 ${e2e.total}/${e2e.total} 通过`, '单元测试保持通过', '没有删除或跳过任何端到端测试'],
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
        objective: `修复 ${integration.failed} 个失败的集成测试`,
        reason: `集成测试 ${integration.total} 个中有 ${integration.failed} 个失败（${integration.framework}）。`,
        scope: (ctx.failedCases || []).filter((c) => c.suite === 'integration').slice(0, 8).map((c) => `Fix: ${c.name}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: [`全部 ${integration.total} 个集成测试通过`],
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
        objective: `消除危急风险：${worst.title}`,
        reason: `存在 ${criticalRisks.length} 个未解决的危急风险。${worst.description}`,
        scope: criticalRisks.map((r) => `${r.title} —— ${r.suggested_action || '未记录建议操作'}`),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['所有危急风险已解决或被明确接受', '没有引入新的危急风险'],
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
        objective: `排查回归：${worst.title}`,
        reason: `在两个快照之间检测到回归（${worst.type}）。${worst.suggested_action || ''}`.trim(),
        scope: regressions.map((r) => `${r.type}: ${r.title}`),
        relevantFiles,
        constraints: [...BASE_CONSTRAINTS, 'Restore the previous behaviour rather than adjusting the expectations.'],
        acceptance: ['回归指标恢复到之前的值', '修复有测试覆盖'],
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
        objective: `核实可能的规范漂移：${worst.title}`,
        reason: `漂移分析标记了 ${drift.drifts.length} 个信号。${worst.description}`,
        scope: drift.drifts.slice(0, 6).map((d) => `${d.title} — ${d.description}`),
        relevantFiles,
        constraints: [...BASE_CONSTRAINTS, '如果漂移是有意的，请更新规范而不是代码。'],
        acceptance: ['每个漂移信号都被解决或记录为有意为之', '规范与代码保持一致'],
        verification: ['npm run build', 'npm test'],
        evidence: worst.evidence || [],
      });
    }

    // 8. Blocked tasks.
    if (blockedTasks.length) {
      return action({
        rule: 'blocked_task',
        priority: TASK_PRIORITY.P1,
        objective: `解除阻塞：${blockedTasks[0].title}`,
        reason: `${blockedTasks.length} 个任务被阻塞${currentStage ? `，正在拖累阶段“${currentStage.name}”` : ''}。`,
        scope: blockedTasks.map((t) => t.title),
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['阻塞依赖已解除，或任务已重新界定范围并解除阻塞'],
        verification: failedCommands.length ? failedCommands : ['npm test'],
        evidence: blockedTasks.slice(0, 3).map((t) => evTask(t.id)),
      });
    }

    // 9. Gate.
    if (gate && (gate.result === GATE_RESULT.FAIL || gate.result === GATE_RESULT.BLOCKED)) {
      return action({
        rule: 'gate_failed',
        priority: TASK_PRIORITY.P1,
        objective: `通过${currentStage ? `“${currentStage.name}”` : '当前阶段'}的验收门`,
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
        reason: `账本中还有 ${openTasks.length} 个未完成任务。这是优先级最高的一项（优先级 ${next.priority}，来源 ${next.source}）。`,
        scope: [String(next.description || next.title).slice(0, 400)],
        relevantFiles,
        constraints: BASE_CONSTRAINTS,
        acceptance: ['任务已实现并反映在账本中', '现有测试保持通过'],
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
          objective: `开始阶段“${notStarted.name}”`,
          reason: `当前阶段的工作已全部完成，而“${notStarted.name}”尚未开始。`,
          scope: [notStarted.description || `定义并执行“${notStarted.name}”的工作`],
          relevantFiles,
          constraints: [...BASE_CONSTRAINTS, '不要开始属于后续阶段的工作。'],
          acceptance: [`“${notStarted.name}”的任务已在账本中定义`, '构建与测试保持通过'],
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
      objective: hasSpec ? '在规范中补充下一个里程碑' : '创建规范文档，使进度可被度量',
      reason: hasSpec
        ? '没有未完成任务、没有门禁失败、也没有风险。规范必须定义下一个工作单元。'
        : '在工作区中未找到规范文档，Commander 缺少度量进度、验收与漂移的基准。',
      scope: hasSpec
        ? ['在规范中添加下一个里程碑/阶段', '从中推导任务']
        : ['添加包含目标、需求与验收标准的 SPEC.md', '重新运行全量扫描'],
      relevantFiles: relevantFiles.length ? relevantFiles : ['SPEC.md'],
      constraints: BASE_CONSTRAINTS,
      acceptance: hasSpec ? ['新阶段已在规范中声明'] : ['SPEC.md 已存在且至少包含一条验收标准'],
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
