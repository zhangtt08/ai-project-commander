import { api } from '../api.js';
import { h, card, mountAsync, stateEmpty } from '../ui.js';
import { setTopbar } from '../app.js';
import { Router } from '../router.js';

export async function render(query = {}) {
  const input = h('input', {
    class: 'input',
    value: query.q || '',
    placeholder: '搜索项目、任务、提示词、风险、决策…（任意界面按 /）',
    'aria-label': 'Search query',
  });
  const submit = () => Router.go(`/search?q=${encodeURIComponent(input.value.trim())}`);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  setTopbar('搜索', '跨所有受管项目的全文检索。优先 FTS5，不可用时回退子串匹配。', [
    h('button', { class: 'btn btn-primary', text: '搜索', onClick: submit }),
  ]);
  const view = document.getElementById('view');
  const q = (query.q || '').trim();

  const head = card('查询', h('div', { class: 'row' }, [input, h('button', { class: 'btn', text: '搜索', onClick: submit })]));

  if (!q) {
    view.replaceChildren(h('div', { class: 'stack' }, [head, stateEmpty('输入关键词开始搜索', '例如："checkout"、"e2e"、"阻塞"。')]));
    input.focus();
    return;
  }

  await mountAsync(view, () => api.search(q), (data) => h('div', { class: 'stack' }, [
    head,
    card(`“${q}” 的搜索结果`, data.results.length
      ? h('div', { class: 'stack-sm' }, data.results.map((r) => h('div', { class: 'risk-item sev-info' }, [
        h('div', { class: 'row-between wrap' }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'chip', text: r.table }),
            h('strong', { class: 'small', text: r.title || r.id }),
          ]),
          r.projectId ? h('a', { class: 'small', href: `#/projects/${r.projectId}`, text: '打开项目 →' }) : null,
        ]),
        r.snippet ? h('div', { class: 'small muted', text: r.snippet }) : null,
      ])))
      : stateEmpty('没有匹配结果', '试试更短或更宽泛的关键词。'), {
      hint: data.fts ? 'FTS5 全文索引' : '子串回退',
      actions: [h('a', { class: 'small', href: '#/projects', text: '全部项目 →' })],
    }),
  ]), { loadingLabel: '正在搜索…' });
}

