import { api } from '../api.js';
import { h, card, table, mountAsync, stateEmpty, fmt, toast, statusBadge } from '../ui.js';
import { setTopbar } from '../app.js';

let timer = null;
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function loadData() { return Promise.all([api.jobs(), api.jobsStats()]).then(([jobs, stats]) => ({ jobs, stats })); }

// 队列页与后台任务真正联动：只要有排队/运行中的任务就每 2.5s 静默刷新，不再靠手动点。
function armTimer(data) {
  const busy = data.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  if (busy && !timer) { timer = setInterval(paintQuietly, 2500); if (timer.unref) timer.unref(); }
  else if (!busy) stopTimer();
}
async function paintQuietly() {
  // 离开本页时停止，避免定时器覆盖别的视图。
  if (!window.location.hash.startsWith('#/jobs')) { stopTimer(); return; }
  let data;
  try { data = await loadData(); } catch { stopTimer(); return; }
  const view = document.getElementById('view');
  if (view) view.replaceChildren(buildQueue(data));
  armTimer(data);
}

function runningElapsed(job) {
  if (!job.started_at) return null;
  const ms = Math.max(0, Date.now() - new Date(job.started_at).getTime());
  const cap = job.timeout_ms ? ` · 上限 ${fmt.duration(job.timeout_ms)}` : '';
  return `已运行 ${fmt.duration(ms)}${cap}`;
}

function buildQueue({ jobs, stats }) {
  return h('div', { class: 'stack' }, [
    h('div', { class: 'grid grid-4' }, [
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: '任务总数' }), h('div', { class: 'value', text: String(stats.total) })]),
      h('div', { class: 'metric' }, [h('div', { class: 'label', text: '运行中' }), h('div', { class: 'value', text: `${stats.running}/${stats.concurrency}` })]),
      h('div', { class: 'metric ok' }, [h('div', { class: 'label', text: '已完成' }), h('div', { class: 'value', text: String(stats.byStatus.completed || 0) })]),
      h('div', { class: 'metric alert' }, [h('div', { class: 'label', text: '失败' }), h('div', { class: 'value', text: String(stats.byStatus.failed || 0) })]),
    ]),
    card('任务', jobs.length ? table([
      { label: '类型', key: 'type' },
      { label: '状态', render: (r) => h('div', { class: 'stack-sm' }, [statusBadge(r.status), r.status === 'running' && runningElapsed(r) ? h('span', { class: 'small muted', text: runningElapsed(r) }) : null]) },
      { label: '项目', render: (r) => (r.project_id ? h('a', { href: `#/projects/${r.project_id}`, text: r.project_id.slice(0, 12) }) : '—') },
      { label: '尝试', render: (r) => `${r.attempts}/${r.max_attempts}`, num: true },
      { label: '创建于', render: (r) => fmt.rel(r.created_at) },
      { label: '结束于', render: (r) => (r.finished_at ? fmt.rel(r.finished_at) : '—') },
      { label: '错误', render: (r) => (r.error ? h('span', { class: 'small', title: r.error, text: fmt.truncate(r.error, 70) }) : '—') },
      { label: '', render: (r) => (r.status === 'queued' || r.status === 'running'
        ? h('button', { class: 'btn btn-sm', text: '取消', onClick: async () => {
          try { await api.cancelJob(r.id); toast('已取消', 'ok'); }
          catch (err) { toast(err.message, 'error'); }
          paintQuietly();
        } })
        : null) },
    ], jobs, { empty: '暂无任务。' }) : stateEmpty('队列为空', '在项目中运行一次扫描即可创建任务。')),
    h('div', { class: 'small muted', text: '有任务在排队或运行时，本页每 2.5 秒自动刷新；重试次数、超时与取消都以队列记录为准。' }),
  ]);
}

export async function render(mode = 'jobs') {
  if (mode === 'events') { stopTimer(); return renderEvents(); }
  stopTimer();
  setTopbar('分析队列', '有界并发、超时、重试与取消——绝无失控的后台任务；运行中会自动刷新。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render('jobs') }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, loadData, (data) => { armTimer(data); return buildQueue(data); }, { loadingLabel: '正在加载队列…' });
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
    ]))) : stateEmpty('还没有记录任何事件')), { loadingLabel: '正在加载事件…' });
}

