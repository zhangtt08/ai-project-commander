# -*- coding: utf-8 -*-
"""Engine zh batch 4: UI layer maps + remaining engine strings (dev tool)."""
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

# ---------------- ui.js: relative time in Chinese ----------------
sub('src/web/ui.js', [
    ("    const s = Math.round(diff / 1000);\n    if (s < 60) return `${s}s ago`;\n    const m = Math.round(s / 60);\n    if (m < 60) return `${m}m ago`;\n    const hr = Math.round(m / 60);\n    if (hr < 24) return `${hr}h ago`;\n    const d = Math.round(hr / 24);\n    return `${d}d ago`;",
     "    const s = Math.round(diff / 1000);\n    if (s < 60) return `${s} 秒前`;\n    const m = Math.round(s / 60);\n    if (m < 60) return `${m} 分钟前`;\n    const hr = Math.round(m / 60);\n    if (hr < 24) return `${hr} 小时前`;\n    const d = Math.round(hr / 24);\n    return `${d} 天前`;"),
    ("export function progressBar(progress) {\n  if (!progress || progress.percent === null || progress.percent === undefined) {\n    return h('div', { class: 'small muted', text: `Progress unknown — ${progress && progress.reason ? progress.reason : 'insufficient data'}` });\n  }",
     "export function progressBar(progress) {\n  if (!progress || progress.percent === null || progress.percent === undefined) {\n    return h('div', { class: 'small muted', text: `进度未知——${progress && progress.reason ? progress.reason : '数据不足'}` });\n  }"),
    ("export function stateLoading(label = 'Loading…') {", "export function stateLoading(label = '加载中…') {"),
    ("export function stateError(err, onRetry = null) {\n  return h('div', { class: 'state error' }, [\n    h('h3', { text: err && err.message ? err.message : 'Something went wrong' }),",
     "export function stateError(err, onRetry = null) {\n  return h('div', { class: 'state error' }, [\n    h('h3', { text: err && err.message ? err.message : '出了点问题' }),"),
    ("export function copyButton(text, label = 'Copy') {", "export function copyButton(text, label = '复制') {"),
    ("toast('Copied to clipboard', 'ok', 2000);", "toast('已复制到剪贴板', 'ok', 2000);"),
    ("toast('Copy failed — select the text manually', 'error');", "toast('复制失败——请手动选择文本', 'error');"),
])

# ---------------- dashboard.js: enum maps + suite labels ----------------
sub('src/web/views/dashboard.js', [
    ("const HEALTH_CLASS = ", "const STATUS_ZH = { planning: '规划中', developing: '开发中', testing: '测试中', review: '评审中', blocked: '已阻塞', ready: '就绪', released: '已发布', archived: '已归档' };\nconst HEALTH_CLASS = "),
    ("h('span', { class: 'muted', text: '阶段 ' }), h('b', { text: meta.currentStage || 'unknown' })]),",
     "h('span', { class: 'muted', text: '阶段 ' }), h('b', { text: meta.currentStage || '未知' })]),"),
    ("h('span', { class: 'muted', text: '状态 ' }), h('b', { text: meta.status })]),",
     "h('span', { class: 'muted', text: '状态 ' }), h('b', { text: STATUS_ZH[meta.status] || meta.status })]),"),
    ("const label = run.status === 'unsupported' ? '不适用' : total ? `${run.passed}/${run.total}` : run.status;\n  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${suite}: ${label}` });",
     "const ZH = { unit: '单元', integration: '集成', e2e: '端到端' };\n  const label = run.status === 'unsupported' ? '不适用' : total ? `${run.passed}/${run.total}` : run.status;\n  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${ZH[suite] || suite}：${label}` });"),
    ("h('span', {}, [h('span', { class: 'muted', text: '风险 ' }), h('b', { text: `${meta.riskSummary.bySeverity.critical}c / ${meta.riskSummary.bySeverity.high}h` })]),",
     "h('span', {}, [h('span', { class: 'muted', text: '风险 ' }), h('b', { text: `${meta.riskSummary.bySeverity.critical} 危急 / ${meta.riskSummary.bySeverity.high} 高` })]),"),
    ("progressBar({ percent: meta.progress ? meta.progress.percent : null, reason: meta.progress ? meta.progress.reason : 'not computed' }),",
     "progressBar({ percent: meta.progress ? meta.progress.percent : null, reason: meta.progress ? meta.progress.reason : '尚未计算' }),"),
])

# ---------------- project.js: stage/status 未知 + suite labels ----------------
sub('src/web/views/project.js', [
    ("metric('Stage', p.currentStage || 'unknown', { sm: true, foot: p.status }),",
     "metric('阶段', p.currentStage || '未知', { sm: true, foot: p.status }),"),
    ("runCell(run, suite) {\n  if (!run) return h('span', { class: 'muted small', text: 'not run' });\n  const total = run.total || 0;",
     "runCell(run, suite) {\n  if (!run) return h('span', { class: 'muted small', text: '未运行' });\n  const total = run.total || 0;"),
    ("const label = run.status === 'unsupported' ? 'n/a' : total ? `${run.passed}/${run.total}` : run.status;\n  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${suite}: ${label}` });",
     "const ZH = { unit: '单元', integration: '集成', e2e: '端到端' };\n  const label = run.status === 'unsupported' ? '不适用' : total ? `${run.passed}/${run.total}` : run.status;\n  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${ZH[suite] || suite}：${label}` });"),
])

# ---------------- stage-manager.js ----------------
sub('src/core/engines/stage-manager.js', [
    ("name: 'Unplanned work',\n          index: 1,\n          description: 'Tasks exist but no stage structure could be inferred from the documentation.',",
     "name: '未规划的工作',\n          index: 1,\n          description: '存在任务，但无法从文档推断出阶段结构。',"),
    ("note: 'Stage structure is inferred from the task ledger only.',", "note: '阶段结构仅根据任务账本推断。',"),
    ("note: 'No stage declarations found in specs and no tasks exist yet — stage is Unknown.',",
     "note: '规范中没有阶段声明，也不存在任务——阶段未知。',"),
])
print('batch4 done')
