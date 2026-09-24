# -*- coding: utf-8 -*-
"""Engine-level zh migration, batch 1: progress + next-action (dev tool)."""
import io

def sub(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    miss = []
    for pair in pairs:
        a, b = pair[0], pair[1]
        if a in s:
            s = s.replace(a, b)
        else:
            miss.append(a[:70])
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print(('OK  ' if not miss else 'PART') + ' ' + path + ('  missed: ' + ' || '.join(miss) if miss else ''))

# ---------------- progress.js ----------------
sub('src/core/engines/health.js', [
    ("detail: stageValue === null ? 'no stages declared' : `${consideredStages.filter((s) => s.status === STAGE_STATUS.COMPLETED).length}/${consideredStages.length} stages completed`",
     "detail: stageValue === null ? '未声明任何阶段' : `${consideredStages.filter((s) => s.status === STAGE_STATUS.COMPLETED).length}/${consideredStages.length} 个阶段已完成`"),
    ("detail: taskValue === null ? 'no tasks in the ledger' : `${countedTasks.filter((t) => t.status === TASK_STATUS.DONE).length}/${countedTasks.length} tasks done`",
     "detail: taskValue === null ? '任务账本为空' : `${countedTasks.filter((t) => t.status === TASK_STATUS.DONE).length}/${countedTasks.length} 个任务已完成`"),
    ("detail: acceptanceValue === null ? 'no acceptance criteria' : `${realCriteria.filter((c) => c.status === 'satisfied').length}/${realCriteria.length} criteria satisfied`",
     "detail: acceptanceValue === null ? '没有验收标准' : `${realCriteria.filter((c) => c.status === 'satisfied').length}/${realCriteria.length} 条验收标准已满足`"),
    ("reason: 'No stages, tasks or acceptance criteria exist, so progress is Unknown. Commander does not estimate percentages.',",
     "reason: '尚不存在阶段、任务或验收标准，因此进度未知。Commander 不估算百分比。',"),
    ("reason: available.map((p) => p.detail).join('; '),", "reason: available.map((p) => p.detail).join('；'),"),
    ("method: `weighted mean of ${available.map((p) => `${p.key}(${p.weight})`).join(', ')}`,",
     "method: `加权平均：${available.map((p) => `${ZH_KEY[p.key] || p.key}（权重 ${p.weight}）`).join('、')}`,"),
])
print('health(progress) done')

# ---------------- next-action.js ----------------
sub('src/core/engines/next-action.js', [
    # rule 1 build_failed
    ("objective: 'Restore a passing build',", "objective: '恢复构建通过',"),
    ("reason: `The build command \\`${build.command}\\` exits ${build.exitCode}. While the build is red, no test, health or gate signal can be trusted.`,",
     "reason: `构建命令 \\`${build.command}\\` 退出码为 ${build.exitCode}。构建不通过时，测试、健康与验收门的所有信号都不可信。`,"),
    ("scope: ['Reproduce the build failure locally', 'Fix the compile/bundle error at its root cause', 'Re-run the build to green'],",
     "scope: ['在本地复现构建失败', '从根源修复编译/打包错误', '重新运行构建直至通过'],"),
    ("acceptance: ['Build exits with code 0', 'No test was disabled to make the build pass'],",
     "acceptance: ['构建退出码为 0', '没有为了通过构建而禁用任何测试'],"),
    # rule 2 unit_failed
    ("objective: `Fix the ${unit.failed} failing unit test${unit.failed === 1 ? '' : 's'}`,",
     "objective: `修复 ${unit.failed} 个失败的单元测试`,"),
    ("reason: `Unit tests report ${unit.failed} failure(s) out of ${unit.total} (${unit.framework}). Unit failures localise the defect, so they must be resolved before end-to-end work.`,",
     "reason: `单元测试 ${unit.total} 个中有 ${unit.failed} 个失败（${unit.framework}）。单元失败能定位缺陷，必须先于端到端工作解决。`,"),
    ("acceptance: [`All ${unit.total} unit tests pass`, 'No test was deleted or marked skipped'],",
     "acceptance: [`全部 ${unit.total} 个单元测试通过`, '没有删除或跳过任何测试'],"),
    # rule 3 e2e_failed
    ("objective: `Repair the ${e2e.failed} failing end-to-end test${e2e.failed === 1 ? '' : 's'} blocking the acceptance gate`,",
     "objective: `修复阻塞验收门的 ${e2e.failed} 个失败端到端测试`,"),
    ("reason: `Unit tests are green${unit ? ` (${unit.passed}/${unit.total})` : ''} but E2E reports ${e2e.passed}/${e2e.total}, so ${gate && gate.result !== GATE_RESULT.PASS ? 'the acceptance gate cannot pass' : 'the user-facing flows are unverified'}.`,",
     "reason: `单元测试已通过${unit ? `（${unit.passed}/${unit.total}）` : ''}，但端到端为 ${e2e.passed}/${e2e.total}，因此${gate && gate.result !== GATE_RESULT.PASS ? '验收门无法通过' : '面向用户的流程未被验证'}。`,"),
    ("acceptance: [`E2E reaches ${e2e.total}/${e2e.total} PASS`, 'Unit tests remain green', 'No E2E test was deleted or skipped'],",
     "acceptance: [`端到端测试达到 ${e2e.total}/${e2e.total} 通过`, '单元测试保持通过', '没有删除或跳过任何端到端测试'],"),
    # rule 4 integration_failed
    ("objective: `Fix the ${integration.failed} failing integration test${integration.failed === 1 ? '' : 's'}`,",
     "objective: `修复 ${integration.failed} 个失败的集成测试`,"),
    ("reason: `Integration tests report ${integration.failed} of ${integration.total} failing (${integration.framework}).`,",
     "reason: `集成测试 ${integration.total} 个中有 ${integration.failed} 个失败（${integration.framework}）。`,"),
    ("acceptance: [`All ${integration.total} integration tests pass`],", "acceptance: [`全部 ${integration.total} 个集成测试通过`],"),
    # rule 5 critical_risk
    ("objective: `Resolve critical risk: ${worst.title}`,", "objective: `消除危急风险：${worst.title}`,"),
    ("reason: `${criticalRisks.length} open critical risk(s) exist. ${worst.description}`,", "reason: `存在 ${criticalRisks.length} 个未解决的危急风险。${worst.description}`,"),
    ("scope: criticalRisks.map((r) => `${r.title} — ${r.suggested_action || 'no suggested action recorded'}`),",
     "scope: criticalRisks.map((r) => `${r.title} —— ${r.suggested_action || '未记录建议操作'}`),"),
    ("acceptance: ['All critical risks are resolved or explicitly accepted', 'No new critical risk is introduced'],",
     "acceptance: ['所有危急风险已解决或被明确接受', '没有引入新的危急风险'],"),
    # rule 6 regression
    ("objective: `Investigate regression: ${worst.title}`,", "objective: `排查回归：${worst.title}`,"),
    ("reason: `A regression was detected between two snapshots (${worst.type}). ${worst.suggested_action || ''}`.trim(),",
     "reason: `在两个快照之间检测到回归（${worst.type}）。${worst.suggested_action || ''}`.trim(),"),
    ("acceptance: ['The regressed metric returns to its previous value', 'The fix is covered by a test'],",
     "acceptance: ['回归指标恢复到之前的值', '修复有测试覆盖'],"),
    # rule 7 drift
    ("objective: `Verify possible specification drift: ${worst.title}`,", "objective: `核实可能的规范漂移：${worst.title}`,"),
    ("reason: `Drift analysis flagged ${drift.drifts.length} signal(s). ${worst.description}`,",
     "reason: `漂移分析标记了 ${drift.drifts.length} 个信号。${worst.description}`,"),
    ("constraints: [...BASE_CONSTRAINTS, 'If the drift is intentional, update the specification instead of the code.'],",
     "constraints: [...BASE_CONSTRAINTS, '如果漂移是有意的，请更新规范而不是代码。'],"),
    ("acceptance: ['Each drift signal is either resolved or documented as intentional', 'Specification and code agree'],",
     "acceptance: ['每个漂移信号都被解决或记录为有意为之', '规范与代码保持一致'],"),
    # rule 8 blocked task
    ("objective: `Unblock: ${blockedTasks[0].title}`,", "objective: `解除阻塞：${blockedTasks[0].title}`,"),
    ("reason: `${blockedTasks.length} task(s) are blocked${currentStage ? ` and are stalling stage \"${currentStage.name}\"` : ''}.`,",
     "reason: `${blockedTasks.length} 个任务被阻塞${currentStage ? `，正在拖累阶段“${currentStage.name}”` : ''}。`,"),
    ("acceptance: ['The blocking dependency is resolved or the task is re-scoped and unblocked'],",
     "acceptance: ['阻塞依赖已解除，或任务已重新界定范围并解除阻塞'],"),
    # rule 9 gate
    ("objective: `Clear the acceptance gate for ${currentStage ? currentStage.name : 'the current stage'}`,",
     "objective: `通过${currentStage ? `“${currentStage.name}”` : '当前阶段'}的验收门`,"),
    # rule 10 open task
    ("reason: `${openTasks.length} open task(s) remain in the ledger. This is the highest-priority item (${next.priority}, source: ${next.source}).`,",
     "reason: `账本中还有 ${openTasks.length} 个未完成任务。这是优先级最高的一项（优先级 ${next.priority}，来源 ${next.source}）。`,"),
    ("acceptance: ['The task is implemented and reflected in the ledger', 'Existing tests remain green'],",
     "acceptance: ['任务已实现并反映在账本中', '现有测试保持通过'],"),
    # rule 11 next stage
    ("objective: `Begin stage \"${notStarted.name}\"`,", "objective: `开始阶段“${notStarted.name}”`,"),
    ("reason: `All work in the current stage is complete and \"${notStarted.name}\" has not started yet.`,",
     "reason: `当前阶段的工作已全部完成，而“${notStarted.name}”尚未开始。`,"),
    ("scope: [notStarted.description || `Define and execute the work for ${notStarted.name}`],",
     "scope: [notStarted.description || `定义并执行“${notStarted.name}”的工作`],"),
    ("constraints: [...BASE_CONSTRAINTS, 'Do not start work that belongs to a later stage.'],",
     "constraints: [...BASE_CONSTRAINTS, '不要开始属于后续阶段的工作。'],"),
    ("acceptance: [`Tasks for \"${notStarted.name}\" are defined in the ledger`, 'Build and tests remain green'],",
     "acceptance: [`“${notStarted.name}”的任务已在账本中定义`, '构建与测试保持通过'],"),
    # rule 12 no_spec
    ("objective: hasSpec ? 'Extend the specification with the next milestone' : 'Create a specification so progress can be measured',",
     "objective: hasSpec ? '在规范中补充下一个里程碑' : '创建规范文档，使进度可被度量',"),
    ("reason: hasSpec\n        ? 'No open tasks, no gate failures and no risks were found. The specification must define the next unit of work.'\n        : 'No specification document was found in this workspace, so Commander has no baseline to measure progress, acceptance or drift against.',",
     "reason: hasSpec\n        ? '没有未完成任务、没有门禁失败、也没有风险。规范必须定义下一个工作单元。'\n        : '在工作区中未找到规范文档，Commander 缺少度量进度、验收与漂移的基准。',"),
    ("scope: hasSpec\n        ? ['Add the next milestone/stage to the specification', 'Derive tasks from it']\n        : ['Add SPEC.md with Goals, Requirements and Acceptance Criteria', 'Re-run a full scan'],",
     "scope: hasSpec\n        ? ['在规范中添加下一个里程碑/阶段', '从中推导任务']\n        : ['添加包含目标、需求与验收标准的 SPEC.md', '重新运行全量扫描'],"),
    ("acceptance: hasSpec ? ['New stage is declared in the specification'] : ['SPEC.md exists with at least one acceptance criterion'],",
     "acceptance: hasSpec ? ['新阶段已在规范中声明'] : ['SPEC.md 已存在且至少包含一条验收标准'],"),
    # shared
    ("const BASE_CONSTRAINTS = [\n  'Do not delete, skip or weaken existing tests to make the suite pass.',\n  'Do not modify the project specification unless the acceptance criteria genuinely changed.',\n  'Keep the change set scoped to the objective.',\n];",
     "const BASE_CONSTRAINTS = [\n  '不得删除、跳过或弱化现有测试来让测试套件通过。',\n  '除非验收标准确实变化，否则不得修改项目规范。',\n  '变更范围仅限于上述目标。',\n];"),
    ("relevantFiles: relevantFiles.length ? relevantFiles : ['SPEC.md'],", "relevantFiles: relevantFiles.length ? relevantFiles : ['SPEC.md'],"),
])
print('next-action done')
