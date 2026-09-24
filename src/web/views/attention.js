import { api } from '../api.js';
import { h, card, mountAsync, stateEmpty, fmt, toast } from '../ui.js';
import { setTopbar } from '../app.js';
import { Router } from '../router.js';

const KIND_LABEL = {
  critical_health: '健康危急',
  build_fail: '构建失败',
  test_fail: '测试失败',
  regression: '回归',
  blocked_task: '任务阻塞',
  dirty_workspace: '工作区脏乱',
  risk: 'Risk',
  drift: '规范漂移',
  pending_review: '待复核',
};

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];
const SEV_ZH = { critical: '危急', high: '高', medium: '中', low: '低' };

export async function render() {
  setTopbar('关注中心', '所有项目中应当优先处理的事项，按严重程度排序。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
  ]);
  const view = document.getElementById('view');

  await mountAsync(view, () => api.attention(), (data) => {
    if (!data.items.length) {
      return stateEmpty('暂无需关注的事项', '没有发现危急、阻塞、失败、漂移或回归的项目。');
    }
    const groups = SEV_ORDER.map((sev) => ({ sev, items: data.items.filter((i) => i.severity === sev) })).filter((g) => g.items.length);
    return h('div', { class: 'stack' }, groups.map((g) => card(
      `${SEV_ZH[g.sev] || g.sev}（${g.items.length}）`,
      h('div', { class: 'stack-sm' }, g.items.map((i) => h('div', { class: `risk-item sev-${i.severity}` }, [
        h('div', { class: 'row-between wrap' }, [
          h('div', { class: 'row wrap' }, [
            h('span', { class: 'chip', text: KIND_LABEL[i.kind] || i.kind }),
            h('strong', { class: 'small', text: i.title }),
          ]),
          h('button', {
            class: 'btn btn-sm',
            text: '打开项目',
            onClick: () => Router.go(`/projects/${i.projectId}`),
          }),
        ]),
        i.detail ? h('div', { class: 'small muted', text: fmt.truncate(i.detail, 260) }) : null,
      ]))),
      { hint: `${g.items.length} 条` },
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
