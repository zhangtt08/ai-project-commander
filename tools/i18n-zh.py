# -*- coding: utf-8 -*-
"""One-shot i18n patcher (dev tool). Run: python tools/i18n-zh.py"""
import io

def sub(path, pairs, must=False):
    s = io.open(path, encoding='utf-8').read()
    miss = []
    for pair in pairs:
        a, b = pair[0], pair[1]
        if a in s:
            s = s.replace(a, b)
        else:
            miss.append(a[:60])
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print(('OK  ' if not miss else 'PART') + ' ' + path + ('  missed: ' + ' | '.join(miss) if miss else ''))

# ---------- attention.js ----------
sub('src/web/views/attention.js', [
    ("setTopbar('Attention Center', 'Everything that should be looked at first, across all projects.', [\n    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),",
     "setTopbar('关注中心', '所有项目中应当优先处理的事项，按严重程度排序。', [\n    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),"),
    ("return stateEmpty('Nothing needs attention', 'No critical, blocked, failing, drifted or regressed projects were found.');",
     "return stateEmpty('暂无需关注的事项', '没有发现危急、阻塞、失败、漂移或回归的项目。');"),
    ("critical_health: 'Critical health',", "critical_health: '健康危急',"),
    ("build_fail: 'Build failure',", "build_fail: '构建失败',"),
    ("test_fail: 'Test failure',", "test_fail: '测试失败',"),
    ("regression: 'Regression',", "regression: '回归',"),
    ("blocked_task: 'Blocked task',", "blocked_task: '任务阻塞',"),
    ("dirty_workspace: 'Dirty workspace',", "dirty_workspace: '工作区脏乱',"),
    ("drift: 'Specification drift',", "drift: '规范漂移',"),
    ("pending_review: 'Pending review',", "pending_review: '待复核',"),
    ("`${g.sev.toUpperCase()} (${g.items.length})`,",
     "`${SEV_ZH[g.sev] || g.sev}（${g.items.length}）`,"),
    ("text: 'Open',", "text: '打开项目',"),
    ("{ hint: `${g.items.length} item(s)` },", "{ hint: `${g.items.length} 条` },"),
])
s = io.open('src/web/views/attention.js', encoding='utf-8').read()
if 'const SEV_ZH' not in s:
    s = s.replace("const SEV_ORDER = ['critical', 'high', 'medium', 'low'];",
                  "const SEV_ORDER = ['critical', 'high', 'medium', 'low'];\nconst SEV_ZH = { critical: '危急', high: '高', medium: '中', low: '低' };")
    io.open('src/web/views/attention.js', 'w', encoding='utf-8', newline='').write(s)
    print('SEV_ZH added')

# ---------- projects.js ----------
sub('src/web/views/projects.js', [
    ("setTopbar('Projects', 'Register local workspaces. Commander only ever reads them.', [\n    h('button', { class: 'btn', text: 'Seed demo projects', onClick: seedDemo }),\n    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),\n    h('button', { class: 'btn btn-primary', text: 'Add project', onClick: () => openAddDialog() }),",
     "setTopbar('项目', '注册本地工作区——Commander 对它们只读。', [\n    h('button', { class: 'btn', text: '生成演示项目', onClick: seedDemo }),\n    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),\n    h('button', { class: 'btn btn-primary', text: '添加项目', onClick: () => openAddDialog() }),"),
    ("return h('div', { class: 'stack' }, [\n        stateEmpty('No projects registered', 'Add a local workspace directory, or seed the demo projects.'),\n        card('What happens when you add a project?', h('ol', { class: 'stack-sm small' }, [\n          h('li', { text: 'Commander scans the directory (structure, stack, specs, TODO markers).' }),\n          h('li', { text: 'Sensitive files (.env, *.key, credentials…) are detected but never read.' }),\n          h('li', { text: 'Git state, build command and test commands are detected and executed with strict safety rules.' }),\n          h('li', { text: 'A snapshot, health verdict, risk list and next action are produced.' }),\n        ])),\n      ]);",
     "return h('div', { class: 'stack' }, [\n        renderImportPanel({}),\n        card('添加项目后会发生什么？', h('ol', { class: 'stack-sm small' }, [\n          h('li', { text: '扫描目录：结构、技术栈、规范文档、TODO 标记。' }),\n          h('li', { text: '敏感文件（.env、*.key、credentials…）只被识别，内容绝不会被读取。' }),\n          h('li', { text: 'Git 状态、构建与测试命令被自动识别，并在严格安全规则下执行。' }),\n          h('li', { text: '生成快照、健康结论、风险清单与下一步行动。' }),\n        ])),\n      ]);"),
    ("{ label: 'Project', render: (r) => h('div', {}, [h('a', { href: `#/projects/${r.id}`, text: r.name }), r.isDemo ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: 'demo' }) : null, h('div', { class: 'path', text: r.workspacePath })]) },",
     "{ label: '项目', render: (r) => h('div', {}, [h('a', { href: `#/projects/${r.id}`, text: r.name }), r.isDemo ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: '演示' }) : null, h('div', { class: 'path', text: r.workspacePath })]) },"),
    ("{ label: 'Health', render: (r) => healthBadge(r.health) },", "{ label: '健康', render: (r) => healthBadge(r.health) },"),
    ("{ label: 'Status', render: (r) => h('span', { class: 'chip', text: r.status }) },", "{ label: '状态', render: (r) => h('span', { class: 'chip', text: r.status }) },"),
    ("{ label: 'Stage', render: (r) => r.currentStage || '—' },", "{ label: '阶段', render: (r) => r.currentStage || '—' },"),
    ("{ label: 'Progress', render: (r) => (r.progress && r.progress.percent !== null ? `${r.progress.percent}%` : 'unknown'), num: true },",
     "{ label: '进度', render: (r) => (r.progress && r.progress.percent !== null ? `${r.progress.percent}%` : '未知'), num: true },"),
    ("{ label: 'Build', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },", "{ label: '构建', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },"),
    ("{ label: 'Gate', render: (r) => gateBadge(r.gate) },", "{ label: '验收门', render: (r) => gateBadge(r.gate) },"),
    ("{ label: 'Stack', render: (r) => h('span', { class: 'small', text: `${r.primaryLanguage || '?'} / ${r.framework || '?'}` }) },",
     "{ label: '技术栈', render: (r) => h('span', { class: 'small', text: `${r.primaryLanguage || '?'} / ${r.framework === 'unknown' ? '—' : r.framework || '?'}` }) },"),
    ("{ label: 'Actions', render: (r) => h('div', { class: 'row' }, [\n        h('button', { class: 'btn btn-sm', text: 'Scan', onClick: (e) => { e.stopPropagation(); scan(r.id); } }),\n        h('button', { class: 'btn btn-sm', text: 'Settings', onClick: (e) => { e.stopPropagation(); openProjectSettings(r); } }),\n      ]) },",
     "{ label: '操作', render: (r) => h('div', { class: 'row' }, [\n        h('button', { class: 'btn btn-sm', text: '扫描', onClick: (e) => { e.stopPropagation(); scan(r.id); } }),\n        h('button', { class: 'btn btn-sm', text: '设置', onClick: (e) => { e.stopPropagation(); openProjectSettings(r); } }),\n      ]) },"),
    ("], cards, { empty: 'No projects registered.' }),", "], cards, { empty: '暂无项目。' }),"),
    ("toast('Full scan queued — running build and tests…', 'info', 6000);", "toast('全量扫描已入队——正在执行构建与测试…', 'info', 6000);"),
    ("toast('Scan queued. Watch the Analysis Queue for progress.', 'ok');", "toast('扫描已入队，可在“分析队列”查看进度。', 'ok');"),
    ("toast(`Scan failed to queue: ${err.message}`, 'error');", "toast(`扫描入队失败：${err.message}`, 'error');"),
    ("toast('Seeding demo projects — real builds and tests are executing…', 'info', 10000);", "toast('正在生成演示项目——真实执行构建与测试…', 'info', 10000);"),
    ("toast(`Seeded ${results.filter((r) => !r.skipped).length} demo project(s)`, 'ok');", "toast(`已生成 ${results.filter((r) => !r.skipped).length} 个演示项目`, 'ok');"),
    ("toast(`Seeding failed: ${err.message}`, 'error');", "toast(`生成失败：${err.message}`, 'error');"),
    ("const dlg = modal('Add a local workspace', h('div', { class: 'stack' }, [", "const dlg = modal('添加本地工作区', h('div', { class: 'stack' }, ["),
    ("h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Workspace path (absolute)' }), pathInput]),",
     "h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '工作区路径（绝对路径）' }), pathInput]),"),
    ("h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Display name' }), nameInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Description' }), descInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Extra ignore patterns' }), ignoreInput]),",
     "h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '显示名称' }), nameInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '描述' }), descInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '额外忽略规则' }), ignoreInput]),"),
    ("h('div', { class: 'small muted', text: 'Commander never writes to this directory. Sensitive files are detected but their contents are never read.' }),",
     "h('div', { class: 'small muted', text: 'Commander 绝不写入该目录；敏感文件会被识别，但内容从不读取。' }),"),
    ("h('button', { class: 'btn btn-primary', text: 'Add and scan', onClick: submit }),\n      h('button', { class: 'btn', text: 'Cancel', onClick: () => dlg.close() }),",
     "h('button', { class: 'btn btn-primary', text: '添加并扫描', onClick: submit }),\n      h('button', { class: 'btn', text: '取消', onClick: () => dlg.close() }),"),
    ("const dlg = modal(`Settings — ${cardData.name}`, h('div', { class: 'stack' }, [", "const dlg = modal(`项目设置 — ${cardData.name}`, h('div', { class: 'stack' }, ["),
    ("h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Display name' }), nameInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Description' }), descInput]),",
     "h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '显示名称' }), nameInput]),\n    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '描述' }), descInput]),"),
    ("text: 'Save',", "text: '保存',"),
    ("text: cardData.watchPaused ? 'Resume watching' : 'Pause watching',", "text: cardData.watchPaused ? '恢复监控' : '暂停监控',"),
    ("text: 'Archive',", "text: '归档',"),
    ("toast('Project updated', 'ok');", "toast('项目已更新', 'ok');"),
    ("toast('Watch state updated', 'ok');", "toast('监控状态已更新', 'ok');"),
    ("toast('Project archived', 'ok');", "toast('已归档', 'ok');"),
    ("h('strong', { class: 'small', text: 'Delete Commander record' }),", "h('strong', { class: 'small', text: '删除 Commander 记录' }),"),
    ("h('div', { class: 'small muted', text: `This deletes only Commander's database rows. The source directory ${cardData.workspacePath} is never modified or deleted.` }),",
     "h('div', { class: 'small muted', text: `仅删除 Commander 自己的数据库记录；源码目录 ${cardData.workspacePath} 绝不会被修改或删除。` }),"),
    ("placeholder: 'type DELETE to confirm', 'aria-label': 'Delete confirmation'", "placeholder: '输入 DELETE 以确认', 'aria-label': '删除确认'"),
    ("text: 'Delete record',", "text: '删除记录',"),
    ("if (confirmInput.value.trim() !== 'DELETE') { status.textContent = 'Type DELETE to enable this action.'; return; }",
     "if (confirmInput.value.trim() !== 'DELETE') { status.textContent = '请输入 DELETE 以确认。'; return; }"),
    ("toast(`Record deleted. Source untouched: ${res.sourceDirectoryUntouched}`, 'ok', 8000);",
     "toast(`记录已删除，源码目录未动：${res.sourceDirectoryUntouched}`, 'ok', 8000);"),
])
print('batch1 done')
