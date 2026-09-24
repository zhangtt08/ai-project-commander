# -*- coding: utf-8 -*-
"""Engine zh batch 3: risk + regression + drift + task-ledger + test-analyzer + stage-manager (dev tool)."""
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

# ---------------- risk.js ----------------
sub('src/core/engines/risk.js', [
    ("out.push(risk('BUILD_FAILED', 'Build is failing', SEVERITY.CRITICAL,\n      `\\`${build.command}\\` exited ${build.exitCode}. No downstream signal is trustworthy while the build is red.`,\n      { evidence: [evCommand(build.command)], action: 'Fix the first build error reported in the Build tab, then re-run the build.' }));",
     "out.push(risk('BUILD_FAILED', '构建失败', SEVERITY.CRITICAL,\n      `\\`${build.command}\\` 退出码 ${build.exitCode}。构建红灯期间，任何下游信号都不可信。`,\n      { evidence: [evCommand(build.command)], action: '在“构建”页修复第一个构建错误，然后重新运行构建。' }));"),
    ("out.push(risk('BUILD_TIMEOUT', 'Build timed out', SEVERITY.HIGH,\n      `The build did not finish within ${build.durationMs}ms.`,\n      { evidence: [evCommand(build.command)], action: 'Check for a hanging watcher/process, or raise buildTimeoutMs in Settings.' }));",
     "out.push(risk('BUILD_TIMEOUT', '构建超时', SEVERITY.HIGH,\n      `构建在 ${build.durationMs}ms 内未完成。`,\n      { evidence: [evCommand(build.command)], action: '检查是否有挂起的进程，或在设置中调大构建超时。' }));"),
    ("out.push(risk(`TESTS_FAILED_${name.toUpperCase()}`, `${name} tests are failing`, name === 'unit' ? SEVERITY.HIGH : SEVERITY.HIGH,\n        `${run.failed} of ${run.total} ${name} tests failed (${run.framework}).`,\n        { evidence: [evTest(name)], action: `Open the Tests tab, inspect the failing ${name} cases and repair them.`, data: { failed: run.failed, total: run.total } }));",
     "out.push(risk(`TESTS_FAILED_${name.toUpperCase()}`, `${ZH_SUITE[name] || name}测试失败`, SEVERITY.HIGH,\n        `${run.total} 个 ${name} 测试中有 ${run.failed} 个失败（${run.framework}）。`,\n        { evidence: [evTest(name)], action: '在“测试”页查看失败的用例并修复。', data: { failed: run.failed, total: run.total } }));"),
    ("out.push(risk(`TEST_PARSE_${name.toUpperCase()}`, `${name} test output could not be parsed`, SEVERITY.MEDIUM,\n        `The ${name} command exited ${run.exitCode} but the output did not match a supported reporter format, so counts are unknown.`,\n        { evidence: [evTest(name)], action: 'Switch to a supported reporter (vitest/jest/playwright default output) or extend the parser.' }));",
     "out.push(risk(`TEST_PARSE_${name.toUpperCase()}`, `${name} 测试输出无法解析`, SEVERITY.MEDIUM,\n        `${name} 命令退出码为 ${run.exitCode}，但输出不匹配任何受支持的 reporter 格式，因此数量未知。`,\n        { evidence: [evTest(name)], action: '改用受支持的 reporter（vitest/jest/playwright 默认输出），或扩展解析器。' }));"),
    ("out.push(risk(`TEST_CONFIDENCE_${name.toUpperCase()}`, `${name} test results are low-confidence`, SEVERITY.LOW,\n        `The ${name} reporter summary disagrees with the process exit code.`,\n        { evidence: [evTest(name)], action: 'Verify the test command is the intended one.' }));",
     "out.push(risk(`TEST_CONFIDENCE_${name.toUpperCase()}`, `${name} 测试结果置信度低`, SEVERITY.LOW,\n        `${name} 的 reporter 汇总与进程退出码不一致。`,\n        { evidence: [evTest(name)], action: '确认测试命令是否是预期的那一个。' }));"),
    ("out.push(risk('MANY_DIRTY_FILES', 'Large uncommitted change set', SEVERITY.HIGH,\n        `${dirty} files differ from HEAD. Large uncommitted diffs hide regressions and make attribution impossible.`,\n        { evidence: [evFile((git.modified || [])[0] || '(working tree)')], action: 'Commit or stash a checkpoint before continuing.', data: { dirty } }));",
     "out.push(risk('MANY_DIRTY_FILES', '大量未提交改动', SEVERITY.HIGH,\n        `${dirty} 个文件与 HEAD 不同。大量未提交差异会掩盖回归，也无法归因。`,\n        { evidence: [evFile((git.modified || [])[0] || '(working tree)')], action: '先提交或 stash 一个检查点再继续。', data: { dirty } }));"),
    ("out.push(risk('DIRTY_FILES', 'Uncommitted changes present', SEVERITY.MEDIUM,\n        `${dirty} files differ from HEAD.`,\n        { action: 'Consider committing a checkpoint so Commander can diff against a known state.', data: { dirty } }));",
     "out.push(risk('DIRTY_FILES', '存在未提交改动', SEVERITY.MEDIUM,\n        `${dirty} 个文件与 HEAD 不同。`,\n        { action: '考虑提交一个检查点，让 Commander 能与已知状态做对比。', data: { dirty } }));"),
    ("out.push(risk('FILE_COUNT_DROP', 'Workspace file count dropped sharply', SEVERITY.HIGH,\n        `Files fell from ${prevCount} to ${metadata.fileCount} since snapshot #${previous.seq}. Files may have been deleted.`,\n        { evidence: [evSnapshot(previous.id)], action: 'Diff the working tree against the previous commit to confirm nothing important was removed.', data: { prevCount, now: metadata.fileCount } }));",
     "out.push(risk('FILE_COUNT_DROP', '工作区文件数骤降', SEVERITY.HIGH,\n        `自快照 #${previous.seq} 以来，文件数从 ${prevCount} 降到 ${metadata.fileCount}，可能有文件被删除。`,\n        { evidence: [evSnapshot(previous.id)], action: '将工作区与上一个提交做对比，确认没有删除重要文件。', data: { prevCount, now: metadata.fileCount } }));"),
    ("out.push(risk('CRITICAL_FILE_DELETED', 'Source files were deleted', SEVERITY.HIGH,\n        `${important.length} source file(s) were deleted in the working tree: ${important.slice(0, 5).join(', ')}.`,\n        { evidence: important.slice(0, 5).map((p) => evFile(p)), action: 'Confirm the deletion was intentional; restore from git if not.', data: { files: important.slice(0, 10) } }));",
     "out.push(risk('CRITICAL_FILE_DELETED', '源码文件被删除', SEVERITY.HIGH,\n        `工作区中删除了 ${important.length} 个源码文件：${important.slice(0, 5).join('、')}。`,\n        { evidence: important.slice(0, 5).map((p) => evFile(p)), action: '确认删除是有意的；否则从 git 恢复。', data: { files: important.slice(0, 10) } }));"),
    ("out.push(risk('BLOCKED_TASKS', 'Tasks are blocked', blocked.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,\n        `${blocked.length} task(s) are blocked: ${blocked.slice(0, 3).map((t) => t.title).join('; ')}.`,\n        { evidence: blocked.slice(0, 3).map((t) => evFile(t.title)), action: 'Resolve the blocking dependency or re-scope the task.', data: { count: blocked.length } }));",
     "out.push(risk('BLOCKED_TASKS', '任务被阻塞', blocked.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,\n        `${blocked.length} 个任务被阻塞：${blocked.slice(0, 3).map((t) => t.title).join('；')}。`,\n        { evidence: blocked.slice(0, 3).map((t) => evFile(t.title)), action: '解决阻塞依赖，或重新界定任务范围。', data: { count: blocked.length } }));"),
    ("out.push(risk('TODO_SURGE', 'TODO/FIXME markers are accumulating', SEVERITY.MEDIUM,\n        `${staleTodo.length} unresolved TODO/FIXME markers exist in source.`,\n        { evidence: staleTodo.slice(0, 3).flatMap((t) => t.evidence || []), action: 'Triage markers into real tasks or delete the stale ones.', data: { count: staleTodo.length } }));",
     "out.push(risk('TODO_SURGE', 'TODO/FIXME 标记在累积', SEVERITY.MEDIUM,\n        `源码中存在 ${staleTodo.length} 个未解决的 TODO/FIXME 标记。`,\n        { evidence: staleTodo.slice(0, 3).flatMap((t) => t.evidence || []), action: '把标记分诊为真实任务，或清理过期标记。', data: { count: staleTodo.length } }));"),
    ("out.push(risk('ACCEPTANCE_NOT_MET', 'Acceptance criteria are unmet', unmetAcceptance.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,\n        `${unmetAcceptance.length} acceptance criterion/criteria are still unmet, for example: \"${truncate(unmetAcceptance[0].text, 160)}\".`,\n        { evidence: unmetAcceptance.slice(0, 3).flatMap((c) => c.evidence || []), action: 'Complete the criteria before declaring the stage done.', data: { count: unmetAcceptance.length } }));",
     "out.push(risk('ACCEPTANCE_NOT_MET', '验收标准未满足', unmetAcceptance.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,\n        `仍有 ${unmetAcceptance.length} 条验收标准未满足，例如：“${truncate(unmetAcceptance[0].text, 160)}”。`,\n        { evidence: unmetAcceptance.slice(0, 3).flatMap((c) => c.evidence || []), action: '在宣布阶段完成之前完成这些标准。', data: { count: unmetAcceptance.length } }));"),
    ("out.push(risk('SENSITIVE_FILES_PRESENT', 'Sensitive files present in the workspace', SEVERITY.MEDIUM,\n        `${metadata.sensitiveCount} sensitive file(s) matched the protection rules. Their contents were NOT read, stored or transmitted.`,\n        { evidence: (metadata.sensitiveFiles || []).slice(0, 5).map((f) => evFile(f.path, f.rule)), action: 'Confirm these files are covered by .gitignore and were never committed.', data: { count: metadata.sensitiveCount } }));",
     "out.push(risk('SENSITIVE_FILES_PRESENT', '工作区存在敏感文件', SEVERITY.MEDIUM,\n        `${metadata.sensitiveCount} 个文件命中敏感规则。其内容未被读取、存储或传输。`,\n        { evidence: (metadata.sensitiveFiles || []).slice(0, 5).map((f) => evFile(f.path, f.rule)), action: '确认这些文件已被 .gitignore 覆盖，且从未被提交。', data: { count: metadata.sensitiveCount } }));"),
    ("out.push(risk('OVERSIZED_FILE', 'Very large source file', SEVERITY.LOW,\n        `${oversized.length} file(s) exceed 1 MB, largest ${Math.round(oversized[0].sizeBytes / 1024)} KB (${oversized[0].path}).`,\n        { evidence: oversized.slice(0, 3).map((f) => evFile(f.path)), action: 'Split large files; they are hard for humans and agents to reason about.', data: { files: oversized.slice(0, 3) } }));",
     "out.push(risk('OVERSIZED_FILE', '存在超大源码文件', SEVERITY.LOW,\n        `${oversized.length} 个文件超过 1 MB，最大的 ${Math.round(oversized[0].sizeBytes / 1024)} KB（${oversized[0].path}）。`,\n        { evidence: oversized.slice(0, 3).map((f) => evFile(f.path)), action: '拆分大文件；人对它们和 Agent 对它们都难以推理。', data: { files: oversized.slice(0, 3) } }));"),
    ("out.push(risk('UNKNOWN_SCRIPT', `Suspicious npm script \"${name}\"`, SEVERITY.HIGH,\n            `The script \"${name}\" contains a destructive or remote-execution pattern: ${truncate(String(body), 200)}`,",
     "out.push(risk('UNKNOWN_SCRIPT', `可疑的 npm 脚本 “${name}”`, SEVERITY.HIGH,\n            `脚本 “${name}” 包含破坏性或远程执行模式：${truncate(String(body), 200)}`,"),
    ("{ evidence: [evFile('package.json', `scripts.${name}`)], action: 'Review this script manually. CommandRunner will refuse to run it automatically.', data: { script: name } }));",
     "{ evidence: [evFile('package.json', `scripts.${name}`)], action: '请人工审查该脚本；CommandRunner 会拒绝自动运行它。', data: { script: name } }));"),
    ("out.push(risk('NO_LOCKFILE', 'No dependency lockfile', SEVERITY.LOW,\n        'package.json exists but no lockfile was found, so installs are not reproducible.',\n        { evidence: [evFile('package.json')], action: 'Commit a lockfile generated by the project\\'s package manager.', data: {} }));",
     "out.push(risk('NO_LOCKFILE', '缺少依赖锁定文件', SEVERITY.LOW,\n        '存在 package.json 但未找到 lockfile，依赖安装不可复现。',\n        { evidence: [evFile('package.json')], action: '提交由项目包管理器生成的 lockfile。', data: {} }));"),
    ("out.push(risk('MOCK_LEAK', 'Mock/stub code found in production source', SEVERITY.HIGH,\n        `Mock-like identifiers were found outside test directories: ${metadata.e2eMockLeak.slice(0, 3).join(', ')}.`,\n        { evidence: metadata.e2eMockLeak.slice(0, 3).map((p) => evFile(p)), action: 'Move mocks behind a test-only boundary or remove them from shipped code.', data: { files: metadata.e2eMockLeak.slice(0, 5) } }));",
     "out.push(risk('MOCK_LEAK', '生产源码中发现 Mock/桩代码', SEVERITY.HIGH,\n        `在测试目录之外发现了 Mock 类标识：${metadata.e2eMockLeak.slice(0, 3).join('、')}。`,\n        { evidence: metadata.e2eMockLeak.slice(0, 3).map((p) => evFile(p)), action: '把 Mock 移到仅测试可见的边界内，或从发布代码中移除。', data: { files: metadata.e2eMockLeak.slice(0, 5) } }));"),
    ("out.push(risk(`REGRESSION_${r.type.toUpperCase()}`, `Regression: ${r.title}`, r.severity,\n        `Detected between snapshot #${(r.before || {}).seq ?? '?'} and #${(r.after || {}).seq ?? '?'}.`,\n        { evidence: r.evidence || [], action: r.suggested_action || 'Inspect the Changes tab and repair or revert.', source: 'regression', data: { type: r.type } }));",
     "out.push(risk(`REGRESSION_${r.type.toUpperCase()}`, `回归：${r.title}`, r.severity,\n        `在快照 #${(r.before || {}).seq ?? '?'} 与 #${(r.after || {}).seq ?? '?'} 之间检测到。`,\n        { evidence: r.evidence || [], action: r.suggested_action || '查看“变更”页并修复或回退。', source: 'regression', data: { type: r.type } }));"),
    ("out.push(risk('NO_EVIDENCE', 'No engineering evidence collected', SEVERITY.MEDIUM,\n      'The project has never been scanned, so no risk analysis is possible.',\n      { action: 'Add the project and run a full scan.' }));",
     "out.push(risk('NO_EVIDENCE', '尚未采集任何工程证据', SEVERITY.MEDIUM,\n      '该项目从未被扫描，无法进行风险分析。',\n      { action: '添加项目并运行一次全量扫描。' }));"),
])
s = io.open('src/core/engines/risk.js', encoding='utf-8').read()
if 'const ZH_SUITE' not in s:
    s = s.replace("const SUSPICIOUS_SCRIPT_RE",
                  "const ZH_SUITE = { unit: '单元', integration: '集成', e2e: '端到端' };\nconst SUSPICIOUS_SCRIPT_RE")
    io.open('src/core/engines/risk.js', 'w', encoding='utf-8', newline='').write(s)
    print('ZH_SUITE added')

# ---------------- regression.js ----------------
sub('src/core/engines/regression.js', [
    ("'Build regressed from PASS to FAIL',", "'构建从通过退化为失败',"),
    ("'Fix the build immediately — every other signal is unreliable until it is green.'));",
     "'立即修复构建——构建不绿之前，其他信号都不可靠。'));"),
    ("`${key} tests regressed from PASS to FAIL`,", "`${ZH_SUITE[key]}测试从通过退化为失败`,"),
    ("`Repair the ${key} failures before advancing the stage.`));", "`在推进阶段之前，先修复${ZH_SUITE[key]}的失败。`));"),
    ("`${key}: passing test count dropped from ${prevPassed} to ${curPassed}`,", "`${ZH_SUITE[key]}：通过数从 ${prevPassed} 降到 ${curPassed}`,"),
    ("'Identify which tests stopped passing and fix them.'));", "'找出不再通过的测试并修复。'));"),
    ("`${key}: total test count dropped from ${prevTotal} to ${curTotal}`,", "`${ZH_SUITE[key]}：测试总数从 ${prevTotal} 降到 ${curTotal}`,"),
    ("'Tests appear to have been removed. Confirm this was intentional; a silent test deletion is treated as a regression.'));",
     "'测试似乎被删除了。请确认这是有意的；静默删除测试会被视为回归。'));"),
    ("`Critical risks increased from ${prevCritical} to ${curCritical}`,", "`危急风险从 ${prevCritical} 增加到 ${curCritical}`,"),
    ("'Open the Risks tab and clear the new critical risks.'));", "'打开风险面板，清除新增的危急风险。'));"),
    ("`Workspace file count dropped from ${previous.file_count} to ${current.metadata.fileCount}`,", "`工作区文件数从 ${previous.file_count} 降到 ${current.metadata.fileCount}`,"),
    ("'Verify that no important files were deleted.'));", "'请核实没有删除重要文件。'));"),
    ("`Acceptance gate regressed from ${previous.gate_json.result} to ${current.gate.result}`,", "`验收门从 ${previous.gate_json.result} 退化为 ${current.gate.result}`,"),
    ("'The stage can no longer advance. Fix the failing gate checks.'));", "'该阶段无法再推进。请修复失败的门禁检查。'));"),
])
s = io.open('src/core/engines/regression.js', encoding='utf-8').read()
if 'const ZH_SUITE' not in s:
    s = s.replace("import { sha1 } from '../util.js';",
                  "import { sha1 } from '../util.js';\n\nconst ZH_SUITE = { unit: '单元', integration: '集成', e2e: '端到端' };")
    io.open('src/core/engines/regression.js', 'w', encoding='utf-8', newline='').write(s)
    print('ZH_SUITE added')

# ---------------- drift.js ----------------
sub('src/core/engines/drift.js', [
    ("title: 'Work is happening without a written specification',\n      description: `${tasks.length} task(s) exist but no specification document was found. There is no baseline to measure drift against.`,",
     "title: '在没有书面规范的情况下开展工作',\n      description: `存在 ${tasks.length} 个任务，但未找到规范文档，缺少度量漂移的基准。`,"),
    ("title: 'Requirements have no satisfied evidence',\n      description: `${requirements.length} requirement(s) were extracted but no acceptance criterion is marked satisfied, and no implementation evidence was linked.`,",
     "title: '需求没有任何满足证据',\n      description: `提取到 ${requirements.length} 条需求，但没有验收标准被标记为已满足，也没有关联任何实现证据。`,"),
    ("title: `Requirement ${req.requirement_ref || ''} has no linked work`.trim(),",
     "title: `需求 ${req.requirement_ref || ''} 没有关联工作`.trim(),"),
    ("description: `No task or code hint references \"${String(req.text).slice(0, 120)}\". The requirement may be unimplemented.`,",
     "description: `没有任务或代码线索引用“${String(req.text).slice(0, 120)}”。该需求可能尚未实现。`,"),
    ("title: 'Test files were removed',\n        description: `Test file count dropped from ${prevRoleCounts.test} to ${metadata.roleCounts.test}. Removing tests to make a suite pass is a drift signal.`,",
     "title: '测试文件被移除',\n        description: `测试文件数从 ${prevRoleCounts.test} 降到 ${metadata.roleCounts.test}。为了让测试套件通过而删除测试，是漂移信号。`,"),
    ("title: 'Large change set with no traceable link to planned work',\n          description: `${unrelated.length} of ${changed.length} changed files cannot be linked to any task in the ledger. This may be scope creep.`,",
     "title: '大量变更与计划工作无关联',\n          description: `${changed.length} 个变更文件中有 ${unrelated.length} 个无法关联到账本中的任何任务，可能存在范围蔓延。`,"),
    ("title: 'Tests are green while acceptance criteria remain unmet',\n      description: `${unmet.length} acceptance criteria are unmet even though the test suites pass. The tests may not cover the promised behaviour.`,",
     "title: '测试全绿但验收标准仍未满足',\n      description: `尽管测试套件通过，仍有 ${unmet.length} 条验收标准未满足。测试可能没有覆盖承诺的行为。`,"),
    ("? 'Possible Drift — these are heuristics based on file and task evidence. Verify before acting.'\n      : (hasSpec ? 'No drift signals detected against the current specification.' : 'No specification baseline found, so drift cannot be assessed.'),",
     "? '可能存在漂移——这些是基于文件与任务证据的启发式判断，请先核实再行动。'\n      : (hasSpec ? '未检测到与当前规范相悖的漂移信号。' : '未找到规范基线，无法评估漂移。'),"),
])
print('batch3 done')
