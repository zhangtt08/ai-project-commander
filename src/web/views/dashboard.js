import { api } from '../api.js';
import { h, metric, card, table, healthBadge, gateBadge, statusBadge, progressBar, mountAsync, stateEmpty, fmt, toast } from '../ui.js';
import { state, setTopbar, refreshShellData } from '../app.js';
import { Router } from '../router.js';

function runCell(run, suite) {
  if (!run) return h('span', { class: 'muted small', text: 'not run' });
  const total = run.total || 0;
  const cls = run.status === 'pass' ? 'badge-pass' : run.status === 'fail' || run.status === 'error' ? 'badge-fail' : 'badge-unknown';
  const label = run.status === 'unsupported' ? 'n/a' : total ? `${run.passed}/${run.total}` : run.status;
  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${suite}: ${label}` });
}

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
        meta.isDemo ? h('span', { class: 'chip', text: 'demo' }) : null,
        meta.watchPaused ? h('span', { class: 'chip', text: 'watch paused' }) : null,
      ]),
      healthBadge(meta.health),
    ]),
    h('div', { class: 'path', text: meta.workspacePath }),
    h('div', { class: 'proj-stats' }, [
      h('span', {}, [h('span', { class: 'muted', text: 'stage ' }), h('b', { text: meta.currentStage || 'unknown' })]),
      h('span', {}, [h('span', { class: 'muted', text: 'status ' }), h('b', { text: meta.status })]),
      h('span', {}, [h('span', { class: 'muted', text: 'tasks ' }), h('b', { text: `${meta.taskSummary.done}/${meta.taskSummary.total}` })]),
      h('span', {}, [h('span', { class: 'muted', text: 'risks ' }), h('b', { text: `${meta.riskSummary.bySeverity.critical}c / ${meta.riskSummary.bySeverity.high}h` })]),
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
    progressBar({ percent: meta.progress ? meta.progress.percent : null, reason: meta.progress ? meta.progress.reason : 'not computed' }),
    h('div', { class: 'small muted' }, `Last activity ${fmt.rel(meta.lastActivity)} · analyzed ${fmt.rel(meta.lastAnalyzedAt)}`),
    meta.nextAction ? h('div', { class: 'small' }, [
      h('span', { class: 'muted', text: 'Next: ' }),
      h('span', { text: fmt.truncate(meta.nextAction.objective, 110) }),
    ]) : null,
  ]);
}

export async function render() {
  setTopbar('Dashboard', 'Live engineering state across every managed AI coding project.', [
    h('button', { class: 'btn', text: 'Seed demo projects', onClick: seedDemo }),
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: 'Add project', onClick: () => Router.go('/projects') }),
  ]);
  const view = document.getElementById('view');

  await mountAsync(view, () => api.dashboard(), (data) => {
    const c = data.counts;
    const attentionData = state.attention || { items: [] };
    const criticals = attentionData.items.filter((i) => i.severity === 'critical').length;
    const head = h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('Projects', fmt.num(c.total), { foot: `${c.archived} archived` }),
        metric('Healthy', fmt.num(c.healthy), { cls: 'ok' }),
        metric('Warning', fmt.num(c.warning), { cls: c.warning ? 'warn' : '' }),
        metric('Critical', fmt.num(c.critical), { cls: c.critical ? 'alert' : '' }),
        metric('Blocked', fmt.num(c.blocked), { cls: c.blocked ? 'alert' : '' }),
        metric('Attention items', fmt.num(attentionData.items.length), { cls: criticals ? 'alert' : '', foot: `${criticals} critical` }),
      ]),
      card('Needs attention now', attentionData.items.slice(0, 6).length
        ? h('div', { class: 'stack-sm' }, attentionData.items.slice(0, 6).map((i) => h('div', { class: `risk-item sev-${i.severity}` }, [
          h('div', { class: 'row-between' }, [
            h('strong', { class: 'small', text: i.title }),
            h('span', { class: `badge badge-${i.severity === 'critical' ? 'critical' : i.severity === 'high' ? 'warning' : 'unknown'}`, text: i.severity }),
          ]),
          i.detail ? h('div', { class: 'small muted', text: fmt.truncate(i.detail, 200) }) : null,
          h('a', { class: 'small', href: `#/projects/${i.projectId}`, text: 'Open project →' }),
        ])))
        : stateEmpty('Nothing needs attention', 'No critical, blocked, failing or regressed projects right now.'),
      { actions: [h('a', { class: 'small', href: '#/attention', text: 'View all →' })], hint: `${attentionData.items.length} total` }),

      h('div', { class: 'row-between' }, [
        h('h2', { style: { fontSize: '13px', margin: '8px 0 0' }, text: `Projects (${data.cards.length})` }),
      ]),
      data.cards.length
        ? h('div', { class: 'grid grid-2' }, data.cards.map(projectCard))
        : stateEmpty('No projects yet', 'Add a local workspace, or seed the three demo projects to explore Commander.'),
    ]);
    return head;
  }, { loadingLabel: 'Loading dashboard…' });
}

async function seedDemo() {
  try {
    toast('Seeding demo projects — this runs real builds and tests…', 'info', 8000);
    const results = await api.seedDemo({ runCommands: true });
    await refreshShellData();
    toast(`Demo seed complete: ${results.filter((r) => !r.skipped).length} project(s) analysed`, 'ok');
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
