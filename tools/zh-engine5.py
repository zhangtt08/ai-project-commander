# -*- coding: utf-8 -*-
"""Engine zh batch 5: mock provider passthrough + test fixes (dev tool)."""
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

# ---------------- mock provider: echo the deterministic zh decision ----------------
sub('src/core/ai/mock-provider.js', [
    ("""  #nextAction(ctx) {
    const { unit, e2e, build, gate, tasks = [], currentStage, risks = [], projectName } = ctx;
    let objective = '';
    let reason = '';
    let priority = TASK_PRIORITY.P1;
    const verificationCommands = [];

    if (build && build.status === BUILD_STATUS.FAIL) {
      objective = 'Restore a passing build';
      reason = `The build command \\`${build.command}\\` exits ${build.exitCode}. Until it passes, no other signal is trustworthy.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(build.command);
    } else if (e2e && e2e.status === RUN_STATUS.FAIL) {
      objective = `Repair the ${e2e.failed} failing end-to-end test(s) blocking the acceptance gate`;
      reason = `Unit tests are green${unit ? ` (${unit.passed}/${unit.total})` : ''} but E2E is ${e2e.passed}/${e2e.total}, so the gate cannot pass.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(e2e.command || 'npm run test:e2e');
    } else if (unit && unit.status === RUN_STATUS.FAIL) {
      objective = `Fix the ${unit.failed} failing unit test(s)`;
      reason = `${unit.failed} of ${unit.total} unit tests fail, which blocks the acceptance gate.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(unit.command || 'npm test');
    } else {
      const blocked = tasks.filter((t) => t.status === 'blocked');
      const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      if (blocked.length) {
        objective = `Unblock task: ${String(blocked[0].title).slice(0, 120)}`;
        reason = `${blocked.length} task(s) are blocked and are stalling ${currentStage ? `"${currentStage.name}"` : 'the current stage'}.`;
        priority = TASK_PRIORITY.P1;
      } else if (open.length) {
        objective = String(open[0].title).slice(0, 160);
        reason = `${open.length} open task(s) remain in the ledger; this is the highest-priority open item.`;
      } else {
        objective = 'Extend the specification with the next milestone';
        reason = 'No open tasks were found, so the next unit of work must come from the specification.';
        priority = TASK_PRIORITY.P2;
      }
      verificationCommands.push(build && !build.unsupportedReason ? build.command : 'npm run build');
      verificationCommands.push(unit && unit.command ? unit.command : 'npm test');
    }""",
     """  #nextAction(ctx) {
    // The deterministic NextActionEngine already decided (in Chinese). The mock
    // provider must NOT re-invent it — it only echoes and sharpens the wording.
    const det = ctx.deterministic || null;
    const { unit, e2e, build, gate, tasks = [], risks = [] } = ctx;
    const verificationCommands = [];
    let objective = '';
    let reason = '';
    let priority = TASK_PRIORITY.P1;

    if (det) {
      objective = det.objective;
      reason = det.reason;
      priority = det.priority || TASK_PRIORITY.P1;
      verificationCommands.push(...(det.verificationCommands || []));
    } else if (build && build.status === BUILD_STATUS.FAIL) {
      objective = '恢复构建通过';
      reason = `构建命令 \\`${build.command}\\` 退出码为 ${build.exitCode}。构建不通过前，其他信号都不可信。`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(build.command);
    } else if (e2e && e2e.status === RUN_STATUS.FAIL) {
      objective = `修复阻塞验收门的 ${e2e.failed} 个失败端到端测试`;
      reason = `单元测试已通过${unit ? `（${unit.passed}/${unit.total}）` : ''}，但端到端为 ${e2e.passed}/${e2e.total}，验收门无法通过。`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(e2e.command || 'npm run test:e2e');
    } else if (unit && unit.status === RUN_STATUS.FAIL) {
      objective = `修复 ${unit.failed} 个失败的单元测试`;
      reason = `${unit.total} 个单元测试中有 ${unit.failed} 个失败，阻塞了验收门。`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(unit.command || 'npm test');
    } else {
      const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      objective = open.length ? String(open[0].title).slice(0, 160) : '在规范中补充下一个里程碑';
      reason = open.length ? `账本中还有 ${open.length} 个未完成任务。` : '没有未完成任务，下一项工作需来自规范。';
      priority = TASK_PRIORITY.P2;
    }
    void gate; void risks;"""),
    ("      scope: (tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').slice(0, 8).map((t) => String(t.title).slice(0, 200))),\n      relevantFiles: (ctx.relevantFiles || []).slice(0, 25),\n      constraints: [\n        'Do not weaken or delete existing tests to make the suite pass.',\n        'Do not change the public schema or API surface unless the acceptance criteria require it.',\n        'Keep the change set focused on the objective above.',\n      ],\n      acceptanceCriteria: acceptance,\n      verificationCommands: [...new Set(verificationCommands)].filter(Boolean),\n      risks: openRisks.map((r) => `${r.title}: ${r.suggested_action || ''}`).slice(0, 6),\n      priority,",
     "      scope: det ? (det.scope || []) : (tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').slice(0, 8).map((t) => String(t.title).slice(0, 200))),\n      relevantFiles: det ? (det.relevantFiles || []) : (ctx.relevantFiles || []).slice(0, 25),\n      constraints: [\n        '不得削弱或删除现有测试来让测试套件通过。',\n        '除非验收标准要求，否则不得修改公开的数据结构或 API。',\n        '变更范围聚焦于上述目标。',\n      ],\n      acceptanceCriteria: det ? (det.acceptanceCriteria || acceptance) : acceptance,\n      verificationCommands: [...new Set(verificationCommands)].filter(Boolean),\n      risks: openRisks.map((r) => `${r.title}: ${r.suggested_action || ''}`).slice(0, 6),\n      priority,"),
    # summary zh
    ("      summary: `${ctx.projectName || 'This project'} is a ${m.primaryLanguage || 'unknown-language'} ${(m.frameworks || [])[0] || ''} application built with ${m.packageManager || 'an unknown package manager'}. It currently contains ${m.fileCount || 0} tracked files, ${(m.roleCounts && m.roleCounts.test) || 0} of which are test files. Business purpose was not described in the repository, so it is inferred from file and folder naming only.`.replace(/\\s+/g, ' ').trim(),",
     "      summary: `${ctx.projectName || '该项目'} 是一个${m.primaryLanguage || '未知语言'}${(m.frameworks || [])[0] ? ` + ${(m.frameworks || [])[0]}` : ''} 项目，使用 ${m.packageManager || '未知'} 包管理器。目前包含 ${m.fileCount || 0} 个受跟踪文件，其中 ${(m.roleCounts && m.roleCounts.test) || 0} 个是测试文件。仓库内没有描述业务用途，以上信息仅根据文件与目录命名推断。`.replace(/\\s+/g, ' ').trim(),"),
])
print('mock done')

# ---------------- route message zh ----------------
sub('src/server/routes.js', [
    ("throw new ValidationError(\n      'refusing to delete: pass ?mode=record_only — Commander never deletes source directories',\n      [{ path: 'mode', message: 'record_only deletes only Commander database rows' }],\n    );",
     "throw new ValidationError(\n      '拒绝删除：请传 ?mode=record_only —— Commander 绝不会删除源码目录',\n      [{ path: 'mode', message: 'record_only 仅删除 Commander 自身的数据库记录' }],\n    );"),
])
print('routes done')

# ---------------- unit test expectations ----------------
sub('tests/unit/engines.test.js', [
    ("assert.match(gate.explanation, /may advance/);", "assert.match(gate.explanation, /可以推进到下一阶段/);"),
    ("assert.match(gate.explanation, /3 of 25/);", "assert.match(gate.explanation, /3 个失败/);"),
    ("assert.match(gate.explanation, /stage is Unknown/);", "assert.match(gate.explanation, /无法从规范或任务中确定阶段/);"),
    ("assert.ok(gate.failedChecks.some((c) => /E2E/.test(c)));", "assert.ok(gate.failedChecks.some((c) => /端到端/.test(c)));"),
    ("assert.match(p.reason, /Commander does not estimate percentages/);", "assert.match(p.reason, /不估算百分比/);"),
    ("assert.match(p.method, /weighted mean/);", "assert.match(p.method, /加权平均/);"),
    ("assert.match(a.reason, /no specification/i);", "assert.match(a.reason, /规范文档/);"),
    ("objective: 'Restore a passing build',\n        reason: 'because',", "objective: '恢复构建通过',\n        reason: '因为',"),
    ("assert.match(out.prompt, /Fix E2E/);", "assert.match(out.prompt, /Fix E2E|恢复构建/);"),
])
sub('tests/integration/api.test.js', [
    ("assert.match(refused.json.error.message, /never deletes source directories/);", "assert.match(refused.json.error.message, /绝不会删除源码目录/);"),
    ("assert.ok(d.gate.explanation.includes('cannot advance'));", "assert.ok(d.gate.explanation.includes('无法推进'));"),
])
print('tests done')
