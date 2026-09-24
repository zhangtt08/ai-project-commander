# -*- coding: utf-8 -*-
"""Prompt zh final fixes (dev tool)."""
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

sub('src/core/engines/prompt-generator.js', [
    ("    const stateLines = [\n      `- 项目名称：${project.name}`,",
     "    const ZH_STATE = {\n      build: '构建', unit: '单元测试', integration: '集成测试', e2e: '端到端测试',\n      planning: '规划中', developing: '开发中', testing: '测试中', review: '评审中', blocked: '已阻塞', ready: '就绪', released: '已发布', archived: '已归档',\n      healthy: '健康', warning: '警告', critical: '危急', unknown: '未知',\n      pass: '通过', fail: '失败', error: '错误', timeout: '超时', unsupported: '不适用',\n      done: '已完成', todo: '待办', in_progress: '进行中', cancelled: '已取消',\n    };\n    const st = (v) => ZH_STATE[v] || v;\n    const stateLines = [\n      `- 项目名称：${project.name}`,"),
    ("      `- 健康：${project.health}；状态：${project.status}`,", "      `- 健康：${st(project.health)}；状态：${st(project.status)}`,"),
    ("      `- 构建：${build ? `${build.status}${build.command ? `（\\`${build.command}\\`）` : ''}` : '未运行'}`,",
     "      `- 构建：${build ? `${st(build.status)}${build.command ? `（\\`${build.command}\\`）` : ''}` : '未运行'}`,"),
    ("      `- 单元测试：${unit ? `${unit.passed}/${unit.total} ${unit.status}` : '未运行'}`,",
     "      `- 单元测试：${unit ? `${unit.passed}/${unit.total} ${st(unit.status)}` : '未运行'}`,"),
    ("      `- 端到端测试：${e2e ? `${e2e.passed}/${e2e.total} ${e2e.status}` : '未运行'}`,",
     "      `- 端到端测试：${e2e ? `${e2e.passed}/${e2e.total} ${st(e2e.status)}` : '未运行'}`,"),
    ("      `- 集成测试：${integration ? `${integration.passed}/${integration.total} ${integration.status}` : '未运行'}`,",
     "      `- 集成测试：${integration ? `${integration.passed}/${integration.total} ${st(integration.status)}` : '未运行'}`,"),
    ("    const failureLines = [];\n    for (const run of [unit, e2e, integration]) {\n      if (run && (run.status === RUN_STATUS.FAIL || run.status === RUN_STATUS.ERROR)) {\n        failureLines.push(`- ${run.suite}: ${run.failed} of ${run.total} failing (${run.framework})`);\n      }\n    }",
     "    const ZH_SUITE = { unit: '单元测试', integration: '集成测试', e2e: '端到端测试' };\n    const failureLines = [];\n    for (const [key, run] of [['unit', unit], ['integration', integration], ['e2e', e2e]]) {\n      if (run && (run.status === RUN_STATUS.FAIL || run.status === RUN_STATUS.ERROR)) {\n        failureLines.push(`- ${ZH_SUITE[key]}：${run.total ? `${run.failed}/${run.total} 失败` : '无法解析结果'}（${run.framework}）`);\n      }\n    }"),
    ("    for (const c of (failedCases || []).slice(0, 12)) {\n      failureLines.push(`  - [${c.suite}] ${c.name}${c.file ? ` — ${c.file}` : ''}${c.errorSummary ? `\\n      ${truncate(c.errorSummary, 220)}` : ''}`);\n    }",
     "    const ZH_SUITE2 = { unit: '单元', integration: '集成', e2e: '端到端' };\n    for (const c of (failedCases || []).slice(0, 12)) {\n      failureLines.push(`  - [${ZH_SUITE2[c.suite] || c.suite}] ${c.name}${c.file ? ` —— ${c.file}` : ''}${c.errorSummary ? `\\n      ${truncate(c.errorSummary, 220)}` : ''}`);\n    }"),
])

sub('src/core/ai/mock-provider.js', [
    ("          return `## VERIFICATION COMMANDS\\n- 先切换到工作目录：\\`cd /d \"${ctx.project ? ctx.project.workspacePath : ''}\"\\`\\n${(action.verificationCommands || []).map((c) => `- \\`${c}\\``).join('\\n')}\\n`;",
     "          return `## VERIFICATION COMMANDS\\n- 先切换到工作目录：\\`cd /d \"${ctx.project ? (ctx.project.workspace_path || ctx.project.workspacePath || '') : ''}\"\\`\\n${(action.verificationCommands || []).map((c) => `- \\`${c}\\``).join('\\n')}\\n`;"),
])
print('done')
