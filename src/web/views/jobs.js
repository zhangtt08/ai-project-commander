import { api } from '../api.js';
import { h, card, table, mountAsync, stateEmpty, fmt, toast, statusBadge } from '../ui.js';
import { setTopbar } from '../app.js';

export async function render(mode = 'jobs') {
  if (mode === 'events') return renderEvents();
  setTopbar('分析队列', '有界并发、超时、重试与取消——绝无失控的后台任务。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render('jobs') }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, async () => ({ jobs: await api.jobs(), stats: await api.jobsStats() }), ({ jobs, stats }) => h('div', { class: 'stack' }, [
    h('div', { class: 'grid grid-4' }, [
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: '任务总数' }), h('div', { class: 'value', text: String(stats.total) })]),
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: '运行中' }), h('div', { class: 'value', text: `${stats.running}/${stats.concurrency}` })]),
      h('div', { class: 'metric ok' }, [h('div', { class: 'label', text: '已完成' }), h('div', { class: 'value', text: String(stats.byStatus.completed || 0) })]),
      h('div', { class: 'metric alert' }, [h('div', { class: 'label', text: '失败' }), h('div', { class: 'value', text: String(stats.byStatus.failed || 0) })]),
    ]),
    card('任务', jobs.length ? table([
      { label: '类型', key: 'type' },
      { label: '状态', render: (r) => statusBadge(r.status) },
      { label: '项目', render: (r) => (r.project_id ? h('a', { href: `#/projects/${r.project_id}`, text: r.project_id.slice(0, 12) }) : '—') },
      { label: '尝试', render: (r) => `${r.attempts}/${r.max_attempts}`, num: true },
      { label: '创建于', render: (r) => fmt.rel(r.created_at) },
      { label: '结束于', render: (r) => (r.finished_at ? fmt.rel(r.finished_at) : '—') },
      { label: '错误', render: (r) => (r.error ? h('span', { class: 'small', title: r.error, text: fmt.truncate(r.error, 70) }) : '—') },
      { label: '', render: (r) => (r.status === 'queued' || r.status === 'running'
        ? h('button', { class: 'btn btn-sm', text: '取消', onClick: async () => { await api.cancelJob(r.id); toast('已取消', 'ok'); render('jobs'); } })
        : null) },
    ], jobs, { empty: '暂无任务。' }) : stateEmpty('队列为空', '在项目中运行一次扫描即可创建任务。')),
  ]), { loadingLabel: '正在加载队列…' });
}

async function renderEvents() {
  setTopbar('全局时间线', '所有已记录的项目事件，按时间倒序。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render('events') }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, () => api.get('/api/events?limit=150'), ({ events }) => card('事件', events.length
    ? h('div', { class: 'timeline' }, events.map((e) => h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-time', text: fmt.date(e.ts) }),
      h('div', { class: `tl-dot ${e.level}` }),
      h('div', { class: 'tl-msg' }, [
        h('div', { text: e.message }),
        h('div', { class: 'evidence', text: `${e.type}${e.project_id ? ` · ${e.project_id}` : ''}` }),
      ]),
    ]))) : stateEmpty('No events recorded yet')), { loadingLabel: '正在加载事件…' });
}

