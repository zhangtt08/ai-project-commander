import { api } from '../api.js';
import { h, card, mountAsync, stateEmpty } from '../ui.js';
import { setTopbar } from '../app.js';
import { Router } from '../router.js';

export async function render(query = {}) {
  const input = h('input', {
    class: 'input',
    value: query.q || '',
    placeholder: 'Search projects, tasks, prompts, risks, decisions…  (press / anywhere)',
    'aria-label': 'Search query',
  });
  const submit = () => Router.go(`/search?q=${encodeURIComponent(input.value.trim())}`);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  setTopbar('Search', 'Full-text across every managed project. FTS5 when available, substring fallback otherwise.', [
    h('button', { class: 'btn btn-primary', text: 'Search', onClick: submit }),
  ]);
  const view = document.getElementById('view');
  const q = (query.q || '').trim();

  const head = card('Query', h('div', { class: 'row' }, [input, h('button', { class: 'btn', text: 'Go', onClick: submit })]));

  if (!q) {
    view.replaceChildren(h('div', { class: 'stack' }, [head, stateEmpty('Type a query to search', 'Examples: "checkout", "e2e", "blocked", "auth".')]));
    input.focus();
    return;
  }

  await mountAsync(view, () => api.search(q), (data) => h('div', { class: 'stack' }, [
    head,
    card(`Results for “${q}”`, data.results.length
      ? h('div', { class: 'stack-sm' }, data.results.map((r) => h('div', { class: 'risk-item sev-info' }, [
        h('div', { class: 'row-between wrap' }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'chip', text: r.table }),
            h('strong', { class: 'small', text: r.title || r.id }),
          ]),
          r.projectId ? h('a', { class: 'small', href: `#/projects/${r.projectId}`, text: 'Open project →' }) : null,
        ]),
        r.snippet ? h('div', { class: 'small muted', text: r.snippet }) : null,
      ])))
      : stateEmpty('No matches', 'Try a shorter or broader term.'), {
      hint: data.fts ? 'FTS5 index' : 'substring fallback',
      actions: [h('a', { class: 'small', href: '#/projects', text: 'All projects →' })],
    }),
  ]), { loadingLabel: 'Searching…' });
}

