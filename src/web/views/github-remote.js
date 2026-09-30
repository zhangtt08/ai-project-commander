/**
 * GitHub 仓库（只读）— browse the repositories on the account without downloading anything.
 *
 * Every fact on this page comes from a GitHub REST call made by the server; no clone, no fetch,
 * no write to disk. The token never reaches the browser.
 */
import { api } from '../api.js';
import { h, card, metric, table, stateEmpty, fmt, toast } from '../ui.js';
import { setTopbar } from '../app.js';

const COLUMNS = [
  { label: '仓库', render: (r) => h('div', {}, [h('a', { href: r.htmlUrl, target: '_blank', rel: 'noreferrer', text: r.name }), h('div', { class: 'path', text: r.fullName })]) },
  { label: '可见性', render: (r) => h('span', { class: `badge ${r.private ? 'badge-neutral' : 'badge-unknown'}`, text: r.visibility }) },
  { label: '主要语言', render: (r) => h('span', { class: 'chip', text: r.language || '未标注' }) },
  { label: '体积', num: true, render: (r) => `${Math.round(r.sizeKb / 1024 * 10) / 10} MB` },
  { label: '最近推送', render: (r) => h('span', { class: 'small muted', text: r.pushedAt ? fmt.rel(r.pushedAt) : '从未推送' }) },
  { label: '描述', render: (r) => h('div', { class: 'small', text: fmt.truncate(r.description || '（无描述）', 90) }) },
];

function detailPanel(data, onClose) {
  const r = data.repo;
  return h('div', { class: 'stack' }, [
    h('div', { class: 'row-between' }, [
      h('div', { class: 'row wrap' }, [
        h('h2', { style: { fontSize: '14px', margin: '0' }, text: r.fullName }),
        h('span', { class: `badge ${r.private ? 'badge-neutral' : 'badge-unknown'}`, text: r.visibility }),
        r.archived ? h('span', { class: 'badge badge-warning', text: '已归档' }) : null,
        r.fork ? h('span', { class: 'chip', text: 'fork' }) : null,
      ]),
      h('button', { class: 'btn btn-sm', text: '关闭', onClick: onClose }),
    ]),
    h('div', { class: 'grid grid-4' }, [
      metric('默认分支', r.defaultBranch || '—', { sm: true }),
      metric('体积', `${Math.round(r.sizeKb / 1024 * 10) / 10} MB`, { sm: true }),
      metric('创建', r.createdAt ? fmt.date(r.createdAt).slice(0, 10) : '—', { sm: true }),
      metric('许可证', r.license || '—', { sm: true }),
    ]),
    card('语言构成（GitHub 统计）', data.languages.length
      ? h('div', { class: 'stack-sm' }, data.languages.map((l) => h('div', { class: 'row wrap' }, [
        h('span', { class: 'chip', text: l.language }),
        h('span', { class: 'small muted', text: `${l.percent}% · ${fmt.num(Math.round(l.bytes / 1024))} KB` }),
      ])))
      : h('div', { class: 'small muted', text: data.partial.languages ? 'GitHub 没有返回语言统计。' : '语言统计本次未取到。' })),
    card(`根目录（${data.tree.entries.length} 项${data.tree.truncated ? '，已截断' : ''}）`, data.tree.entries.length
      ? h('div', { class: 'tag-list' }, data.tree.entries.map((e) => h('span', { class: 'chip', title: `${e.type} · ${e.size} B`, text: e.type === 'dir' ? `${e.name}/` : e.name })))
      : h('div', { class: 'small muted', text: '没有取到文件列表。' }), { hint: '仅列目录，内容不下载' }),
    card('README', data.readme.available
      ? h('pre', { class: 'code', text: data.readme.text })
      : h('div', { class: 'small muted', text: data.readme.note || '这个仓库没有 README。' }), { hint: '服务端读取，最多显示 20 KB' }),
  ]);
}

export async function render() {
  setTopbar('GitHub 仓库', '只读浏览你账号下的仓库 —— 不克隆、不下载、不写入本地。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
  ]);
  const view = document.getElementById('view');
  const search = h('input', { class: 'input', placeholder: '按名称、描述或语言筛选', 'aria-label': '筛选仓库', style: { minWidth: '260px' } });
  const list = h('div', { class: 'stack-sm' });
  const detail = h('div', { class: 'stack' });

  let timer = null;
  const openDetail = async (repo) => {
    detail.replaceChildren(stateEmpty('正在读取仓库详情…', repo.fullName));
    try {
      const d = await api.remoteRepo(repo.fullName);
      if (!d.ok) { detail.replaceChildren(h('div', { class: 'danger-note', text: d.reason || '读取失败' })); return; }
      detail.replaceChildren(detailPanel(d, () => detail.replaceChildren()));
    } catch (err) {
      detail.replaceChildren(h('div', { class: 'danger-note', text: `读取失败：${err.message}` }));
    }
  };
  const load = async () => {
    list.replaceChildren(stateEmpty('正在读取 GitHub 仓库列表…', 'GitHub 响应通常需要 1–3 秒。'));
    try {
      const data = await api.remoteRepos(search.value.trim());
      if (!data.ok) {
        list.replaceChildren(h('div', { class: 'danger-note', text: data.reason || '读取失败' }));
        if (!data.tokenPresent) {
          list.appendChild(h('div', { class: 'row' }, [h('a', { class: 'small', href: '#/settings', text: '设置 → GitHub 私有仓库自动上传' })]));
        }
        return;
      }
      list.replaceChildren(
        h('div', { class: 'grid grid-4' }, [
          metric('仓库数', fmt.num(data.repos.length), { foot: `共取到 ${data.total} 个` }),
          metric('私有', fmt.num(data.privateCount), { cls: 'ok' }),
          metric('筛选', search.value.trim() || '无', { sm: true }),
          metric('读取时间', fmt.rel(data.fetchedAt), { sm: true }),
        ]),
        data.repos.length
          ? table([...COLUMNS, { label: '', render: (r) => h('button', { class: 'btn btn-sm', text: '只读查看', onClick: () => openDetail(r) }) }], data.repos, { empty: '没有仓库。' })
          : stateEmpty('没有匹配的仓库', '换个关键词，或到设置里确认令牌属于哪个账号。'),
        data.truncated ? h('div', { class: 'small muted', text: '仓库数量超过上限，只显示了前 200 个。' }) : null,
      );
    } catch (err) {
      list.replaceChildren(h('div', { class: 'danger-note', text: `读取失败：${err.message}` }));
      toast('GitHub 仓库列表读取失败', 'error');
    }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });

  view.replaceChildren(h('div', { class: 'stack' }, [
    h('div', { class: 'row wrap' }, [search]),
    list,
    detail,
  ]));
  await load();
}
