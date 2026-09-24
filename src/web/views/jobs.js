import { api } from '../api.js';
import { h, card, table, mountAsync, stateEmpty, fmt, toast, statusBadge } from '../ui.js';
import { setTopbar } from '../app.js';

export async function render(mode = 'jobs') {
  if (mode === 'events') return renderEvents();
  setTopbar('Analysis Queue', 'Bounded concurrency, timeouts, retries and cancellation — no unbounded background work.', [
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render('jobs') }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, async () => ({ jobs: await api.jobs(), stats: await api.jobsStats() }), ({ jobs, stats }) => h('div', { class: 'stack' }, [
    h('div', { class: 'grid grid-4' }, [
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Total jobs' }), h('div', { class: 'value', text: String(stats.total) })]),
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Running' }), h('div', { class: 'value', text: `${stats.running}/${stats.concurrency}` })]),
      h('div', { class: 'metric ok' }, [h('div', { class: 'label', text: 'Completed' }), h('div', { class: 'value', text: String(stats.byStatus.completed || 0) })]),
      h('div', { class: 'metric alert' }, [h('div', { class: 'label', text: 'Failed' }), h('div', { class: 'value', text: String(stats.byStatus.failed || 0) })]),
    ]),
    card('Jobs', jobs.length ? table([
      { label: 'Type', key: 'type' },
      { label: 'Status', render: (r) => statusBadge(r.status) },
      { label: 'Project', render: (r) => (r.project_id ? h('a', { href: `#/projects/${r.project_id}`, text: r.project_id.slice(0, 12) }) : '—') },
      { label: 'Attempts', render: (r) => `${r.attempts}/${r.max_attempts}`, num: true },
      { label: 'Created', render: (r) => fmt.rel(r.created_at) },
      { label: 'Finished', render: (r) => (r.finished_at ? fmt.rel(r.finished_at) : '—') },
      { label: 'Error', render: (r) => (r.error ? h('span', { class: 'small', title: r.error, text: fmt.truncate(r.error, 70) }) : '—') },
      { label: '', render: (r) => (r.status === 'queued' || r.status === 'running'
        ? h('button', { class: 'btn btn-sm', text: 'Cancel', onClick: async () => { await api.cancelJob(r.id); toast('Job cancelled', 'ok'); render('jobs'); } })
        : null) },
    ], jobs, { empty: 'No jobs yet.' }) : stateEmpty('Queue is empty', 'Run a scan from a project to create jobs.')),
  ]), { loadingLabel: 'Loading queue…' });
}

async function renderEvents() {
  setTopbar('Global Timeline', 'Every recorded project event, newest first.', [
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render('events') }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, () => api.get('/api/events?limit=150'), ({ events }) => card('Events', events.length
    ? h('div', { class: 'timeline' }, events.map((e) => h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-time', text: fmt.date(e.ts) }),
      h('div', { class: `tl-dot ${e.level}` }),
      h('div', { class: 'tl-msg' }, [
        h('div', { text: e.message }),
        h('div', { class: 'evidence', text: `${e.type}${e.project_id ? ` · ${e.project_id}` : ''}` }),
      ]),
    ]))) : stateEmpty('No events recorded yet')), { loadingLabel: 'Loading events…' });
}

