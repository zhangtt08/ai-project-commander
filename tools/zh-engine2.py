# -*- coding: utf-8 -*-
"""Engine zh batch 2: health reasons + acceptance gate (dev tool)."""
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

# ---------------- health.js ----------------
sub('src/core/engines/health.js', [
    ("reason('build_failed', severity.CRITICAL, `Build FAILED — \\`${build.command}\\` exited ${build.exitCode}.`, {\n          evidence: [evCommand(build.command)], fix: 'Fix the build before any further work; nothing else is trustworthy until it is green.', magnitude: 3,\n        }));",
     "reason('build_failed', severity.CRITICAL, `构建失败——\\`${build.command}\\` 退出码 ${build.exitCode}。`, {\n          evidence: [evCommand(build.command)], fix: '先修复构建；构建不绿之前，其他一切都不可信。', magnitude: 3,\n        }));"),
    ("reasons.push(reason('build_timeout', severity.HIGH, `Build timed out after ${build.durationMs}ms.`, { fix: 'Investigate a hang or raise the build timeout in Settings.' }));",
     "reasons.push(reason('build_timeout', severity.HIGH, `构建在 ${build.durationMs}ms 后超时。`, { fix: '排查挂起的进程，或在设置中调大构建超时时间。' }));"),
    ("reasons.push(reason('build_unsupported', severity.LOW, `No build command detected (${build.unsupportedReason || 'not applicable'}).`, { fix: 'Add a \"build\" script to package.json if this project produces an artifact.' }));",
     "reasons.push(reason('build_unsupported', severity.LOW, `未检测到构建命令（${build.unsupportedReason || '不适用'}）。`, { fix: '如果该项目会产生构建产物，请在 package.json 中添加 \"build\" 脚本。' }));"),
    ("reasons.push(reason('build_passed', 'info', `Build PASSED in ${build.durationMs}ms.`, { evidence: [evCommand(build.command)] }));",
     "reasons.push(reason('build_passed', 'info', `构建通过，耗时 ${build.durationMs}ms。`, { evidence: [evCommand(build.command)] }));"),
    ("reasons.push(reason('build_unknown', severity.MEDIUM, 'Build has never been run for this project.', { fix: 'Run a full scan to execute the detected build command.' }));",
     "reasons.push(reason('build_unknown', severity.MEDIUM, '该项目从未运行过构建。', { fix: '运行一次全量扫描，以执行检测到的构建命令。' }));"),
    ("reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} have never been run for this project.`, { fix: 'Run a full scan.' }));",
     "reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} 在该项目中尚未运行。`, { fix: '运行一次全量扫描。' }));"),
    ("reasons.push(reason(`${code}_passed`, 'info', `${label}: ${run.passed}/${run.total} PASS (${run.framework}).`, { evidence: [evTest(code)] }));",
     "reasons.push(reason(`${code}_passed`, 'info', `${label}：${run.passed}/${run.total} 通过（${run.framework}）。`, { evidence: [evTest(code)] }));"),
    ("reasons.push(reason(`${code}_unsupported`, severity.LOW, `${label} are not applicable: ${run.unsupportedReason || 'no command'}.`));",
     "reasons.push(reason(`${code}_unsupported`, severity.LOW, `${label} 不适用：${run.unsupportedReason || '无命令'}。`));"),
    ("reasons.push(reason(`${code}_failed`, sev, `${label}: ${run.failed} of ${run.total} FAILED (${run.framework}).`, {\n          evidence: [evTest(code)], fix: run.suite === 'e2e' ? 'Repair the failing end-to-end flows; they block the acceptance gate.' : 'Fix the failing unit tests.', magnitude: 2,\n        }));",
     "reasons.push(reason(`${code}_failed`, sev, `${label}：${run.total} 个中 ${run.failed} 个失败（${run.framework}）。`, {\n          evidence: [evTest(code)], fix: run.suite === 'e2e' ? '修复失败的端到端流程；它们阻塞了验收门。' : '修复失败的单元测试。', magnitude: 2,\n        }));"),
    ("reasons.push(reason(`${code}_error`, severity.HIGH, `${label} run ended with status \"${run.status}\" (exit ${run.exitCode}).`, { fix: 'Inspect the test command output; the reporter format may be unsupported.' }));",
     "reasons.push(reason(`${code}_error`, severity.HIGH, `${label} 运行以状态“${run.status}”结束（退出码 ${run.exitCode}）。`, { fix: '检查测试命令输出；reporter 格式可能不受支持。' }));"),
    ("reasons.push(reason('critical_risks', severity.CRITICAL, `${criticalRisks.length} open critical risk(s): ${criticalRisks.map((r) => r.title).join('; ')}.`, {\n        evidence: criticalRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: 'Resolve critical risks before advancing.', magnitude: 2,\n      }));",
     "reasons.push(reason('critical_risks', severity.CRITICAL, `${criticalRisks.length} 个未解决的危急风险：${criticalRisks.map((r) => r.title).join('；')}。`, {\n        evidence: criticalRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: '在推进之前先解决危急风险。', magnitude: 2,\n      }));"),
    ("reasons.push(reason('high_risks', severity.HIGH, `${highRisks.length} open high risk(s): ${highRisks.map((r) => r.title).join('; ')}.`, {\n        evidence: highRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: 'Triage high risks in the Risk panel.',\n      }));",
     "reasons.push(reason('high_risks', severity.HIGH, `${highRisks.length} 个未解决的高风险：${highRisks.map((r) => r.title).join('；')}。`, {\n        evidence: highRisks.flatMap((r) => r.evidence || []).slice(0, 5), fix: '在风险面板中对高风险进行分诊。',\n      }));"),
    ("reasons.push(reason('medium_risks', severity.MEDIUM, `${mediumRisks.length} open medium risk(s).`, { fix: 'Review the Risk panel when convenient.' }));",
     "reasons.push(reason('medium_risks', severity.MEDIUM, `${mediumRisks.length} 个未解决的中等风险。`, { fix: '方便时查看风险面板。' }));"),
    ("reasons.push(reason('blocked_tasks', severity.HIGH, `${openBlocked.length} blocked task(s): ${openBlocked.map((t) => t.title).join('; ').slice(0, 300)}.`, {\n        fix: 'Unblock or re-scope these tasks; they will stall the stage.', magnitude: 1.5,\n      }));",
     "reasons.push(reason('blocked_tasks', severity.HIGH, `${openBlocked.length} 个被阻塞的任务：${openBlocked.map((t) => t.title).join('；').slice(0, 300)}。`, {\n        fix: '解除阻塞或重新界定这些任务的范围；它们会拖慢当前阶段。', magnitude: 1.5,\n      }));"),
    ("reasons.push(reason('very_dirty_workspace', severity.HIGH, `${dirty} files differ from HEAD — a large uncommitted change set hides regressions.`, {\n          fix: 'Commit or stash before continuing so Commander can attribute changes to a known state.', magnitude: 1.5,\n        }));",
     "reasons.push(reason('very_dirty_workspace', severity.HIGH, `${dirty} 个文件与 HEAD 不同——大量未提交的改动会掩盖回归。`, {\n          fix: '先提交或 stash，让 Commander 能把变更归因到已知状态。', magnitude: 1.5,\n        }));"),
    ("reasons.push(reason('dirty_workspace', severity.MEDIUM, `${dirty} files differ from HEAD (uncommitted).`, { fix: 'Consider committing a checkpoint.', magnitude: 1 }));",
     "reasons.push(reason('dirty_workspace', severity.MEDIUM, `${dirty} 个文件与 HEAD 不同（未提交）。`, { fix: '考虑提交一个检查点。', magnitude: 1 }));"),
    ("reasons.push(reason('slightly_dirty_workspace', 'info', `${dirty} file(s) modified since the last commit.`, {}));",
     "reasons.push(reason('slightly_dirty_workspace', 'info', `距上次提交有 ${dirty} 个文件被修改。`, {}));"),
    ("reasons.push(reason('no_commits', severity.MEDIUM, 'The repository has no commits yet, so change history cannot be attributed.', { fix: 'Create an initial commit.' }));",
     "reasons.push(reason('no_commits', severity.MEDIUM, '仓库还没有任何提交，无法归因变更历史。', { fix: '创建初始提交。' }));"),
    ("reasons.push(reason('regression_detected', worst.severity, `${regressions.length} regression(s) detected since the previous snapshot; worst: ${worst.title}.`, {\n        evidence: worst.evidence || [], fix: 'Open the Changes tab to compare the two snapshots and revert or repair the regression.', magnitude: 2,\n      }));",
     "reasons.push(reason('regression_detected', worst.severity, `自上一快照以来检测到 ${regressions.length} 个回归；最严重：${worst.title}。`, {\n        evidence: worst.evidence || [], fix: '打开“变更”页对比两个快照，回退或修复回归。', magnitude: 2,\n      }));"),
    ("reasons.push(reason('gate_failed', severity.HIGH, `Acceptance gate FAIL — ${gate.explanation}`, { fix: 'Satisfy the failing gate checks listed in the Overview tab.' }));",
     "reasons.push(reason('gate_failed', severity.HIGH, `验收门未通过——${gate.explanation}`, { fix: '满足概述页中列出的失败门禁检查。' }));"),
    ("reasons.push(reason('gate_blocked', severity.CRITICAL, `Acceptance gate BLOCKED — ${gate.explanation}`, { fix: 'Resolve the blocking items before advancing.' }));",
     "reasons.push(reason('gate_blocked', severity.CRITICAL, `验收门被阻塞——${gate.explanation}`, { fix: '先解决阻塞项，再继续推进。' }));"),
    ("reasons.push(reason('gate_unknown', severity.MEDIUM, 'Acceptance gate is UNKNOWN — insufficient evidence to evaluate.', { fix: 'Declare stages and acceptance criteria, then run a full scan.' }));",
     "reasons.push(reason('gate_unknown', severity.MEDIUM, '验收门为未知——证据不足，无法评估。', { fix: '在文档中声明阶段与验收标准，然后运行全量扫描。' }));"),
    ("reasons.push(reason('gate_passed', 'info', 'Acceptance gate PASS — the current stage may advance.', {}));",
     "reasons.push(reason('gate_passed', 'info', '验收门通过——当前阶段可以推进。', {}));"),
    ("reasons.push(reason('no_tests_configured', severity.MEDIUM,\n        'No runnable test suite was detected in this project (no test script and no recognised test framework).',\n        { fix: 'Add a \"test\" script to package.json, or declare the project as test-less in its specification.' }));",
     "reasons.push(reason('no_tests_configured', severity.MEDIUM,\n        '未在该项目中检测到可运行的测试套件（既没有测试脚本，也没有可识别的测试框架）。',\n        { fix: '在 package.json 中添加 \"test\" 脚本，或在规范中声明该项目无测试。' }));"),
    ("reasons.push(reason('sensitive_files_present', 'info', `${metadata.sensitiveCount} sensitive file(s) detected and protected (contents were never read, stored or transmitted).`, {\n        fix: 'Confirm .gitignore covers them.',\n      }));",
     "reasons.push(reason('sensitive_files_present', 'info', `${metadata.sensitiveCount} 个敏感文件已被识别并保护（内容从未被读取、存储或传输）。`, {\n        fix: '确认 .gitignore 已覆盖这些文件。',\n      }));"),
    ("reasons.push(reason('scan_truncated', severity.MEDIUM, 'The last scan hit the configured file/depth limit, so results are partial.', {\n        fix: 'Raise the scan limits in Settings or add ignore patterns.',\n      }));",
     "reasons.push(reason('scan_truncated', severity.MEDIUM, '上次扫描达到了配置的文件/深度上限，结果不完整。', {\n        fix: '在设置中调大扫描上限，或添加忽略规则。',\n      }));"),
    ("reasons.unshift(reason('no_evidence', severity.MEDIUM, 'No build or test evidence has been collected yet, so health is Unknown.', { fix: 'Run a full scan.' }));",
     "reasons.unshift(reason('no_evidence', severity.MEDIUM, '尚未收集到任何构建或测试证据，因此健康状态未知。', { fix: '运行一次全量扫描。' }));"),
    ("summary: `${status.toUpperCase()} — ${sortedReasons.filter((r) => r.severity !== 'info').length} issue(s), ${sortedReasons.filter((r) => r.severity === 'info').length} positive signal(s).`,",
     "summary: `${HEALTH_ZH[status] || status}——${sortedReasons.filter((r) => r.severity !== 'info').length} 个问题，${sortedReasons.filter((r) => r.severity === 'info').length} 个正面信号。`,"),
    ("checkSuite('Unit tests', unit, 'unit');\n    checkSuite('Integration tests', integration, 'integration');\n    checkSuite('E2E tests', e2e, 'e2e');",
     "checkSuite('单元测试', unit, 'unit');\n    checkSuite('集成测试', integration, 'integration');\n    checkSuite('端到端测试', e2e, 'e2e');"),
    ("if (!run) {\n        reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} have never been run for this project.`, { fix: 'Run a full scan.' }));",
     "if (!run) {\n        reasons.push(reason(`${code}_unknown`, severity.LOW, `${label} 在该项目中尚未运行。`, { fix: '运行一次全量扫描。' }));"),
])
s = io.open('src/core/engines/health.js', encoding='utf-8').read()
if 'HEALTH_ZH' not in s.split('export class ProjectHealthEngine')[0]:
    s = s.replace("const ZH_KEY = { stages: '阶段', tasks: '任务', acceptance: '验收标准' };",
                  "const ZH_KEY = { stages: '阶段', tasks: '任务', acceptance: '验收标准' };\nconst HEALTH_ZH = { healthy: '健康', warning: '警告', critical: '危急', unknown: '未知' };")
    io.open('src/core/engines/health.js', 'w', encoding='utf-8', newline='').write(s)
    print('HEALTH_ZH added')
print('health batch done')

# ---------------- acceptance-gate.js ----------------
sub('src/core/engines/acceptance-gate.js', [
    ("checks.push(check('Build PASS', GATE_RESULT.PASS, `\\`${build.command}\\` exited 0 in ${build.durationMs}ms.`, [evCommand(build.command)]));",
     "checks.push(check('构建通过', GATE_RESULT.PASS, `\\`${build.command}\\` 退出码 0，耗时 ${build.durationMs}ms。`, [evCommand(build.command)]));"),
    ("else if (build.status === BUILD_STATUS.UNSUPPORTED) checks.push(check('Build PASS', GATE_RESULT.UNKNOWN, `No build command detected: ${build.unsupportedReason || 'not applicable for this project type'}.`));",
     "else if (build.status === BUILD_STATUS.UNSUPPORTED) checks.push(check('构建通过', GATE_RESULT.UNKNOWN, `未检测到构建命令：${build.unsupportedReason || '对该项目类型不适用'}。`));"),
    ("else checks.push(check('Build PASS', GATE_RESULT.FAIL, `\\`${build.command || 'build'}\\` returned status \"${build.status}\" (exit ${build.exitCode}).`, [evCommand(build.command || 'build')]));",
     "else checks.push(check('构建通过', GATE_RESULT.FAIL, `\\`${build.command || 'build'}\\` 返回状态“${build.status}”（退出码 ${build.exitCode}）。`, [evCommand(build.command || 'build')]));"),
    ("checks.push(check('Build PASS', GATE_RESULT.UNKNOWN, 'No build result recorded yet — run a full scan.'));",
     "checks.push(check('构建通过', GATE_RESULT.UNKNOWN, '尚未记录构建结果——请运行全量扫描。'));"),
    ("const suiteCheck = (label, run, key) => {\n    if (!run) { checks.push(check(label, GATE_RESULT.UNKNOWN, `${label} has not been run yet.`)); return; }\n    if (run.status === RUN_STATUS.UNSUPPORTED) { checks.push(check(label, GATE_RESULT.UNKNOWN, `Not applicable: ${run.unsupportedReason || 'no command detected'}.`)); return; }\n    if (run.status === RUN_STATUS.PASS) { checks.push(check(label, GATE_RESULT.PASS, `${run.passed}/${run.total} passed (${run.framework}).`, [evTest(key)])); return; }\n    if (run.status === RUN_STATUS.ERROR) { checks.push(check(label, GATE_RESULT.FAIL, `The test command failed (exit ${run.exitCode}) but output could not be parsed (${run.framework}). ${run.parserNote || ''}`)); return; }\n    checks.push(check(label, GATE_RESULT.FAIL, `${run.failed} of ${run.total} ${key} tests failed (${run.framework}).`, [evTest(key)]));\n  };\n  suiteCheck('Unit tests PASS', unit, 'unit');\n  if (integration) suiteCheck('Integration tests PASS', integration, 'integration');\n  suiteCheck('E2E tests PASS', e2e, 'e2e');",
     "const suiteCheck = (label, run, key) => {\n    if (!run) { checks.push(check(label, GATE_RESULT.UNKNOWN, `${label}尚未运行。`)); return; }\n    if (run.status === RUN_STATUS.UNSUPPORTED) { checks.push(check(label, GATE_RESULT.UNKNOWN, `不适用：${run.unsupportedReason || '未检测到命令'}。`)); return; }\n    if (run.status === RUN_STATUS.PASS) { checks.push(check(label, GATE_RESULT.PASS, `${run.passed}/${run.total} 通过（${run.framework}）。`, [evTest(key)])); return; }\n    if (run.status === RUN_STATUS.ERROR) { checks.push(check(label, GATE_RESULT.FAIL, `测试命令失败（退出码 ${run.exitCode}），但输出无法解析（${run.framework}）。${run.parserNote || ''}`)); return; }\n    checks.push(check(label, GATE_RESULT.FAIL, `${run.total} 个 ${key} 测试中有 ${run.failed} 个失败（${run.framework}）。`, [evTest(key)]));\n  };\n  suiteCheck('单元测试通过', unit, 'unit');\n  if (integration) suiteCheck('集成测试通过', integration, 'integration');\n  suiteCheck('端到端测试通过', e2e, 'e2e');"),
    ("if (criticalRisks.length === 0) {\n    checks.push(check('Critical Risk = 0', GATE_RESULT.PASS, highRisks.length\n      ? `No critical risks. ${highRisks.length} high risk(s) remain and are tracked in the Risk panel, but do not gate the stage.`\n      : 'No open critical risks.'));\n  } else {\n    checks.push(check('Critical Risk = 0', GATE_RESULT.FAIL, `${criticalRisks.length} open critical risk(s): ${criticalRisks.map((r) => r.code).join(', ')}.`));\n  }\n  if (highRisks.length) {\n    checks.push(check('High risk budget (advisory)', GATE_RESULT.UNKNOWN, `${highRisks.length} open high risk(s): ${highRisks.map((r) => r.code).join(', ')}. Advisory only — high risks do not block the gate.`));\n  }",
     "if (criticalRisks.length === 0) {\n    checks.push(check('危急风险为 0', GATE_RESULT.PASS, highRisks.length\n      ? `没有危急风险。仍有 ${highRisks.length} 个高风险，已在风险面板跟踪，但不阻塞门禁。`\n      : '没有未解决的危急风险。'));\n  } else {\n    checks.push(check('危急风险为 0', GATE_RESULT.FAIL, `${criticalRisks.length} 个未解决的危急风险：${criticalRisks.map((r) => r.code).join('、')}。`));\n  }\n  if (highRisks.length) {\n    checks.push(check('高风险预算（建议项）', GATE_RESULT.UNKNOWN, `${highRisks.length} 个未解决的高风险：${highRisks.map((r) => r.code).join('、')}。仅为建议——高风险不阻塞门禁。`));\n  }"),
    ("checks.push(check('Stage tasks done', GATE_RESULT.UNKNOWN, 'No tasks are linked to this stage yet.'));",
     "checks.push(check('阶段任务完成', GATE_RESULT.UNKNOWN, '尚无任务关联到该阶段。'));"),
    ("checks.push(check('Stage tasks done', GATE_RESULT.PASS, `All ${stageTasks.length} stage task(s) are done.`));",
     "checks.push(check('阶段任务完成', GATE_RESULT.PASS, `该阶段全部 ${stageTasks.length} 个任务已完成。`));"),
    ("checks.push(check('Stage tasks done', blocked.length ? GATE_RESULT.BLOCKED : GATE_RESULT.FAIL,\n      `${blocking.length} of ${stageTasks.length} stage task(s) are still open${blocked.length ? ` (${blocked.length} blocked)` : ''}.`));",
     "checks.push(check('阶段任务完成', blocked.length ? GATE_RESULT.BLOCKED : GATE_RESULT.FAIL,\n      `${stageTasks.length} 个阶段任务中仍有 ${blocking.length} 个未完成${blocked.length ? `（${blocked.length} 个被阻塞）` : ''}。`));"),
    ("checks.push(check('Acceptance criteria satisfied', GATE_RESULT.UNKNOWN, 'No acceptance criteria are linked to this stage.'));",
     "checks.push(check('验收标准满足', GATE_RESULT.UNKNOWN, '该阶段尚无关联的验收标准。'));"),
    ("checks.push(check('Acceptance criteria satisfied',\n      unmet.length ? GATE_RESULT.FAIL : GATE_RESULT.PASS,\n      unmet.length ? `${unmet.length} of ${stageCriteria.length} criteria are unmet.` : `All ${stageCriteria.length} criteria satisfied.`));",
     "checks.push(check('验收标准满足',\n      unmet.length ? GATE_RESULT.FAIL : GATE_RESULT.PASS,\n      unmet.length ? `${stageCriteria.length} 条标准中有 ${unmet.length} 条未满足。` : `全部 ${stageCriteria.length} 条标准已满足。`));"),
    ("checks.push(check('Stage identified', GATE_RESULT.UNKNOWN, 'No stage could be determined from specs or tasks, so the gate cannot be evaluated.'));",
     "checks.push(check('已识别阶段', GATE_RESULT.UNKNOWN, '无法从规范或任务中确定阶段，因此无法评估门禁。'));"),
    ("if (result === GATE_RESULT.PASS) return `${stageName} satisfies every acceptance gate. The project may advance to the next stage.`;",
     "if (result === GATE_RESULT.PASS) return `${stageName} 满足所有验收门，项目可以推进到下一阶段。`;"),
    ("return `The gate cannot be evaluated for ${stageName} because ${unknown.length} check(s) lack evidence: ${unknown.join(', ')}.`;",
     "return `无法评估${stageName}的门禁，因为有 ${unknown.length} 项检查缺少证据：${unknown.join('、')}。`;"),
    ("return `${stageName} cannot advance. ${blocking.length} blocking check(s): ${reasons.join(' ')}`;",
     "return `${stageName} 无法推进。${blocking.length} 项阻塞检查：${reasons.join(' ')}`;"),
])
print('gate batch done')
