import { api } from '../api.js';
import { h, card, mountAsync, stateEmpty, fmt, toast } from '../ui.js';
import { setTopbar } from '../app.js';
import { Router } from '../router.js';

const KIND_LABEL = {
  critical_health: 'Critical health',
  build_fail: 'Build failure',
  test_fail: 'Test failure',
  regression: 'Regression',
  blocked_task: 'Blocked task',
  dirty_workspace: 'Dirty workspace',
  risk: 'Risk',
  drift: 'Specification drift',
  pending_review: 'Pending review',
};

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];

export async function render() {
  setTopbar('Attention Center', 'Everything that should be looked at first, across all projects.', [
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),
  ]);
  const view = document.getElementById('view');

  await mountAsync(view, () => api.attention(), (data) => {
    if (!data.items.length) {
      return stateEmpty('Nothing needs attention', 'No critical, blocked, failing, drifted or regressed projects were found.');
    }
    const groups = SEV_ORDER.map((sev) => ({ sev, items: data.items.filter((i) => i.severity === sev) })).filter((g) => g.items.length);
    return h('div', { class: 'stack' }, groups.map((g) => card(
      `${g.sev.toUpperCase()} (${g.items.length})`,
      h('div', { class: 'stack-sm' }, g.items.map((i) => h('div', { class: `risk-item sev-${i.severity}` }, [
        h('div', { class: 'row-between wrap' }, [
          h('div', { class: 'row wrap' }, [
            h('span', { class: 'chip', text: KIND_LABEL[i.kind] || i.kind }),
            h('strong', { class: 'small', text: i.title }),
          ]),
          h('button', {
            class: 'btn btn-sm',
            text: 'Open',
            onClick: () => Router.go(`/projects/${i.projectId}`),
          }),
        ]),
        i.detail ? h('div', { class: 'small muted', text: fmt.truncate(i.detail, 260) }) : null,
      ]))),
      { hint: `${g.items.length} item(s)` },
    )));
  }, { loadingLabel: 'Collecting attention items…' });
}

export function attentionBadgeFor(projectId, attention) {
  const items = ((attention && attention.items) || []).filter((i) => i.projectId === projectId);
  if (!items.length) return null;
  const worst = items[0].severity;
  return h('span', { class: `badge badge-${worst === 'critical' ? 'critical' : worst === 'high' ? 'warning' : 'unknown'}`, text: `${items.length} attention` });
}

export function notifyAttention(count) {
  if (count > 0) toast(`${count} item(s) need attention`, 'info', 3000);
}
