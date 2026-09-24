# -*- coding: utf-8 -*-
"""project.js + settings/search/jobs i18n batch (dev tool)."""
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

# ================= project.js =================
sub('src/web/views/project.js', [
    # tab labels
    ("const TAB_LABEL = {\n  overview: 'Overview', stages: 'Stages', tasks: 'Tasks', tests: 'Tests', build: 'Build',\n  git: 'Git', changes: 'Changes', prompts: 'Prompts', sessions: 'Agent Sessions',\n  risks: 'Risks', memory: 'Memory', decisions: 'Decisions', timeline: 'Timeline', settings: 'Settings',\n};",
     "const TAB_LABEL = {\n  overview: '概述', stages: '阶段', tasks: '任务', tests: '测试', build: '构建',\n  git: 'Git', changes: '变更', prompts: '提示词', sessions: 'Agent 会话',\n  risks: '风险', memory: '记忆', decisions: '决策', timeline: '时间线', settings: '设置',\n};"),
    # topbar buttons
    ("h('button', { class: 'btn', text: 'Quick scan', onClick: () => runScan('quick') }),\n    h('button', { class: 'btn', text: 'Full scan', onClick: () => runScan('full') }),\n    h('button', { class: 'btn', text: 'Generate prompt', onClick: () => generatePrompt(cardData) }),\n    h('button', { class: 'btn', text: 'Handoff', onClick: () => showHandoff(cardData) }),\n    h('button', { class: 'btn btn-ghost', text: 'All projects', onClick: () => Router.go('/projects') }),",
     "h('button', { class: 'btn', text: '快速扫描', onClick: () => runScan('quick') }),\n    h('button', { class: 'btn', text: '全量扫描', onClick: () => runScan('full') }),\n    h('button', { class: 'btn', text: '生成提示词', onClick: () => generatePrompt(cardData) }),\n    h('button', { class: 'btn', text: '交接包', onClick: () => showHandoff(cardData) }),\n    h('button', { class: 'btn btn-ghost', text: '全部项目', onClick: () => Router.go('/projects') }),"),
    ("view.replaceChildren(stateLoading('Loading project…'));", "view.replaceChildren(stateLoading('正在加载项目…'));"),
    ("setTopbar('Project not found', projectId);", "setTopbar('未找到项目', projectId);"),
    # overview metrics
    ("metric('Health', p.health, { cls: p.health === 'healthy' ? 'ok' : p.health === 'critical' ? 'alert' : p.health === 'warning' ? 'warn' : '', foot: d.health ? `${d.health.score}/100` : '' }),",
     "metric('健康', p.health, { cls: p.health === 'healthy' ? 'ok' : p.health === 'critical' ? 'alert' : p.health === 'warning' ? 'warn' : '', foot: d.health ? `${d.health.score}/100` : '' }),"),
    ("metric('Build', d.build ? d.build.status : 'not run', { sm: true, cls: d.build && d.build.status === 'pass' ? 'ok' : d.build && d.build.status === 'fail' ? 'alert' : '', foot: d.build ? d.build.command : '' }),",
     "metric('构建', d.build ? d.build.status : '未运行', { sm: true, cls: d.build && d.build.status === 'pass' ? 'ok' : d.build && d.build.status === 'fail' ? 'alert' : '', foot: d.build ? d.build.command : '' }),"),
    ("metric('Unit tests', d.tests.unit ? `${d.tests.unit.passed}/${d.tests.unit.total}` : 'not run', { cls: d.tests.unit && d.tests.unit.status === 'pass' ? 'ok' : d.tests.unit && d.tests.unit.status === 'fail' ? 'alert' : '' }),",
     "metric('单元测试', d.tests.unit ? `${d.tests.unit.passed}/${d.tests.unit.total}` : '未运行', { cls: d.tests.unit && d.tests.unit.status === 'pass' ? 'ok' : d.tests.unit && d.tests.unit.status === 'fail' ? 'alert' : '' }),"),
    ("metric('E2E tests', d.tests.e2e ? `${d.tests.e2e.passed}/${d.tests.e2e.total}` : 'not run', { cls: d.tests.e2e && d.tests.e2e.status === 'pass' ? 'ok' : d.tests.e2e && d.tests.e2e.status === 'fail' ? 'alert' : '' }),",
     "metric('端到端测试', d.tests.e2e ? `${d.tests.e2e.passed}/${d.tests.e2e.total}` : '未运行', { cls: d.tests.e2e && d.tests.e2e.status === 'pass' ? 'ok' : d.tests.e2e && d.tests.e2e.status === 'fail' ? 'alert' : '' }),"),
    ("metric('Open tasks', `${d.taskSummary.done}/${d.taskSummary.total}`, { foot: `${d.taskSummary.blocked} blocked` }),",
     "metric('开放任务', `${d.taskSummary.done}/${d.taskSummary.total}`, { foot: `${d.taskSummary.blocked} 个阻塞` }),"),
    ("metric('Risks', `${d.riskSummary.bySeverity.critical}c / ${d.riskSummary.bySeverity.high}h`, { cls: d.riskSummary.bySeverity.critical ? 'alert' : d.riskSummary.bySeverity.high ? 'warn' : '', foot: `worst: ${d.riskSummary.worst || 'none'}` }),",
     "metric('风险', `${d.riskSummary.bySeverity.critical} 危急 / ${d.riskSummary.bySeverity.high} 高`, { cls: d.riskSummary.bySeverity.critical ? 'alert' : d.riskSummary.bySeverity.high ? 'warn' : '', foot: `最重：${d.riskSummary.worst || '无'}` }),"),
    ("metric('Regressions', String(d.regressionSummary.count), { cls: d.regressionSummary.count ? 'alert' : 'ok', foot: d.regressionSummary.worst || 'none' }),",
     "metric('回归', String(d.regressionSummary.count), { cls: d.regressionSummary.count ? 'alert' : 'ok', foot: d.regressionSummary.worst || '无' }),"),
    # overview cards
    ("card('Progress', h('div', { class: 'stack-sm' }, [", "card('进度', h('div', { class: 'stack-sm' }, ["),
    ("{ hint: 'derived from stages + tasks + acceptance only' }),", "{ hint: '仅由阶段 + 任务 + 验收标准推导' }),"),
    ("card('Acceptance Gate', d.gate ? h('div', { class: 'stack-sm' }, [", "card('验收门', d.gate ? h('div', { class: 'stack-sm' }, ["),
    ("]) : stateEmpty('Gate not evaluated', 'Run a full scan to evaluate the acceptance gate.')),",
     "]) : stateEmpty('门禁未评估', '运行一次全量扫描以评估验收门。')),"),
    ("d.nextAction ? card('Next recommended action', h('div', { class: 'stack-sm' }, [",
     "d.nextAction ? card('下一步建议行动', h('div', { class: 'stack-sm' }, ["),
    ("]) : card('Next recommended action', stateEmpty('Not computed yet', 'Run a full scan, then generate the next action.')),",
     "]) : card('下一步建议行动', stateEmpty('尚未计算', '先进行一次全量扫描，然后生成下一步动作。')),"),
    ("h('button', { class: 'btn btn-primary btn-sm', text: 'Generate agent prompt', onClick: () => generatePrompt(current.card) }),\n          h('button', { class: 'btn btn-sm', text: 'Recompute with AI', onClick: recomputeNextAction }),",
     "h('button', { class: 'btn btn-primary btn-sm', text: '生成 Agent 提示词', onClick: () => generatePrompt(current.card) }),\n          h('button', { class: 'btn btn-sm', text: '用 AI 重新计算', onClick: recomputeNextAction }),"),
    ("card('Health breakdown (Why?)', d.health ? h('div', { class: 'stack-sm' }, d.health.reasons.map((r) => h('div', { class: `reason-item sev-${r.severity}` }, [",
     "card('健康明细（为什么？）', d.health ? h('div', { class: 'stack-sm' }, d.health.reasons.map((r) => h('div', { class: `reason-item sev-${r.severity}` }, ["),
    ("]) : stateEmpty('No health analysis', 'Run a full scan.')),", "]) : stateEmpty('暂无健康分析', '请先运行一次全量扫描。')),"),
    ("card('Specification drift', d.drift ? h('div', { class: 'stack-sm' }, [", "card('规范漂移', d.drift ? h('div', { class: 'stack-sm' }, ["),
    ("]) : stateEmpty('No drift analysis yet')),", "]) : stateEmpty('暂无漂移分析')),"),
    ("card('Detected commands', d.commands.length", "card('检测到的命令', d.commands.length"),
    ("card('Project metadata', meta ? h('dl', { class: 'kv' }, [", "card('项目元数据', meta ? h('dl', { class: 'kv' }, ["),
    ("d.aiSummary ? card('AI project summary', h('div', { class: 'stack-sm' }, [", "d.aiSummary ? card('AI 项目摘要', h('div', { class: 'stack-sm' }, ["),
    ("unavailable.length ? card('Explicitly unsupported', h('div', { class: 'small muted', text: `Commander could not detect a command for: ${unavailable.join(', ')}. This is reported as \"unsupported\" rather than guessed.` })) : null,",
     "unavailable.length ? card('明确不支持', h('div', { class: 'small muted', text: `未能为以下类型检测到命令：${unavailable.join('、')}。Commander 会如实报告“不适用”，而不是猜测。` })) : null,"),
    ("{ loadingLabel: 'Loading overview…' });", "{ loadingLabel: '正在加载概述…' });"),
    # runScan toasts
    ("toast(`${mode} scan queued…`, 'info', 4000);", "toast(`已入队${mode === 'quick' ? '快速' : '全量'}扫描…`, 'info', 4000);"),
    ("toast('Scan queued — results appear when the job completes.', 'ok');", "toast('扫描已入队——任务完成后结果自动出现。', 'ok');"),
    ("toast('Scan finished.', 'ok');", "toast('扫描完成。', 'ok');"),
    ("toast(`Scan failed: ${err.message}`, 'error');", "toast(`扫描失败：${err.message}`, 'error');"),
    ("toast('Next action updated', 'ok');", "toast('下一步行动已更新', 'ok');"),
    ("toast(`Prompt generation failed: ${err.message}`, 'error');", "toast(`提示词生成失败：${err.message}`, 'error');"),
    ("toast(`Handoff failed: ${err.message}`, 'error');", "toast(`交接包生成失败：${err.message}`, 'error');"),
    ("toast('Recomputing next action…', 'info', 3000);", "toast('正在重新计算下一步行动…', 'info', 3000);"),
])

# ================= settings.js =================
sub('src/web/views/settings.js', [
    ("setTopbar('Settings', 'AI provider, watcher and scan limits. Secrets stay on the server.', [\n    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),\n  ]);",
     "setTopbar('设置', 'AI 服务、监控与扫描限制。密钥只保存在服务端。', [\n    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),\n  ]);"),
    ("const providerCard = card('AI Provider', h('div', { class: 'stack' }, [", "const providerCard = card('AI 服务', h('div', { class: 'stack' }, ["),
    ("h('option', { value: 'mock', selected: (settings['ai.provider'] || 'mock') === 'mock', text: 'mock — deterministic, offline, no API key' }),",
     "h('option', { value: 'mock', selected: (settings['ai.provider'] || 'mock') === 'mock', text: 'mock —— 确定性、离线、无需 API Key' }),"),
    ("h('option', { value: 'openai-compatible', selected: settings['ai.provider'] === 'openai-compatible', text: 'openai-compatible — any /chat/completions endpoint' }),",
     "h('option', { value: 'openai-compatible', selected: settings['ai.provider'] === 'openai-compatible', text: 'openai-compatible —— 任意 /chat/completions 接口' }),"),
    ("h('button', { class: 'btn btn-primary', text: 'Save settings', onClick: save })]),\n      h('div', { class: 'grid grid-3' }, [",
     "h('button', { class: 'btn btn-primary', text: '保存设置', onClick: save })]),\n      h('div', { class: 'grid grid-3' }, ["),
    ("const watcherCard = card('Watcher & Scan Limits', h('div', { class: 'stack' }, [", "const watcherCard = card('监控与扫描限制', h('div', { class: 'stack' }, ["),
    ("h('button', { class: 'btn btn-primary', text: 'Save settings', onClick: save })]),\n      h('div', { class: 'small muted', text: `Watching ${system.watcher.watching.length} workspace(s).",
     "h('button', { class: 'btn btn-primary', text: '保存设置', onClick: save })]),\n      h('div', { class: 'small muted', text: `正在监控 ${system.watcher.watching.length} 个工作区。"),
    ("const metaCard = card('Test parsers & adapters', h('div', { class: 'grid grid-2' }, [", "const metaCard = card('测试解析器与适配器', h('div', { class: 'grid grid-2' }, ["),
    ("const systemCard = card('System', h('dl', { class: 'kv' }, Object.entries({", "const systemCard = card('系统', h('dl', { class: 'kv' }, Object.entries({"),
    ("toast('Settings saved', 'ok');", "toast('设置已保存', 'ok');"),
    ("{ loadingLabel: 'Loading settings…' });", "{ loadingLabel: '正在加载设置…' });"),
    ("setTopbar('Security Model', 'What Commander is allowed to do — and what it is structurally prevented from doing.');",
     "setTopbar('安全模型', 'Commander 允许做什么——以及结构上被禁止做什么。');"),
    ("await mountAsync(view, () => api.security(), (s) => h('div', { class: 'stack' }, [\n    card('Sensitive file protection', h('div', { class: 'stack-sm' }, [",
     "await mountAsync(view, () => api.security(), (s) => h('div', { class: 'stack' }, [\n    card('敏感文件保护', h('div', { class: 'stack-sm' }, ["),
    ("card('Command execution', h('div', { class: 'stack' }, [", "card('命令执行', h('div', { class: 'stack' }, ["),
    ("card('Managed workspace', h('p', { class: 'small', text: s.managedWorkspace })),", "card('受管工作区', h('p', { class: 'small', text: s.managedWorkspace })),"),
    ("card('AI data boundary', h('p', { class: 'small', text: s.aiDataBoundary })),", "card('AI 数据边界', h('p', { class: 'small', text: s.aiDataBoundary })),"),
    ("card('Secrets', h('p', { class: 'small', text: s.secretsStorage })),", "card('密钥', h('p', { class: 'small', text: s.secretsStorage })),"),
    ("{ loadingLabel: 'Loading security model…' });", "{ loadingLabel: '正在加载安全模型…' });"),
    ("h('label', { class: 'small muted', text: 'Provider' }), fields.provider]),", "h('label', { class: 'small muted', text: '提供方' }), fields.provider]),"),
    ("h('label', { class: 'small muted', text: 'Model' }), fields.model]),", "h('label', { class: 'small muted', text: '模型' }), fields.model]),"),
    ("h('label', { class: 'small muted', text: 'Base URL' }), fields.baseUrl]),", "h('label', { class: 'small muted', text: '接口地址' }), fields.baseUrl]),"),
    ("h('label', { class: 'small muted', text: 'API key (never returned to the browser)' }), fields.apiKey]),",
     "h('label', { class: 'small muted', text: 'API Key（永远不会回传浏览器）' }), fields.apiKey]),"),
    ("h('label', { class: 'small muted', text: 'Timeout (ms)' }), fields.timeoutMs]),", "h('label', { class: 'small muted', text: '超时（毫秒）' }), fields.timeoutMs]),"),
    ("h('div', { class: 'label', text: 'Structured calls' }), h('div', { class: 'value sm', text: String(system.aiStats.calls) })]),",
     "h('div', { class: 'label', text: '结构化调用' }), h('div', { class: 'value sm', text: String(system.aiStats.calls) })]),"),
    ("h('div', { class: 'label', text: 'Schema retries' }), h('div', { class: 'value sm', text: String(system.aiStats.retries) })]),",
     "h('div', { class: 'label', text: 'Schema 重试' }), h('div', { class: 'value sm', text: String(system.aiStats.retries) })]),"),
    ("h('div', { class: 'label', text: 'Mock fallbacks' }), h('div', { class: 'value sm', text: String(system.aiStats.fallbacks) })]),",
     "h('div', { class: 'label', text: 'Mock 回退' }), h('div', { class: 'value sm', text: String(system.aiStats.fallbacks) })]),"),
    ("h('label', { class: 'row small' }, [fields.watcherEnabled, h('span', { text: 'Enable filesystem watcher (debounced, ignores node_modules/.git/dist)' })]),",
     "h('label', { class: 'row small' }, [fields.watcherEnabled, h('span', { text: '启用文件系统监控（去抖，忽略 node_modules/.git/dist）' })]),"),
    ("h('label', { class: 'row small' }, [fields.autoQuick, h('span', { text: 'Automatically queue a quick scan on change (never calls an LLM)' })]),",
     "h('label', { class: 'row small' }, [fields.autoQuick, h('span', { text: '变更时自动排队快速扫描（绝不调用大模型）' })]),"),
    ("h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Maximum files per scan' }), fields.maxFiles]),",
     "h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '每次扫描的最大文件数' }), fields.maxFiles]),"),
    ("const searchRootsCard = card('Folder Recognition (drag & drop import)', h('div', { class: 'stack' }, [",
     "const searchRootsCard = card('文件夹识别（拖拽导入）', h('div', { class: 'stack' }, ["),
    ("h('p', { class: 'small muted', text: 'When you drop a folder on the Projects page, the browser only reveals its name — never its path. Commander therefore searches these roots to resolve the real location, then recognises each match with the scanner.' }),",
     "h('p', { class: 'small muted', text: '把文件夹拖到“项目”页时，浏览器只会暴露文件夹名——不会暴露路径。Commander 会在这些根目录中搜索真实位置，并用扫描器识别每个匹配项。' }),"),
    ("h('div', { class: 'small muted', text: 'One absolute path per line. Searched top-down, up to 2 levels deep; node_modules, .git and system folders are skipped.' }),",
     "h('div', { class: 'small muted', text: '每行一个绝对路径。按顺序搜索，最多向下 2 层；跳过 node_modules、.git 与系统目录。' }),"),
])

# ================= search.js =================
sub('src/web/views/search.js', [
    ("setTopbar('Search', 'Full-text across every managed project. FTS5 when available, substring fallback otherwise.', [\n    h('button', { class: 'btn btn-primary', text: 'Search', onClick: submit }),\n  ]);",
     "setTopbar('搜索', '跨所有受管项目的全文检索。优先 FTS5，不可用时回退子串匹配。', [\n    h('button', { class: 'btn btn-primary', text: '搜索', onClick: submit }),\n  ]);"),
    ("const head = card('Query', h('div', { class: 'row' }, [input, h('button', { class: 'btn', text: 'Go', onClick: submit })]));",
     "const head = card('查询', h('div', { class: 'row' }, [input, h('button', { class: 'btn', text: '搜索', onClick: submit })]));"),
    ("view.replaceChildren(h('div', { class: 'stack' }, [head, stateEmpty('Type a query to search', 'Examples: \"checkout\", \"e2e\", \"blocked\", \"auth\".')])));",
     "view.replaceChildren(h('div', { class: 'stack' }, [head, stateEmpty('输入关键词开始搜索', '例如：\"checkout\"、\"e2e\"、\"阻塞\"。')])));"),
    ("card(`Results for “${q}”`, data.results.length", "card(`“${q}” 的搜索结果`, data.results.length"),
    (": stateEmpty('No matches', 'Try a shorter or broader term.'), {", ": stateEmpty('没有匹配结果', '试试更短或更宽泛的关键词。'), {"),
    ("hint: data.fts ? 'FTS5 index' : 'substring fallback',", "hint: data.fts ? 'FTS5 全文索引' : '子串回退',"),
    ("{ loadingLabel: 'Searching…' });", "{ loadingLabel: '正在搜索…' });"),
])

# ================= jobs.js =================
sub('src/web/views/jobs.js', [
    ("setTopbar('Analysis Queue', 'Bounded concurrency, timeouts, retries and cancellation — no unbounded background work.', [\n    h('button', { class: 'btn', text: 'Refresh', onClick: () => render('jobs') }),\n  ]);",
     "setTopbar('分析队列', '有界并发、超时、重试与取消——绝无失控的后台任务。', [\n    h('button', { class: 'btn', text: '刷新', onClick: () => render('jobs') }),\n  ]);"),
    ("card('Jobs', jobs.length ? table([\n      { label: 'Type', key: 'type' },\n      { label: 'Status', render: (r) => statusBadge(r.status) },\n      { label: 'Project', render: (r) => (r.project_id ? h('a', { href: `#/projects/${r.project_id}`, text: r.project_id.slice(0, 12) }) : '—') },\n      { label: 'Attempts', render: (r) => `${r.attempts}/${r.max_attempts}`, num: true },\n      { label: 'Created', render: (r) => fmt.rel(r.created_at) },\n      { label: 'Finished', render: (r) => (r.finished_at ? fmt.rel(r.finished_at) : '—') },\n      { label: 'Error', render: (r) => (r.error ? h('span', { class: 'small', title: r.error, text: fmt.truncate(r.error, 70) }) : '—') },\n      { label: '', render: (r) => (r.status === 'queued' || r.status === 'running'\n        ? h('button', { class: 'btn btn-sm', text: 'Cancel', onClick: async () => { await api.cancelJob(r.id); toast('Job cancelled', 'ok'); render('jobs'); } })\n        : null) },\n    ], jobs, { empty: 'No jobs yet.' }) : stateEmpty('Queue is empty', 'Run a scan from a project to create jobs.')),",
     "card('任务', jobs.length ? table([\n      { label: '类型', key: 'type' },\n      { label: '状态', render: (r) => statusBadge(r.status) },\n      { label: '项目', render: (r) => (r.project_id ? h('a', { href: `#/projects/${r.project_id}`, text: r.project_id.slice(0, 12) }) : '—') },\n      { label: '尝试', render: (r) => `${r.attempts}/${r.max_attempts}`, num: true },\n      { label: '创建于', render: (r) => fmt.rel(r.created_at) },\n      { label: '结束于', render: (r) => (r.finished_at ? fmt.rel(r.finished_at) : '—') },\n      { label: '错误', render: (r) => (r.error ? h('span', { class: 'small', title: r.error, text: fmt.truncate(r.error, 70) }) : '—') },\n      { label: '', render: (r) => (r.status === 'queued' || r.status === 'running'\n        ? h('button', { class: 'btn btn-sm', text: '取消', onClick: async () => { await api.cancelJob(r.id); toast('已取消', 'ok'); render('jobs'); } })\n        : null) },\n    ], jobs, { empty: '暂无任务。' }) : stateEmpty('队列为空', '在项目中运行一次扫描即可创建任务。')),"),
    ("h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Total jobs' }), h('div', { class: 'value', text: String(stats.total) })]),",
     "h('div', { class: 'metric' }, [h('div', { class: 'label', text: '任务总数' }), h('div', { class: 'value', text: String(stats.total) })]),"),
    ("h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Running' }), h('div', { class: 'value', text: `${stats.running}/${stats.concurrency}` })]),",
     "h('div', { class: 'metric' }, [h('div', { class: 'label', text: '运行中' }), h('div', { class: 'value', text: `${stats.running}/${stats.concurrency}` })]),"),
    ("h('div', { class: 'metric ok' }, [h('div', { class: 'label', text: 'Completed' }), h('div', { class: 'value', text: String(stats.byStatus.completed || 0) })]),",
     "h('div', { class: 'metric ok' }, [h('div', { class: 'label', text: '已完成' }), h('div', { class: 'value', text: String(stats.byStatus.completed || 0) })]),"),
    ("h('div', { class: 'metric alert' }, [h('div', { class: 'label', text: 'Failed' }), h('div', { class: 'value', text: String(stats.byStatus.failed || 0) })]),",
     "h('div', { class: 'metric alert' }, [h('div', { class: 'label', text: '失败' }), h('div', { class: 'value', text: String(stats.byStatus.failed || 0) })]),"),
    ("{ loadingLabel: 'Loading queue…' });", "{ loadingLabel: '正在加载队列…' });"),
    ("async function renderEvents() {\n  setTopbar('Global Timeline', 'Every recorded project event, newest first.', [\n    h('button', { class: 'btn', text: 'Refresh', onClick: () => render('events') }),\n  ]);",
     "async function renderEvents() {\n  setTopbar('全局时间线', '所有已记录的项目事件，按时间倒序。', [\n    h('button', { class: 'btn', text: '刷新', onClick: () => render('events') }),\n  ]);"),
    ("card('Events', events.length", "card('事件', events.length"),
    ("{ loadingLabel: 'Loading events…' });", "{ loadingLabel: '正在加载事件…' });"),
])

print('batch2 done')
