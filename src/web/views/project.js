import { api } from '../api.js';
import {
  h, card, table, metric, mountAsync, stateEmpty, stateLoading, healthBadge, statusBadge, gateBadge,
  progressBar, evidenceList, fmt, toast, modal, copyButton, mockBadge,
} from '../ui.js';
import { setTopbar, refreshShellData } from '../app.js';
import { Router } from '../router.js';

const TABS = [
  'overview', 'stages', 'tasks', 'tests', 'build', 'git', 'changes',
  'prompts', 'sessions', 'risks', 'memory', 'decisions', 'timeline', 'settings',
];

const TAB_LABEL = {
  overview: '概述', stages: '阶段', tasks: '任务', tests: '测试', build: '构建',
  git: 'Git', changes: '变更', prompts: '提示词', sessions: 'Agent 会话',
  risks: '风险', memory: '记忆', decisions: '决策', timeline: '时间线', settings: '设置',
};

let current = { id: null, tab: 'overview', card: null };

export async function render(projectId, tab = 'overview') {
  const activeTab = TABS.includes(tab) ? tab : 'overview';
  current = { id: projectId, tab: activeTab, card: null };

  const view = document.getElementById('view');
  view.replaceChildren(stateLoading('正在加载项目…'));

  let cardData;
  try {
    cardData = await api.project(projectId);
  } catch (err) {
    view.replaceChildren(h('div', { class: 'state error' }, [
      h('h3', { text: err.message }), h('div', { class: 'evidence', text: err.code || '' }),
      h('div', { style: { marginTop: '10px' } }, h('a', { class: 'btn', href: '#/projects', text: 'Back to projects' })),
    ]));
    setTopbar('未找到项目', projectId);
    return;
  }
  current.card = cardData;

  setTopbar(cardData.name, `${cardData.workspacePath} · ${cardData.primaryLanguage} / ${cardData.framework}`, [
    h('button', { class: 'btn', text: '快速扫描', onClick: () => runScan('quick') }),
    h('button', { class: 'btn', text: '全量扫描', onClick: () => runScan('full') }),
    h('button', { class: 'btn', text: '生成提示词', onClick: () => generatePrompt(cardData) }),
    h('button', { class: 'btn', text: '交接包', onClick: () => showHandoff(cardData) }),
    h('button', { class: 'btn btn-ghost', text: '全部项目', onClick: () => Router.go('/projects') }),
    h('button', { class: 'btn btn-danger', text: '删除', onClick: () => confirmDelete(cardData) }),
  ]);

  const tabsBar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map((t) => h('button', {
    class: 'tab',
    role: 'tab',
    'aria-selected': t === activeTab ? 'true' : 'false',
    text: TAB_LABEL[t],
    onClick: () => Router.go(`/projects/${projectId}/${t}`),
  })));

  const container = h('div', { class: 'stack' });
  view.replaceChildren(tabsBar, container);

  // 若该项目有排队/运行中的任务，完成后自动刷新界面（拖拽导入后的首次扫描即属此类）。
  scheduleScanRefresh(projectId);

  const loaders = {
    overview: () => renderOverview(container, projectId),
    stages: () => renderStages(container, projectId),
    tasks: () => renderTasks(container, projectId),
    tests: () => renderTests(container, projectId),
    build: () => renderBuild(container, projectId),
    git: () => renderGit(container, projectId),
    changes: () => renderChanges(container, projectId),
    prompts: () => renderPrompts(container, projectId),
    sessions: () => renderSessions(container, projectId),
    risks: () => renderRisks(container, projectId),
    memory: () => renderMemory(container, projectId),
    decisions: () => renderDecisions(container, projectId),
    timeline: () => renderTimeline(container, projectId),
    settings: () => renderSettings(container, cardData),
  };
  await loaders[activeTab]();
}

function scheduleScanRefresh(projectId) {
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (current.id !== projectId || Date.now() - startedAt > 600000) { clearInterval(timer); return; }
    try {
      const jobs = await api.jobs();
      const busy = jobs.some((j) => j.project_id === projectId && (j.status === 'queued' || j.status === 'running'));
      if (!busy) { clearInterval(timer); Router.reload(); }
    } catch { /* transient */ }
  }, 3000);
  if (timer.unref) timer.unref();
}

async function runScan(mode) {
  try {
    toast(`已入队${mode === 'quick' ? '快速' : '全量'}扫描…`, 'info', 4000);
    await api.scan(current.id, { mode, runCommands: mode === 'full', suites: ['unit', 'e2e'] });
    toast('扫描已入队——任务完成后结果自动出现。', 'ok');
    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > 180000) { clearInterval(poll); return; }
      try {
        const jobs = await api.jobs();
        const mine = jobs.filter((j) => j.project_id === current.id && (j.status === 'queued' || j.status === 'running'));
        if (!mine.length) {
          clearInterval(poll);
          await refreshShellData();
          Router.reload();
          toast('扫描完成。', 'ok');
        }
      } catch { clearInterval(poll); }
    }, 3000);
  } catch (err) {
    toast(`扫描失败：${err.message}`, 'error');
  }
}

// ───────────────────────────── Overview ─────────────────────────────

async function renderOverview(container, id) {
  await mountAsync(container, () => api.projectDetail(id), (d) => {
    const p = d.project;
    const meta = d.metadata;
    const unavailable = [];
    for (const c of d.commands) if (!c.supported) unavailable.push(c.kind);

    return h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('健康', p.health, { cls: p.health === 'healthy' ? 'ok' : p.health === 'critical' ? 'alert' : p.health === 'warning' ? 'warn' : '', foot: d.health ? `${d.health.score}/100` : '' }),
        metric('阶段', p.currentStage || '未知', { sm: true, foot: p.status }),
        metric('构建', d.build ? d.build.status : '未运行', { sm: true, cls: d.build && d.build.status === 'pass' ? 'ok' : d.build && d.build.status === 'fail' ? 'alert' : '', foot: d.build ? d.build.command : '' }),
        metric('单元测试', d.tests.unit ? `${d.tests.unit.passed}/${d.tests.unit.total}` : '未运行', { cls: d.tests.unit && d.tests.unit.status === 'pass' ? 'ok' : d.tests.unit && d.tests.unit.status === 'fail' ? 'alert' : '' }),
        metric('端到端测试', d.tests.e2e ? `${d.tests.e2e.passed}/${d.tests.e2e.total}` : '未运行', { cls: d.tests.e2e && d.tests.e2e.status === 'pass' ? 'ok' : d.tests.e2e && d.tests.e2e.status === 'fail' ? 'alert' : '' }),
        metric('开放任务', `${d.taskSummary.done}/${d.taskSummary.total}`, { foot: `${d.taskSummary.blocked} 个阻塞` }),
        metric('风险', `${d.riskSummary.bySeverity.critical} 危急 / ${d.riskSummary.bySeverity.high} 高`, { cls: d.riskSummary.bySeverity.critical ? 'alert' : d.riskSummary.bySeverity.high ? 'warn' : '', foot: `最重：${d.riskSummary.worst || '无'}` }),
        metric('回归', String(d.regressionSummary.count), { cls: d.regressionSummary.count ? 'alert' : 'ok', foot: d.regressionSummary.worst || '无' }),
      ]),

      h('div', { class: 'grid grid-2' }, [
        card('进度', h('div', { class: 'stack-sm' }, [
          progressBar(d.progress),
          d.progress && d.progress.method ? h('div', { class: 'small muted', text: `method: ${d.progress.method} · confidence: ${d.progress.confidence}` }) : null,
          (d.progress && d.progress.parts ? d.progress.parts : []).map((part) => h('div', { class: 'small muted', text: `${part.key}: ${part.detail}` })),
        ]), { hint: '仅由阶段 + 任务 + 验收标准推导' }),

        card('验收门', d.gate ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'row' }, [gateBadge(d.gate)]),
          h('div', { class: 'small', text: d.gate.explanation }),
          ...d.gate.checks.map((c) => h('div', { class: `check-item ${c.status}` }, [
            h('div', { class: 'row-between' }, [
              h('strong', { class: 'small', text: c.name }),
              h('span', { class: `badge ${c.status === 'PASS' ? 'badge-pass' : c.status === 'FAIL' ? 'badge-fail' : c.status === 'BLOCKED' ? 'badge-critical' : 'badge-unknown'}`, text: c.status }),
            ]),
            h('div', { class: 'small muted', text: c.detail }),
            c.evidence && c.evidence.length ? evidenceList(c.evidence) : null,
          ])),
        ]) : stateEmpty('门禁未评估', '运行一次全量扫描以评估验收门。')),
      ]),

      d.nextAction ? card('下一步建议行动', h('div', { class: 'stack-sm' }, [
        h('div', { class: 'row wrap' }, [
          h('span', { class: 'badge badge-accent', text: d.nextAction.priority }),
          h('span', { class: 'badge badge-neutral', text: `rule: ${d.nextAction.deterministicRule || 'n/a'}` }),
          d.nextAction.confidence ? h('span', { class: 'badge badge-neutral', text: `confidence: ${d.nextAction.confidence}` }) : null,
          d.nextAction.aiProvider ? mockBadge(d.nextAction.aiProvider) : null,
        ]),
        h('strong', { text: d.nextAction.objective }),
        h('div', { class: 'small', text: d.nextAction.reason }),
        d.nextAction.scope && d.nextAction.scope.length ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'small muted', text: 'Scope' }),
          h('ul', { class: 'small', style: { margin: '0', paddingLeft: '18px' } }, d.nextAction.scope.map((s) => h('li', { text: s }))),
        ]) : null,
        d.nextAction.acceptanceCriteria && d.nextAction.acceptanceCriteria.length ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'small muted', text: 'Acceptance' }),
          h('ul', { class: 'small', style: { margin: '0', paddingLeft: '18px' } }, d.nextAction.acceptanceCriteria.map((s) => h('li', { text: s }))),
        ]) : null,
        d.nextAction.verificationCommands && d.nextAction.verificationCommands.length ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'small muted', text: 'Verify' }),
          h('div', { class: 'tag-list' }, d.nextAction.verificationCommands.map((c) => h('code', { class: 'inline', text: c }))),
        ]) : null,
        h('div', { class: 'row' }, [
          h('button', { class: 'btn btn-primary btn-sm', text: '生成 Agent 提示词', onClick: () => generatePrompt(current.card) }),
          h('button', { class: 'btn btn-sm', text: '用 AI 重新计算', onClick: recomputeNextAction }),
        ]),
      ])) : card('下一步建议行动', stateEmpty('尚未计算', '先进行一次全量扫描，然后生成下一步动作。')),

      h('div', { class: 'grid grid-2' }, [
        card('健康明细（为什么？）', d.health ? h('div', { class: 'stack-sm' }, d.health.reasons.map((r) => h('div', { class: `reason-item sev-${r.severity}` }, [
          h('div', { class: 'row-between' }, [
            h('strong', { class: 'small', text: r.code }),
            h('span', { class: 'badge badge-neutral', text: r.severity }),
          ]),
          h('div', { class: 'small', text: r.message }),
          r.fix ? h('div', { class: 'small muted', text: `Fix: ${r.fix}` }) : null,
          r.evidence && r.evidence.length ? evidenceList(r.evidence) : null,
        ]))) : stateEmpty('暂无健康分析', '请先运行一次全量扫描。')),
        card('规范漂移', d.drift ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'row' }, [
            h('span', { class: `badge ${d.drift.verdict === 'aligned' ? 'badge-pass' : d.drift.verdict === 'possible_drift' ? 'badge-warning' : 'badge-unknown'}`, text: d.drift.verdict }),
            h('span', { class: 'small muted', text: d.drift.note || '' }),
          ]),
          ...(d.drift.drifts || []).map((x) => h('div', { class: `risk-item sev-${x.severity}` }, [
            h('strong', { class: 'small', text: x.title }),
            h('div', { class: 'small muted', text: x.description }),
            x.evidence && x.evidence.length ? evidenceList(x.evidence) : null,
          ])),
        ]) : stateEmpty('暂无漂移分析')),
      ]),

      card('检测到的命令', d.commands.length
        ? table([
          { label: 'Kind', key: 'kind' },
          { label: 'Supported', render: (r) => (r.supported ? h('span', { class: 'badge badge-pass', text: 'yes' }) : h('span', { class: 'badge badge-unknown', text: 'no' })) },
          { label: 'Command', render: (r) => (r.display ? h('code', { class: 'inline', text: r.display }) : '—') },
          { label: 'Source', key: 'source' },
          { label: 'Reason if unsupported', render: (r) => h('span', { class: 'small muted', text: r.reason || '' }) },
        ], d.commands)
        : stateEmpty('No metadata yet')),

      card('项目元数据', meta ? h('dl', { class: 'kv' }, [
        h('dt', { text: 'Files scanned' }), h('dd', { text: `${meta.fileCount} (${fmt.bytes(meta.totalBytes)})${meta.truncated ? ' — TRUNCATED at the configured limit' : ''}` }),
        h('dt', { text: 'Languages' }), h('dd', { text: (meta.languages || []).slice(0, 6).map((l) => `${l.name} (${l.files})`).join(', ') || '—' }),
        h('dt', { text: 'Frameworks' }), h('dd', { text: (meta.frameworks || []).join(', ') || '—' }),
        h('dt', { text: 'Package manager' }), h('dd', { text: meta.packageManager }),
        h('dt', { text: 'File roles' }), h('dd', { text: Object.entries(meta.roleCounts || {}).map(([k, v]) => `${k}:${v}`).join('  ') }),
        h('dt', { text: 'Config files' }), h('dd', { text: Object.entries(meta.configFiles || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none detected' }),
        h('dt', { text: 'Specification docs' }), h('dd', { text: (meta.specCandidates || []).join(', ') || 'none found' }),
        h('dt', { text: 'Sensitive files' }), h('dd', { text: meta.sensitiveCount ? `${meta.sensitiveCount} detected (contents never read): ${(meta.sensitiveFiles || []).map((f) => `${f.path} [${f.rule}]`).join(', ')}` : 'none' }),
        h('dt', { text: 'TODO / FIXME markers' }), h('dd', { text: String((meta.todos || []).length) }),
        h('dt', { text: 'File fingerprint' }), h('dd', { text: meta.fileFingerprint }),
        h('dt', { text: 'Scan duration' }), h('dd', { text: `${meta.durationMs}ms${d.lastScanDurationMs ? ` (full pipeline ${d.lastScanDurationMs}ms)` : ''}` }),
      ]) : stateEmpty('Not scanned yet', 'Run a full scan.')),

      d.aiSummary ? card('AI 项目摘要', h('div', { class: 'stack-sm' }, [
        h('div', { class: 'row' }, [mockBadge(d.aiSummary.provider), h('span', { class: 'badge badge-neutral', text: `confidence: ${d.aiSummary.confidence}` })]),
        h('div', { class: 'small', text: d.aiSummary.summary }),
        d.aiSummary.mainModules && d.aiSummary.mainModules.length ? h('div', { class: 'tag-list' }, d.aiSummary.mainModules.map((m) => h('span', { class: 'chip', text: m }))) : null,
        evidenceList(d.aiSummary.evidence || []),
      ])) : null,

      unavailable.length ? card('明确不支持', h('div', { class: 'small muted', text: `未能为以下类型检测到命令：${unavailable.join('、')}。Commander 会如实报告“不适用”，而不是猜测。` })) : null,
    ]);
  }, { loadingLabel: '正在加载概述…' });
}

async function recomputeNextAction() {
  try {
    toast('正在重新计算下一步行动…', 'info', 3000);
    await api.generateNextAction(current.id, { useAI: true });
    toast('下一步行动已更新', 'ok');
    Router.reload();
  } catch (err) { toast(err.message, 'error'); }
}

// ───────────────────────────── Stages ─────────────────────────────

async function renderStages(container, id) {
  await mountAsync(container, () => api.stages(id), ({ stages, criteria }) => h('div', { class: 'stack' }, [
    card(`Stages (${stages.length})`, stages.length ? table([
      { label: '#', render: (r) => String(r.order_index + 1), num: true },
      { label: 'Name', key: 'name' },
      { label: 'Status', render: (r) => h('span', { class: `badge ${r.status === 'completed' ? 'badge-pass' : r.status === 'in_progress' ? 'badge-info' : r.status === 'blocked' ? 'badge-critical' : 'badge-unknown'}`, text: r.status }) },
      { label: 'Source', key: 'source' },
      { label: 'Confidence', key: 'confidence' },
      { label: 'Started', render: (r) => fmt.date(r.started_at) },
      { label: 'Completed', render: (r) => fmt.date(r.completed_at) },
    ], stages) : stateEmpty('No stages could be inferred', 'Declare stages in SPEC.md or README.md, e.g. "## Stage 1 — Foundations". Commander reports "unknown" rather than inventing stages.'), { hint: 'inferred from spec/readme headings + task distribution' }),
    card(`Acceptance criteria (${criteria.length})`, criteria.length ? table([
      { label: 'Kind', key: 'kind' },
      { label: 'Ref', render: (r) => r.requirement_ref || '—' },
      { label: 'Text', render: (r) => h('span', { class: 'small', text: r.text }) },
      { label: 'Status', render: (r) => h('span', { class: `badge ${r.status === 'satisfied' ? 'badge-pass' : r.status === 'unmet' ? 'badge-fail' : 'badge-unknown'}`, text: r.status }) },
      { label: 'Source', render: (r) => (r.evidence || []).map((e) => e.ref).join(', ') || '—' },
    ], criteria) : stateEmpty('No acceptance criteria extracted')),
  ]), { loadingLabel: 'Loading stages…' });
}

// ───────────────────────────── Tasks ─────────────────────────────

async function renderTasks(container, id) {
  await mountAsync(container, () => api.tasks(id), ({ tasks, summary }) => {
    const addTitle = h('input', { class: 'input', placeholder: 'New task title', 'aria-label': 'New task title' });
    const addPriority = h('select', { class: 'select', 'aria-label': 'Priority' }, ['p0', 'p1', 'p2', 'p3'].map((p) => h('option', { value: p, selected: p === 'p2', text: p })));
    const add = async () => {
      const title = addTitle.value.trim();
      if (!title) return;
      try {
        await api.addTask(id, { title, priority: addPriority.value });
        toast('Task added', 'ok');
        renderTasks(container, id);
      } catch (err) { toast(err.message, 'error'); }
    };
    addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    return h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('Total', String(summary.total)),
        metric('Open', String(summary.open), { cls: summary.open ? 'warn' : 'ok' }),
        metric('Blocked', String(summary.blocked), { cls: summary.blocked ? 'alert' : '' }),
        metric('Done', String(summary.done), { cls: 'ok' }),
      ]),
      card('Ledger sources', h('div', { class: 'tag-list' }, Object.entries(summary.bySource).map(([k, v]) => h('span', { class: 'chip', text: `${k}: ${v}` }))), { hint: 'spec · checkbox · TODO/FIXME · agent log · manual · AI' }),
      card('Add a task', h('div', { class: 'row' }, [addTitle, h('div', { style: { width: '84px' } }, addPriority), h('button', { class: 'btn btn-primary', text: 'Add', onClick: add })])),
      card(`Tasks (${tasks.length})`, tasks.length ? table([
        { label: 'Status', render: (r) => h('select', {
          class: 'select btn-sm',
          'aria-label': `Status of ${r.title}`,
          style: { width: '116px' },
          onChange: async (e) => { await api.updateTask(r.id, { status: e.target.value }); toast('Task updated', 'ok'); renderTasks(container, id); },
        }, ['todo', 'in_progress', 'blocked', 'done', 'cancelled'].map((s) => h('option', { value: s, selected: s === r.status, text: s }))) },
        { label: 'Priority', render: (r) => h('span', { class: 'badge badge-neutral', text: r.priority }) },
        { label: 'Title', render: (r) => h('div', {}, [h('div', { class: 'small', text: r.title }), r.description ? h('div', { class: 'small muted', text: fmt.truncate(r.description, 140) }) : null]) },
        { label: 'Source', key: 'source' },
        { label: 'Confidence', key: 'confidence' },
        { label: 'Evidence', render: (r) => evidenceList(r.evidence) },
        { label: 'Updated', render: (r) => fmt.rel(r.updated_at) },
      ], tasks) : stateEmpty('No tasks in the ledger', 'They are derived from specifications, markdown checkboxes and TODO/FIXME markers once a full scan has run.')),
    ]);
  }, { loadingLabel: 'Loading tasks…' });
}

// ───────────────────────────── Tests ─────────────────────────────

async function renderTests(container, id) {
  await mountAsync(container, () => api.tests(id), ({ history, latest }) => h('div', { class: 'stack' }, [
    h('div', { class: 'grid grid-3' }, ['unit', 'integration', 'e2e'].map((suite) => {
      const run = latest[suite];
      return metric(`${suite} tests`, run ? (run.total ? `${run.passed}/${run.total}` : run.status) : 'not run', {
        cls: run && run.status === 'pass' ? 'ok' : run && (run.status === 'fail' || run.status === 'error') ? 'alert' : '',
        sm: true,
        foot: run ? `${run.framework} · ${fmt.duration(run.duration_ms)} · ${fmt.rel(run.ts)}` : 'no run recorded',
      });
    })),
    ...['unit', 'integration', 'e2e'].map((suite) => {
      const run = latest[suite];
      const hist = history[suite] || [];
      return card(`${suite} — latest run`, run ? h('div', { class: 'stack' }, [
        h('div', { class: 'row wrap' }, [
          statusBadge(run.status),
          h('code', { class: 'inline', text: run.command || '(no command)' }),
          h('span', { class: 'chip', text: `framework: ${run.framework}` }),
          h('span', { class: 'chip', text: `parse confidence: ${run.parse_confidence}` }),
          h('span', { class: 'chip', text: `exit: ${run.exit_code}` }),
          h('span', { class: 'chip', text: `duration: ${fmt.duration(run.duration_ms)}` }),
        ]),
        run.raw_tail ? h('details', {}, [h('summary', { class: 'small muted', text: 'Raw output (tail)' }), h('pre', { class: 'code', text: run.raw_tail })]) : null,
        (run.cases || []).length ? h('div', { class: 'stack-sm' }, [
          h('div', { class: 'small muted', text: `Failing cases (${run.cases.length})` }),
          ...run.cases.map((c) => h('div', { class: 'risk-item sev-high' }, [
            h('strong', { class: 'small', text: c.name }),
            c.file ? h('div', { class: 'evidence', text: c.file }) : null,
            c.error_summary ? h('pre', { class: 'code', text: c.error_summary }) : null,
          ])),
        ]) : h('div', { class: 'small muted', text: 'No failing cases recorded for this run.' }),
        h('div', { class: 'small muted', text: `History: ${hist.length} run(s) retained — runs are never overwritten.` }),
        hist.length > 1 ? table([
          { label: 'When', render: (r) => fmt.date(r.ts) },
          { label: 'Status', render: (r) => statusBadge(r.status) },
          { label: 'Passed', render: (r) => String(r.passed), num: true },
          { label: 'Failed', render: (r) => String(r.failed), num: true },
          { label: 'Total', render: (r) => String(r.total), num: true },
          { label: 'Duration', render: (r) => fmt.duration(r.durationMs), num: true },
        ], hist) : null,
      ]) : stateEmpty(`${suite} tests have not been run`, 'Run a full scan, or the suite may not exist in this project (reported as unsupported, not as a failure).'));
    }),
  ]), { loadingLabel: 'Loading test history…' });
}

// ───────────────────────────── Build ─────────────────────────────

async function renderBuild(container, id) {
  await mountAsync(container, () => api.builds(id), ({ builds }) => {
    const byKind = {};
    for (const b of builds) if (!byKind[b.kind]) byKind[b.kind] = b;
    return h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-3' }, Object.entries(byKind).map(([kind, b]) => metric(kind, b.status, {
        sm: true, cls: b.status === 'pass' ? 'ok' : b.status === 'fail' ? 'alert' : '', foot: `${b.command} · ${fmt.duration(b.duration_ms)}`,
      }))),
      card(`Build history (${builds.length})`, builds.length ? table([
        { label: 'Kind', key: 'kind' },
        { label: 'Status', render: (r) => statusBadge(r.status) },
        { label: 'Command', render: (r) => h('code', { class: 'inline', text: r.command }) },
        { label: 'Exit', render: (r) => String(r.exit_code ?? '—'), num: true },
        { label: 'Duration', render: (r) => fmt.duration(r.duration_ms), num: true },
        { label: 'When', render: (r) => fmt.date(r.ts) },
        { label: 'Output', render: (r) => h('details', {}, [h('summary', { class: 'small muted', text: 'show' }), h('pre', { class: 'code', text: `${r.stdout_summary || ''}\n${r.stderr_summary || ''}`.trim() || '(empty)' })]) },
      ], builds) : stateEmpty('No build results recorded', 'Run a full scan.')),
    ]);
  }, { loadingLabel: 'Loading build history…' });
}

// ───────────────────────────── Git ─────────────────────────────

async function renderGit(container, id) {
  await mountAsync(container, () => api.git(id), ({ git, snapshots }) => {
    if (!git) return stateEmpty('No git data', 'Run a scan first.');
    if (!git.gitAvailable) return stateEmpty('Git is not installed', 'Commander could not find the git executable on PATH.');
    if (!git.isRepository) return stateEmpty('Not a git repository', git.error || 'No .git directory was found for this workspace.');
    return h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('Branch', git.branch, { sm: true }),
        metric('HEAD', git.commitShort || 'no commits', { sm: true }),
        metric('Working tree', git.workingTreeClean ? 'clean' : `${git.changedFileCount + git.untracked.length} files`, { sm: true, cls: git.workingTreeClean ? 'ok' : 'warn' }),
        metric('Last commit', fmt.rel(git.commitTime), { sm: true, foot: fmt.truncate(git.commitSubject, 60) }),
      ]),
      h('div', { class: 'grid grid-2' }, [
        card(`Working tree (${git.changedFileCount} changed, ${git.untracked.length} untracked)`, h('div', { class: 'stack-sm' }, gitFileGroups(git))),
        card('Diff summary', h('div', { class: 'stack-sm' }, [
          h('div', { class: 'kv' }, [
            h('dt', { text: 'Files changed' }), h('dd', { text: String(git.diffSummary.filesChanged) }),
            h('dt', { text: 'Insertions' }), h('dd', { text: String(git.diffSummary.insertions) }),
            h('dt', { text: 'Deletions' }), h('dd', { text: String(git.diffSummary.deletions) }),
          ]),
          h('div', { class: 'small muted', text: 'Confirmed via git only — never inferred by an LLM.' }),
        ])),
      ]),
      card(`Recent commits (${git.recentCommits.length})`, git.recentCommits.length ? table([
        { label: 'Hash', render: (r) => h('code', { class: 'inline', text: r.hash }) },
        { label: 'Author', key: 'author' },
        { label: 'When', render: (r) => fmt.date(r.date) },
        { label: 'Subject', render: (r) => h('span', { class: 'small', text: r.subject }) },
      ], git.recentCommits) : stateEmpty(git.isUnborn ? 'Repository has no commits yet' : 'No commits found')),
      card(`Git snapshots (${snapshots.length})`, snapshots.length ? table([
        { label: 'When', render: (r) => fmt.date(r.ts) },
        { label: 'Branch', key: 'branch' },
        { label: 'HEAD', render: (r) => h('code', { class: 'inline', text: (r.commit_hash || '').slice(0, 7) || '—' }) },
        { label: 'Clean', render: (r) => (r.working_tree_clean ? h('span', { class: 'badge badge-pass', text: 'clean' }) : h('span', { class: 'badge badge-warning', text: `${r.modified.length + r.untracked.length} dirty` })) },
        { label: 'Files', render: (r) => `${r.modified.length}M ${r.added.length}A ${r.deleted.length}D ${r.untracked.length}U`, num: true },
      ], snapshots) : stateEmpty('No git snapshots stored')),
    ]);
  }, { loadingLabel: 'Loading git state…' });
}


function gitFileGroups(git) {
  const groups = [['modified', git.modified], ['added', git.added], ['deleted', git.deleted], ['untracked', git.untracked]];
  const out = groups
    .filter(([, list]) => (list || []).length)
    .map(([label, list]) => h('div', {}, [
      h('div', { class: 'small muted', text: `${label} (${list.length})` }),
      h('div', { class: 'tag-list' }, list.slice(0, 40).map((f) => h('span', { class: 'chip mono', text: f }))),
    ]));
  if ((git.renamed || []).length) {
    out.push(h('div', {}, [
      h('div', { class: 'small muted', text: `renamed (${git.renamed.length})` }),
      h('div', { class: 'tag-list' }, git.renamed.map((r) => h('span', { class: 'chip mono', text: `${r.from} -> ${r.to}` }))),
    ]));
  }
  if (!git.changedFileCount && !(git.untracked || []).length) out.push(h('div', { class: 'small muted', text: 'Working tree is clean.' }));
  return out;
}

// ───────────────────────────── Changes ─────────────────────────────

async function renderChanges(container, id) {
  await mountAsync(container, () => api.changes(id), ({ changes, snapshots }) => h('div', { class: 'stack' }, [
    card('Change classification', h('div', { class: 'stack' }, [
      h('div', { class: 'row wrap' }, [
        h('span', { class: 'small', text: changes.summary }),
        changes.isRegressionRisk ? h('span', { class: 'badge badge-warning', text: 'deletions outside docs detected' }) : null,
      ]),
      h('div', { class: 'tag-list' }, Object.entries(changes.byKind).map(([k, v]) => h('span', { class: 'chip', text: `${k}: ${v}` }))),
      changes.files.length ? table([
        { label: 'Status', key: 'status' },
        { label: 'Kind', render: (r) => h('span', { class: 'badge badge-neutral', text: r.kind }) },
        { label: 'Path', render: (r) => h('span', { class: 'mono small', text: r.path }) },
        { label: '+/-', render: (r) => `${r.insertions ?? '?'} / ${r.deletions ?? '?'}`, num: true },
        { label: 'Rationale', render: (r) => h('span', { class: 'small muted', text: r.rationale }) },
      ], changes.files) : stateEmpty('No changes in the working tree'),
    ])),
    card('Snapshot history', snapshots.length ? table([
      { label: '#', render: (r) => String(r.seq), num: true },
      { label: 'When', render: (r) => fmt.date(r.ts) },
      { label: 'Health', render: (r) => healthBadge(r.health) },
      { label: 'Build', render: (r) => statusBadge((r.build || {}).status || 'unknown') },
      { label: 'Unit', render: (r) => `${(r.unit || {}).passed ?? '?'}/${(r.unit || {}).total ?? '?'}` , num: true },
      { label: 'E2E', render: (r) => `${(r.e2e || {}).passed ?? '?'}/${(r.e2e || {}).total ?? '?'}`, num: true },
      { label: 'Gate', render: (r) => ((r.gate || {}).result || '—') },
      { label: 'Files', render: (r) => String(r.fileCount), num: true },
      { label: 'Stage', render: (r) => r.stageName || '—' },
    ], snapshots) : stateEmpty('No snapshots yet', 'Run a full scan to create the first snapshot.')),
  ]), { loadingLabel: 'Loading changes…' });
}

// ───────────────────────────── Prompts ─────────────────────────────

async function renderPrompts(container, id) {
  await mountAsync(container, () => api.prompts(id), ({ prompts, executions }) => h('div', { class: 'stack' }, [
    card('Prompt history', prompts.length ? table([
      { label: 'When', render: (r) => fmt.date(r.created_at) },
      { label: 'Agent', key: 'agent_key' },
      { label: 'Provider', render: (r) => mockBadge(r.provider) },
      { label: 'Status', render: (r) => h('span', { class: 'badge badge-neutral', text: r.status }) },
      { label: 'Title', render: (r) => h('span', { class: 'small', text: fmt.truncate(r.title, 90) }) },
      { label: '', render: (r) => h('button', { class: 'btn btn-sm', text: 'View', onClick: () => showPrompt(r) }) },
    ], prompts) : stateEmpty('No prompts generated yet', 'Use "Generate prompt" in the top bar.')),
    card('Prompt → Execution → Evidence → Acceptance', executions.length ? table([
      { label: 'When', render: (r) => fmt.date(r.created_at) },
      { label: 'Status', render: (r) => h('span', { class: 'badge badge-neutral', text: r.status }) },
      { label: 'Prompt', render: (r) => (r.prompt_id ? h('code', { class: 'inline', text: r.prompt_id.slice(0, 16) }) : '—') },
      { label: 'Session', render: (r) => (r.agent_session_id ? h('code', { class: 'inline', text: r.agent_session_id.slice(0, 16) }) : '—') },
      { label: 'Result', render: (r) => h('span', { class: 'small muted', text: fmt.truncate(r.result_summary, 120) }) },
    ], executions) : stateEmpty('No executions linked yet', 'Import an agent session and link it to a prompt to close the loop.')),
  ]), { loadingLabel: 'Loading prompts…' });
}

function showPrompt(p) {
  modal(p.title || 'Prompt', h('div', { class: 'stack' }, [
    h('div', { class: 'row wrap' }, [
      h('span', { class: 'chip', text: `agent: ${p.agent_key}` }),
      h('span', { class: 'chip', text: `provider: ${p.provider}` }),
      h('span', { class: 'chip', text: fmt.date(p.created_at) }),
      copyButton(p.content, '复制提示词'),
      h('button', {
        class: 'btn btn-sm',
        text: '导出为 .md 文件',
        onClick: () => {
          const blob = new Blob([p.content], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = h('a', { href: url, download: `${(p.title || 'agent-prompt').replace(/[\\/:*?"<>|]/g, '-')}.md` });
          document.body.appendChild(link); link.click(); document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast('提示词已导出为 .md 文件，可直接拖给 Coding Agent 使用', 'ok', 8000);
        },
      }),
    ]),
    h('pre', { class: 'code', style: { maxHeight: '46vh' }, text: p.content }),
    p.expected_result ? h('div', {}, [h('div', { class: 'small muted', text: 'Expected result' }), h('div', { class: 'small', text: p.expected_result })]) : null,
    p.actual_result ? h('div', {}, [h('div', { class: 'small muted', text: 'Actual result' }), h('div', { class: 'small', text: p.actual_result })]) : null,
  ]));
}

async function generatePrompt(cardData) {
  try {
    toast('Generating agent prompt…', 'info', 4000);
    const res = await api.generatePrompt(current.id, { agentKey: 'generic_cli' });
    const missing = (res.meta.sections && res.meta.sections.missing) || [];
    if (missing.length) toast(`Warning: provider omitted sections (${missing.join(', ')}) — deterministic fallback filled them.`, 'error', 8000);
    showPrompt(res.prompt);
    Router.reload();
  } catch (err) {
    toast(`提示词生成失败：${err.message}`, 'error');
  }
}

// ───────────────────────────── Agent sessions ─────────────────────────────

async function renderSessions(container, id) {
  await mountAsync(container, () => api.sessions(id), ({ sessions, adapters }) => {
    const textarea = h('textarea', { class: 'textarea', rows: '8', placeholder: 'Paste an agent transcript (commands, exit codes, edited files)…', 'aria-label': 'Transcript' });
    const provider = h('select', { class: 'select', 'aria-label': 'Provider' }, ['manual', 'codex', 'claude_code', 'cursor', 'gemini', 'generic_cli'].map((p) => h('option', { value: p, text: p })));
    const importBtn = h('button', {
      class: 'btn btn-primary',
      text: 'Import transcript',
      onClick: async () => {
        try {
          await api.importSession(id, { transcript: textarea.value, provider: provider.value });
          toast('Session imported and parsed', 'ok');
          renderSessions(container, id);
        } catch (err) { toast(err.message, 'error'); }
      },
    });
    const mockBtn = h('button', {
      class: 'btn',
      text: 'Import MOCK session',
      onClick: async () => {
        try {
          await api.importSession(id, { mock: true });
          toast('Mock session imported (explicitly labelled as mock)', 'info');
          renderSessions(container, id);
        } catch (err) { toast(err.message, 'error'); }
      },
    });

    return h('div', { class: 'stack' }, [
      card('Adapters', table([
        { label: 'Adapter', key: 'label' },
        { label: 'Implementation', render: (r) => h('span', { class: `badge ${r.real ? 'badge-pass' : 'badge-mock'}`, text: r.real ? 'real' : 'mock' }) },
        { label: 'Providers', render: (r) => h('div', { class: 'tag-list' }, r.providers.map((p) => h('span', { class: 'chip', text: p }))) },
        { label: 'Note', render: (r) => h('span', { class: 'small muted', text: r.note }) },
      ], adapters), { hint: 'real Codex/Claude/Cursor transcript readers are P2 (KNOWN_ISSUES MOCK-002)' }),
      card('Import a session', h('div', { class: 'stack' }, [
        h('div', { class: 'row' }, [h('div', { style: { width: '180px' } }, provider), importBtn, mockBtn]),
        textarea,
      ])),
      card(`Imported sessions (${sessions.length})`, sessions.length ? table([
        { label: 'When', render: (r) => fmt.date(r.created_at) },
        { label: 'Provider', render: (r) => h('div', { class: 'row' }, [h('span', { text: r.provider }), r.is_mock ? h('span', { class: 'badge badge-mock', text: 'mock' }) : null]) },
        { label: 'Adapter', key: 'adapter' },
        { label: 'Status', render: (r) => h('span', { class: 'badge badge-neutral', text: r.status }) },
        { label: 'Files touched', render: (r) => String((r.changed_files || []).length), num: true },
        { label: 'Commands', render: (r) => String(((r.execution_result || {}).commands || []).length), num: true },
        { label: 'Summary', render: (r) => h('span', { class: 'small muted', text: fmt.truncate(r.summary, 140) }) },
      ], sessions) : stateEmpty('No agent sessions imported')),
    ]);
  }, { loadingLabel: 'Loading agent sessions…' });
}

// ───────────────────────────── Risks ─────────────────────────────

async function renderRisks(container, id) {
  await mountAsync(container, async () => ({ risks: await api.risks(id), regressions: await api.regressions(id), issues: await api.issues(id) }), ({ risks, regressions, issues }) => h('div', { class: 'stack' }, [
    card(`Risks (${risks.summary.total})`, h('div', { class: 'stack-sm' }, [
      h('div', { class: 'row wrap' }, Object.entries(risks.summary.bySeverity).map(([sev, count]) => h('span', { class: `badge ${sev === 'critical' ? 'badge-critical' : sev === 'high' ? 'badge-warning' : 'badge-neutral'}`, text: `${sev}: ${count}` }))),
      ...risks.risks.map((r) => h('div', { class: `risk-item sev-${r.severity}` }, [
        h('div', { class: 'row-between wrap' }, [
          h('div', { class: 'row wrap' }, [
            h('span', { class: 'badge badge-neutral', text: r.severity }),
            h('span', { class: 'chip mono', text: r.code }),
            h('span', { class: 'chip', text: r.source }),
            h('strong', { class: 'small', text: r.title }),
          ]),
          h('div', { class: 'row' }, [
            h('span', { class: `badge ${r.status === 'open' ? 'badge-warning' : 'badge-pass'}`, text: r.status }),
            h('button', {
              class: 'btn btn-sm',
              text: r.status === 'open' ? 'Resolve' : 'Reopen',
              onClick: async () => { await api.updateRisk(r.id, { status: r.status === 'open' ? 'resolved' : 'open' }); renderRisks(container, id); },
            }),
          ]),
        ]),
        h('div', { class: 'small', text: r.description }),
        r.suggested_action ? h('div', { class: 'small muted', text: `Suggested action: ${r.suggested_action}` }) : null,
        evidenceList(r.evidence),
      ])),
    ]), { hint: 'deterministic rules · AI risks are additive and clearly labelled' }),
    card(`Issues (${issues.issues.length})`, (() => {
      const title = h('input', { class: 'input', placeholder: 'New issue title', 'aria-label': 'New issue title' });
      const severity = h('select', { class: 'select', 'aria-label': 'Issue severity' }, ['low', 'medium', 'high', 'critical'].map((sv) => h('option', { value: sv, selected: sv === 'medium', text: sv })));
      const description = h('input', { class: 'input', placeholder: 'What is wrong? (optional)', 'aria-label': 'Issue description' });
      const create = async () => {
        const t = title.value.trim();
        if (!t) { toast('Issue title is required', 'error'); return; }
        try {
          await api.addIssue(id, { title: t, severity: severity.value, description: description.value.trim() });
          toast('Issue created', 'ok');
          renderRisks(container, id);
        } catch (err) { toast(err.message, 'error'); }
      };
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
      return h('div', { class: 'stack' }, [
        h('div', { class: 'row wrap' }, [h('div', { style: { flex: '2 1 220px' } }, title), h('div', { style: { width: '110px' } }, severity), h('div', { style: { flex: '2 1 220px' } }, description), h('button', { class: 'btn btn-primary', text: 'Add', onClick: create })]),
        issues.issues.length
          ? table([
            { label: 'Status', render: (r) => h('select', {
              class: 'select btn-sm', 'aria-label': `Status of ${r.title}`, style: { width: '104px' },
              onChange: async (e) => { await api.updateIssue(r.id, { status: e.target.value }); renderRisks(container, id); },
            }, ['open', 'resolved'].map((st) => h('option', { value: st, selected: st === r.status, text: st }))) },
            { label: 'Severity', render: (r) => h('span', { class: `badge ${r.severity === 'critical' ? 'badge-critical' : r.severity === 'high' ? 'badge-warning' : 'badge-neutral'}`, text: r.severity }) },
            { label: 'Title', render: (r) => h('span', { class: 'small', text: r.title }) },
            { label: 'Description', render: (r) => h('span', { class: 'small muted', text: fmt.truncate(r.description, 120) }) },
            { label: 'Created', render: (r) => fmt.rel(r.created_at) },
          ], issues.issues)
          : h('div', { class: 'small muted', text: 'No issues recorded. Risks are computed automatically; issues are the ones you file by hand.' }),
      ]);
    })(), { hint: 'manual bug/issue records — risks are computed, issues are filed' }),
    card(`Regressions (${regressions.summary.count})`, regressions.regressions.length ? table([
      { label: 'When', render: (r) => fmt.date(r.ts) },
      { label: 'Type', render: (r) => h('code', { class: 'inline', text: r.type }) },
      { label: 'Severity', render: (r) => h('span', { class: `badge ${r.severity === 'critical' ? 'badge-critical' : r.severity === 'high' ? 'badge-warning' : 'badge-neutral'}`, text: r.severity }) },
      { label: 'Title', render: (r) => h('span', { class: 'small', text: r.title }) },
      { label: 'Before → After', render: (r) => h('span', { class: 'mono small', text: `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}` }) },
      { label: '', render: (r) => (r.acknowledged ? h('span', { class: 'badge badge-pass', text: 'ack' }) : h('button', { class: 'btn btn-sm', text: 'Acknowledge', onClick: async () => { await api.ackRegression(r.id); renderRisks(container, id); } })) },
    ], regressions.regressions) : stateEmpty('No regressions detected', 'A regression is only reported when two snapshots disagree on a metric.')),
  ]), { loadingLabel: 'Loading risks…' });
}

// ───────────────────────────── Memory ─────────────────────────────

async function renderMemory(container, id) {
  await mountAsync(container, () => api.memory(id), ({ latest, history, rendered }) => {
    const note = h('input', { class: 'input', placeholder: 'Note for the new memory version', 'aria-label': 'Memory note' });
    return h('div', { class: 'stack' }, [
      card('Project memory', h('div', { class: 'stack' }, [
        latest ? h('div', { class: 'row wrap' }, [
          h('span', { class: 'chip', text: `v${latest.version}` }),
          h('span', { class: 'chip', text: `author: ${latest.author}` }),
          h('span', { class: 'chip', text: fmt.date(latest.created_at) }),
        ]) : null,
        h('div', { class: 'row' }, [note, h('button', {
          class: 'btn btn-primary',
          text: 'Create new version',
          onClick: async () => {
            try { await api.versionMemory(id, { note: note.value }); toast('New memory version created', 'ok'); renderMemory(container, id); } catch (err) { toast(err.message, 'error'); }
          },
        })]),
        h('div', { class: 'small muted', text: 'Versions are append-only: a new version never overwrites history.' }),
        h('pre', { class: 'code', text: rendered || '(no memory recorded yet)' }),
      ])),
      card(`Version history (${history.length})`, history.length ? table([
        { label: 'Version', render: (r) => String(r.version), num: true },
        { label: 'When', render: (r) => fmt.date(r.created_at) },
        { label: 'Author', key: 'author' },
        { label: 'Note', render: (r) => h('span', { class: 'small muted', text: r.note || '' }) },
      ], history) : stateEmpty('No versions yet')),
    ]);
  }, { loadingLabel: 'Loading project memory…' });
}

// ───────────────────────────── Decisions ─────────────────────────────

async function renderDecisions(container, id) {
  await mountAsync(container, () => api.decisions(id), ({ decisions }) => {
    const title = h('input', { class: 'input', placeholder: 'Decision title', 'aria-label': 'Decision title' });
    const context = h('textarea', { class: 'textarea', rows: '3', placeholder: 'Context', 'aria-label': 'Context' });
    const decision = h('textarea', { class: 'textarea', rows: '3', placeholder: 'Decision', 'aria-label': 'Decision' });
    const consequences = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Consequences', 'aria-label': 'Consequences' });
    return h('div', { class: 'stack' }, [
      card('New architecture decision record', h('div', { class: 'stack' }, [title, context, decision, consequences, h('button', {
        class: 'btn btn-primary',
        text: 'Create ADR',
        onClick: async () => {
          try {
            await api.createDecision(id, { title: title.value, context: context.value, decision: decision.value, consequences: consequences.value, status: 'accepted' });
            toast('ADR created', 'ok');
            renderDecisions(container, id);
          } catch (err) { toast(err.message, 'error'); }
        },
      })])),
      card(`Decisions (${decisions.length})`, decisions.length ? table([
        { label: 'Status', render: (r) => h('select', {
          class: 'select btn-sm', 'aria-label': `Status of ${r.title}`, style: { width: '120px' },
          onChange: async (e) => { await api.updateDecision(r.id, { status: e.target.value }); toast('ADR updated', 'ok'); },
        }, ['proposed', 'accepted', 'deprecated', 'superseded'].map((s) => h('option', { value: s, selected: s === r.status, text: s }))) },
        { label: 'Title', render: (r) => h('strong', { class: 'small', text: r.title }) },
        { label: 'Context', render: (r) => h('span', { class: 'small muted', text: fmt.truncate(r.context, 120) }) },
        { label: 'Decision', render: (r) => h('span', { class: 'small muted', text: fmt.truncate(r.decision, 120) }) },
        { label: 'When', render: (r) => fmt.date(r.created_at) },
      ], decisions) : stateEmpty('No decisions recorded')),
    ]);
  }, { loadingLabel: 'Loading decisions…' });
}

// ───────────────────────────── Timeline ─────────────────────────────

async function renderTimeline(container, id) {
  await mountAsync(container, () => api.timeline(id), ({ events }) => card(`Timeline (${events.length})`, events.length
    ? h('div', { class: 'timeline' }, events.map((e) => h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-time', text: fmt.date(e.ts) }),
      h('div', { class: `tl-dot ${e.level}` }),
      h('div', { class: 'tl-msg' }, [
        h('div', { text: e.message }),
        h('div', { class: 'evidence', text: e.type }),
      ]),
    ]))) : stateEmpty('No events yet')), { loadingLabel: 'Loading timeline…' });
}

// ───────────────────────────── Settings ─────────────────────────────

async function renderSettings(container, cardData) {
  const nameInput = h('input', { class: 'input', value: cardData.name, 'aria-label': 'Name' });
  const descInput = h('textarea', { class: 'textarea', rows: '3', value: cardData.description || '', 'aria-label': 'Description' });
  const ignoreInput = h('input', { class: 'input', placeholder: 'comma separated', 'aria-label': 'Ignore patterns' });
  const confirmInput = h('input', { class: 'input', placeholder: 'type DELETE', 'aria-label': 'Delete confirmation' });

  container.replaceChildren(h('div', { class: 'stack' }, [
    card('Project', h('div', { class: 'stack' }, [
      h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Display name' }), nameInput]),
      h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Description' }), descInput]),
      h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Extra ignore patterns' }), ignoreInput]),
      h('div', { class: 'row' }, [h('button', {
        class: 'btn btn-primary', text: 'Save',
        onClick: async () => {
          try {
            await api.updateProject(cardData.id, {
              name: nameInput.value.trim(), description: descInput.value.trim(),
              ignorePatterns: ignoreInput.value.split(',').map((s) => s.trim()).filter(Boolean),
            });
            toast('Saved', 'ok');
            await refreshShellData();
            Router.reload();
          } catch (err) { toast(err.message, 'error'); }
        },
      })]),
    ])),
    card('Workspace control', h('div', { class: 'row wrap' }, [
      h('button', { class: 'btn', text: cardData.watchPaused ? 'Resume watcher' : 'Pause watcher', onClick: async () => {
        try {
          if (cardData.watchPaused) await api.resumeWatch(cardData.id); else await api.pauseWatch(cardData.id);
          toast('Updated', 'ok'); Router.reload();
        } catch (err) { toast(err.message, 'error'); }
      } }),
      h('button', { class: 'btn', text: 'Archive', onClick: async () => { await api.archiveProject(cardData.id); toast('Archived', 'ok'); await refreshShellData(); Router.go('/projects'); } }),
      h('button', { class: 'btn', text: 'Reveal path', onClick: () => toast(cardData.workspacePath, 'info', 8000) }),
    ])),
    card('Danger zone', h('div', { class: 'stack' }, [
      h('div', { class: 'small', text: 'Deleting the Commander record removes only Commander\'s own database rows. The source directory is never modified or deleted (ADR-009).' }),
      h('div', { class: 'evidence', text: cardData.workspacePath }),
      confirmInput,
      h('button', {
        class: 'btn btn-danger', text: 'Delete Commander record',
        onClick: async () => {
          if (confirmInput.value.trim() !== 'DELETE') { toast('Type DELETE to confirm', 'error'); return; }
          try {
            const res = await api.deleteProject(cardData.id);
            toast(`Record deleted. Source untouched: ${res.sourceDirectoryUntouched}`, 'ok', 9000);
            await refreshShellData();
            Router.go('/projects');
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
    ])),
  ]));
}

// ───────────────────────────── Handoff ─────────────────────────────

async function confirmDelete(cardData) {
  const confirmInput = h('input', { class: 'input', placeholder: '输入 DELETE 确认', 'aria-label': '删除确认' });
  const status = h('div', { class: 'small muted' });
  const dlg = modal(`删除项目记录 — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'small', text: '仅删除 Commander 自己的数据库记录（任务/风险/快照/提示词等）。源码目录不会被修改或删除：' }),
    h('div', { class: 'evidence', text: cardData.workspacePath }),
    confirmInput,
    h('div', { class: 'row' }, [
      h('button', {
        class: 'btn btn-danger', text: '永久删除记录',
        onClick: async () => {
          if (confirmInput.value.trim() !== 'DELETE') { status.textContent = '请输入 DELETE 以确认。'; return; }
          try {
            const res = await api.deleteProject(cardData.id);
            dlg.close();
            toast(`记录已删除，源码目录未动：${res.sourceDirectoryUntouched}`, 'ok', 9000);
            await refreshShellData();
            Router.go('/projects');
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', { class: 'btn', text: '取消', onClick: () => dlg.close() }),
    ]),
    status,
  ]));
}

async function showHandoff(cardData) {
  try {
    toast('Building handoff package…', 'info', 3000);
    const pkg = await api.handoff(current.id);
    modal('Agent handoff package', h('div', { class: 'stack' }, [
      h('div', { class: 'row wrap' }, [
        h('span', { class: 'chip', text: `${pkg.sections.length} sections` }),
        pkg.missingSections.length ? h('span', { class: 'badge badge-warning', text: `missing: ${pkg.missingSections.join(', ')}` }) : null,
        copyButton(pkg.markdown, 'Copy handoff'),
        h('button', {
          class: 'btn btn-sm',
          text: 'Export as .md',
          onClick: async () => {
            try {
              const res = await api.exportHandoff(current.id, {});
              toast(`Exported ${res.name} (${res.bytes} bytes)`, 'ok', 6000);
              window.open(res.url, '_blank', 'noopener');
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ]),
      h('div', { class: 'small muted', text: 'Hand this to Codex → Claude → Cursor → Gemini so a new agent can continue without the original chat history.' }),
      h('pre', { class: 'code', style: { maxHeight: '50vh' }, text: pkg.markdown }),
    ]));
  } catch (err) {
    toast(`交接包生成失败：${err.message}`, 'error');
  }
}

export { TABS, TAB_LABEL };
