import { api } from '../api.js';
import { h, metric, card, table, healthBadge, gateBadge, statusBadge, progressBar, mountAsync, stateEmpty, fmt, toast } from '../ui.js';
import { state, setTopbar, refreshShellData } from '../app.js';
import { Router } from '../router.js';

function runCell(run, suite) {
  if (!run) return h('span', { class: 'muted small', text: '未运行' });
  const total = run.total || 0;
  const cls = run.status === 'pass' ? 'badge-pass' : run.status === 'fail' || run.status === 'error' ? 'badge-fail' : 'badge-unknown';
  const ZH = { unit: '单元', integration: '集成', e2e: '端到端' };
  const label = run.status === 'unsupported' ? '不适用' : total ? `${run.passed}/${run.total}` : run.status;
  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${ZH[suite] || suite}：${label}` });
}

const STATUS_ZH = { planning: '规划中', developing: '开发中', testing: '测试中', review: '评审中', blocked: '已阻塞', ready: '就绪', released: '已发布', archived: '已归档' };

function projectCard(cardData) {
  const meta = cardData;
  return h('article', {
    class: 'proj-card',
    tabindex: '0',
    role: 'link',
    'aria-label': `Open project ${meta.name}`,
    onClick: () => Router.go(`/projects/${meta.id}`),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Router.go(`/projects/${meta.id}`); } },
  }, [
    h('div', { class: 'row-between' }, [
      h('div', { class: 'row' }, [
        h('h3', { text: meta.name }),
        meta.isDemo ? h('span', { class: 'chip', text: '演示' }) : null,
        meta.watchPaused ? h('span', { class: 'chip', text: '监控已暂停' }) : null,
      ]),
      healthBadge(meta.health),
    ]),
    h('div', { class: 'path', text: meta.workspacePath }),
    h('div', { class: 'proj-stats' }, [
      h('span', {}, [h('span', { class: 'muted', text: '阶段 ' }), h('b', { text: meta.currentStage || '未知' })]),
      h('span', {}, [h('span', { class: 'muted', text: '状态 ' }), h('b', { text: STATUS_ZH[meta.status] || meta.status })]),
      h('span', {}, [h('span', { class: 'muted', text: '任务 ' }), h('b', { text: `${meta.taskSummary.done}/${meta.taskSummary.total}` })]),
      h('span', {}, [h('span', { class: 'muted', text: '风险 ' }), h('b', { text: `${meta.riskSummary.bySeverity.critical} 危急 / ${meta.riskSummary.bySeverity.high} 高` })]),
      meta.git ? h('span', {}, [h('span', { class: 'muted', text: 'git ' }), h('b', { text: `${meta.git.branch}${meta.git.clean ? '' : ` (${meta.git.changed + meta.git.untracked} dirty)`}` })]) : null,
    ]),
    h('div', { class: 'row wrap' }, [
      meta.build ? statusBadge(meta.build.status) : null,
      runCell(meta.unit, 'unit'),
      runCell(meta.e2e, 'e2e'),
      gateBadge(meta.gate),
      meta.drift && meta.drift.verdict === 'possible_drift' ? h('span', { class: 'badge badge-warning', text: `drift: ${meta.drift.count}` }) : null,
      meta.regressionSummary && meta.regressionSummary.count ? h('span', { class: 'badge badge-critical', text: `${meta.regressionSummary.count} regression` }) : null,
    ]),
    progressBar({ percent: meta.progress ? meta.progress.percent : null, reason: meta.progress ? meta.progress.reason : '尚未计算' }),
    h('div', { class: 'small muted' }, `最近活动 ${fmt.rel(meta.lastActivity)} · 分析于 ${fmt.rel(meta.lastAnalyzedAt)}`),
    meta.nextAction ? h('div', { class: 'small' }, [
      h('span', { class: 'muted', text: '下一步：' }),
      h('span', { text: fmt.truncate(meta.nextAction.objective, 110) }),
    ]) : null,
  ]);
}

export async function render() {
  setTopbar('仪表盘', '所有受管 AI 编码项目的实时工程状态。', [
    h('button', { class: 'btn', text: '生成演示项目', onClick: seedDemo }),
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: '添加项目', onClick: () => Router.go('/projects') }),
  ]);
  const view = document.getElementById('view');

  await mountAsync(view, () => api.dashboard(), (data) => {
    const c = data.counts;
    const attentionData = state.attention || { items: [] };
    const criticals = attentionData.items.filter((i) => i.severity === 'critical').length;
    const head = h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('项目数', fmt.num(c.total), { foot: `${c.archived} 个已归档` }),
        metric('健康', fmt.num(c.healthy), { cls: 'ok' }),
        metric('警告', fmt.num(c.warning), { cls: c.warning ? 'warn' : '' }),
        metric('危急', fmt.num(c.critical), { cls: c.critical ? 'alert' : '' }),
        metric('阻塞', fmt.num(c.blocked), { cls: c.blocked ? 'alert' : '' }),
        metric('关注项', fmt.num(attentionData.items.length), { cls: criticals ? 'alert' : '', foot: `${criticals} 个紧急` }),
      ]),
      card('需要立即关注', attentionData.items.slice(0, 6).length
        ? h('div', { class: 'stack-sm' }, attentionData.items.slice(0, 6).map((i) => h('div', { class: `risk-item sev-${i.severity}` }, [
          h('div', { class: 'row-between' }, [
            h('strong', { class: 'small', text: i.title }),
            h('span', { class: `badge badge-${i.severity === 'critical' ? 'critical' : i.severity === 'high' ? 'warning' : 'unknown'}`, text: i.severity }),
          ]),
          i.detail ? h('div', { class: 'small muted', text: fmt.truncate(i.detail, 200) }) : null,
          h('a', { class: 'small', href: `#/projects/${i.projectId}`, text: 'Open project →' }),
        ])))
        : stateEmpty('暂无需关注的事项', '当前没有危急、阻塞、失败或回归的项目。'),
      { actions: [h('a', { class: 'small', href: '#/attention', text: '查看全部 →' })], hint: `共 ${attentionData.items.length} 条` }),

      h('div', { class: 'row-between' }, [
        h('h2', { style: { fontSize: '13px', margin: '8px 0 0' }, text: `项目（${data.cards.length}）` }),
      ]),
      data.cards.length
        ? h('div', { class: 'grid grid-2' }, data.cards.map(projectCard))
        : stateEmpty('还没有项目', '添加一个本地工作区，或先生成三个演示项目体验 Commander。'),
    ]);
    return head;
  }, { loadingLabel: 'Loading dashboard…' });
}

async function seedDemo() {
  try {
    toast('正在生成演示项目——会真实执行构建和测试…', 'info', 8000);
    const results = await api.seedDemo({ runCommands: true });
    await refreshShellData();
    toast(`演示项目生成完成：已分析 ${results.filter((r) => !r.skipped).length} 个项目`, 'ok');
    render();
  } catch (err) {
    toast(`Demo seed failed: ${err.message}`, 'error');
  }
}

export function projectTable(cards) {
  return table([
    { label: 'Project', render: (r) => h('a', { href: `#/projects/${r.id}`, text: r.name }) },
    { label: 'Health', render: (r) => healthBadge(r.health) },
    { label: 'Status', key: 'status' },
    { label: 'Stage', render: (r) => r.currentStage || '—' },
    { label: 'Build', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },
    { label: 'Unit', render: (r) => (r.unit ? `${r.unit.passed}/${r.unit.total}` : '—'), num: true },
    { label: 'E2E', render: (r) => (r.e2e ? `${r.e2e.passed}/${r.e2e.total}` : '—'), num: true },
    { label: 'Risks', render: (r) => `${r.riskSummary.bySeverity.critical}/${r.riskSummary.bySeverity.high}`, num: true },
    { label: 'Last activity', render: (r) => fmt.rel(r.lastActivity) },
  ], cards);
}
