import { api } from '../api.js';
import { h, card, table, mountAsync, healthBadge, statusBadge, gateBadge, toast, modal, projectStatusLabel } from '../ui.js';
import { setTopbar, refreshShellData, state } from '../app.js';
import { Router } from '../router.js';
import { renderImportPanel } from './dropzone.js';
import { openImportDialog } from './import.js';

export async function render() {
  setTopbar('项目', '注册本地工作区——分析过程只读，删除需要你明确确认。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: '+ 添加项目', onClick: () => openImportDialog(() => render()) }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, () => api.projects(), (cards) => {
    if (!cards.length) {
      return h('div', { class: 'stack' }, [
        renderImportPanel({}),
        card('添加项目后会发生什么？', h('ol', { class: 'stack-sm small' }, [
          h('li', { text: '扫描目录：结构、技术栈、规范文档、TODO 标记。' }),
          h('li', { text: '自动识别项目分类与用途，并给出可优化的建议。' }),
          h('li', { text: '敏感文件（.env、*.key、credentials…）只被识别，内容绝不会被读取。' }),
          h('li', { text: 'Git 状态、构建与测试命令被自动识别，并在严格安全规则下执行。' }),
          h('li', { text: '生成快照、健康结论、风险清单与下一步行动。' }),
        ])),
      ]);
    }
    const sections = h('div', { class: 'stack' });
    const paint = () => sections.replaceChildren(...sectionsFor(filtered(cards)));
    const bar = filterBar(cards, paint);
    paint();
    return h('div', { class: 'stack' }, [
      renderImportPanel({ compact: true }),
      bar,
      sections,
    ]);
  }, { loadingLabel: '正在加载项目…' });
}

function catLabel(key) {
  const cats = (state.meta && state.meta.categories) || [];
  const hit = cats.find((c) => c.key === key);
  return hit ? hit.label : key;
}

/** 项目整理：按分类筛选与分组。 */
const filter = { category: 'all', q: '' };

function filtered(cards) {
  const q = filter.q.trim().toLowerCase();
  return cards.filter((c) => {
    if (filter.category !== 'all' && (c.category || 'uncategorized') !== filter.category) return false;
    if (!q) return true;
    return [c.name, c.workspacePath, c.categoryLabel, c.description, c.primaryLanguage]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });
}

function filterBar(cards, onChange) {
  const counts = new Map();
  for (const c of cards) {
    const key = c.category || 'uncategorized';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const pairs = [];
  const mkChip = (key, label) => {
    const el = h('button', {
      class: 'chip chip-btn',
      text: label,
      onClick: () => { filter.category = key; sync(); onChange(); },
    });
    pairs.push([key, el]);
    return el;
  };
  const sync = () => {
    for (const [key, el] of pairs) el.classList.toggle('chip-on', key === filter.category);
  };
  const search = h('input', {
    class: 'input input-sm', type: 'search', placeholder: '按名称、路径或技术栈筛选…',
    'aria-label': '筛选项目', value: filter.q,
    // Only the result sections repaint — replacing this input would steal focus mid-typing.
    onInput: (e) => { filter.q = e.target.value; onChange(); },
  });
  sync();
  return h('div', { class: 'stack-sm' }, [
    h('div', { class: 'row wrap' }, [
      mkChip('all', `全部 ${cards.length}`),
      ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => mkChip(k, `${catLabel(k)} ${n}`)),
    ]),
    search,
  ]);
}

function sectionsFor(cards) {
  if (filter.category !== 'all') return [projectTable(cards)];
  const groups = new Map();
  for (const c of cards) {
    const key = c.category || 'uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  if (groups.size <= 1) return [projectTable(cards)];
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, rows]) => h('div', { class: 'stack-sm' }, [
      h('div', { class: 'group-head' }, [
        h('strong', { text: catLabel(key) }),
        h('span', { class: 'muted small', text: `${rows.length} 个` }),
      ]),
      projectTable(rows),
    ]));
}

function projectTable(cards) {
  return table([
    { label: '项目', render: (r) => h('div', {}, [h('a', { href: `#/projects/${r.id}`, text: r.name }), r.isDemo ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: '演示' }) : null, h('div', { class: 'path', text: r.workspacePath })]) },
    { label: '分类', render: (r) => h('span', { class: 'chip', title: r.categoryManual ? '手动指定' : '自动识别', text: r.categoryLabel || '未分类' }) },
    { label: '健康', render: (r) => healthBadge(r.health) },
    { label: '状态', render: (r) => h('span', { class: 'chip', text: projectStatusLabel(r.status) }) },
    { label: '阶段', render: (r) => r.currentStage || '—' },
    { label: '进度', render: (r) => (r.progress && r.progress.percent !== null ? `${r.progress.percent}%` : '未知'), num: true },
    { label: '构建', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },
    { label: '测试', render: (r) => h('span', { class: 'small mono', text: [r.unit ? `u ${r.unit.passed}/${r.unit.total}` : null, r.e2e ? `e2e ${r.e2e.passed}/${r.e2e.total}` : null].filter(Boolean).join(' · ') || '—' }) },
    { label: '验收门', render: (r) => gateBadge(r.gate) },
    { label: '建议', render: (r) => (r.suggestionCount ? h('a', { class: 'badge badge-unknown', href: `#/projects/${r.id}/suggestions`, title: r.suggestionSummary && r.suggestionSummary.top[0] ? r.suggestionSummary.top[0] : '', text: `${r.suggestionCount} 条` }) : '—') },
    { label: '技术栈', render: (r) => h('span', { class: 'small', text: `${r.primaryLanguage || '?'} / ${r.framework === 'unknown' ? '—' : r.framework || '?'}` }) },
    { label: '操作', render: (r) => h('div', { class: 'row' }, [
      h('button', { class: 'btn btn-sm', text: '扫描', onClick: (e) => { e.stopPropagation(); scan(r.id); } }),
      h('button', { class: 'btn btn-sm', text: '整理', onClick: (e) => { e.stopPropagation(); openProjectSettings(r); } }),
    ]) },
  ], cards, { empty: filter.q || filter.category !== 'all' ? '没有符合筛选条件的项目。' : '暂无项目。' });
}
async function scan(projectId) {
  try {
    toast('全量扫描已入队——正在执行构建与测试…', 'info', 6000);
    await api.scan(projectId, { mode: 'full', runCommands: true, suites: ['unit', 'e2e'] });
    toast('扫描已入队，可在“分析队列”查看进度。', 'ok');
    setTimeout(() => { refreshShellData(); }, 1500);
  } catch (err) {
    toast(`扫描入队失败：${err.message}`, 'error');
  }
}

export function openAddDialog() {
  const pathInput = h('input', { class: 'input', id: 'add-path', placeholder: 'C:\\path\\to\\your\\project', 'aria-label': 'Workspace path' });
  const nameInput = h('input', { class: 'input', id: 'add-name', placeholder: '显示名称（可选）', 'aria-label': 'Display name' });
  const descInput = h('textarea', { class: 'textarea', id: 'add-desc', rows: '3', placeholder: '这个项目是做什么的（可选）', 'aria-label': 'Description' });
  const ignoreInput = h('input', { class: 'input', id: 'add-ignore', placeholder: '额外忽略规则，以逗号分隔', 'aria-label': 'Ignore patterns' });
  const errBox = h('div', { class: 'hidden' });

  const submit = async () => {
    errBox.className = 'hidden';
    try {
      const ignorePatterns = ignoreInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      const project = await api.addProject({
        workspacePath: pathInput.value.trim(),
        name: nameInput.value.trim() || undefined,
        description: descInput.value.trim(),
        ignorePatterns,
      });
      state.scanPending.add(project.id);
      toast(`已添加 ${project.name}，正在执行首次全量扫描…`, 'ok');
      dlg.close();
      await refreshShellData();
      Router.go(`/projects/${project.id}`);
      api.scan(project.id, { mode: 'full', runCommands: true, suites: ['unit', 'e2e'] })
        .then(() => toast('首次扫描已入队。', 'info'))
        .catch((e) => toast(`扫描入队失败：${e.message}`, 'error'));
    } catch (err) {
      errBox.className = 'state error';
      errBox.textContent = `${err.message}${err.hint ? ` — ${err.hint}` : ''}`;
    }
  };

  const dlg = modal('添加本地工作区', h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '工作区路径（绝对路径）' }), pathInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '显示名称' }), nameInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '描述' }), descInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '额外忽略规则' }), ignoreInput]),
    h('div', { class: 'small muted', text: 'Commander 绝不写入该目录；敏感文件会被识别，但内容从不读取。' }),
    errBox,
    h('div', { class: 'row' }, [
      h('button', { class: 'btn btn-primary', text: '添加并扫描', onClick: submit }),
      h('button', { class: 'btn', text: '取消', onClick: () => dlg.close() }),
    ]),
  ]));
  pathInput.focus();
}

export async function openProjectSettings(cardData) {
  const nameInput = h('input', { class: 'input', value: cardData.name, 'aria-label': 'Display name' });
  const descInput = h('textarea', { class: 'textarea', rows: '3', value: cardData.description || '', 'aria-label': 'Description' });
  const cats = (state.meta && state.meta.categories) || [];
  const catSelect = h('select', { class: 'input', 'aria-label': '项目分类' }, [
    h('option', { value: 'auto', text: '自动识别（当前：' + (cardData.categoryLabel || '未分类') + '）', selected: !cardData.categoryManual }),
    ...cats.map((c) => h('option', {
      value: c.key, text: c.label, selected: c.key === cardData.category && !!cardData.categoryManual,
    })),
  ]);
  const confirmInput = h('input', { class: 'input', placeholder: '输入 DELETE 以确认', 'aria-label': '删除确认' });
  const status = h('div', { class: 'small muted' });
  let purgeSource = false;
  let assessment = null;

  const assessBox = h('div', { class: 'small muted' });
  const purgeWarning = h('div', { class: 'danger-note', text: '勾选后将永久删除该目录及其全部文件，无法恢复。请确认你另有备份。' });
  purgeWarning.style.display = 'none';
  const loadAssessment = async () => {
    assessBox.textContent = '正在检查源目录…';
    try {
      assessment = await api.deletionAssessment(cardData.id);
      assessBox.textContent = assessment.ok
        ? `源目录：${assessment.display} · ${assessment.fileCount} 个文件 · ${assessment.humanSize}${assessment.truncatedStats ? '（统计已达上限）' : ''}`
        : `源目录不可删除：${assessment.reason}`;
    } catch (err) {
      assessment = null;
      assessBox.textContent = `无法评估源目录：${err.message}`;
    }
  };

  const dlg = modal(`项目整理 — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '显示名称' }), nameInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '描述' }), descInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '项目分类' }), catSelect]),
    h('div', { class: 'row wrap' }, [
      h('button', {
        class: 'btn btn-primary',
        text: '保存',
        onClick: async () => {
          try {
            await api.updateProject(cardData.id, {
              name: nameInput.value.trim(),
              description: descInput.value.trim(),
              category: catSelect.value,
            });
            toast('项目已更新', 'ok');
            dlg.close();
            await refreshShellData();
            render();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', {
        class: 'btn',
        text: cardData.watchPaused ? '恢复监控' : '暂停监控',
        onClick: async () => {
          try {
            if (cardData.watchPaused) await api.resumeWatch(cardData.id); else await api.pauseWatch(cardData.id);
            toast('监控状态已更新', 'ok');
            dlg.close();
            render();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', {
        class: 'btn',
        text: '归档',
        onClick: async () => {
          try { await api.archiveProject(cardData.id); toast('已归档', 'ok'); dlg.close(); await refreshShellData(); render(); } catch (err) { toast(err.message, 'error'); }
        },
      }),
    ]),
    h('hr', { class: 'hr' }),
    h('div', { class: 'stack-sm' }, [
      h('strong', { class: 'small', text: '删除项目' }),
      h('label', { class: 'row small', style: { alignItems: 'center', gap: '7px' } }, [
        h('input', {
          type: 'checkbox',
          class: 'chk',
          onChange: (e) => {
            purgeSource = e.target.checked;
            purgeWarning.style.display = purgeSource ? '' : 'none';
            if (purgeSource && !assessment) loadAssessment();
          },
        }),
        h('span', { text: '同时删除电脑上的项目源文件（不可恢复）' }),
      ]),
      assessBox,
      h('div', { class: 'small muted', text: '不勾选时只删除 Commander 的记录，源码目录保持不变。' }),
      purgeWarning,
      confirmInput,
      h('button', {
        class: 'btn btn-danger',
        text: '删除',
        onClick: async () => {
          const typed = confirmInput.value.trim();
          if (!purgeSource && typed !== 'DELETE') { status.textContent = '请输入 DELETE 以确认。'; return; }
          if (purgeSource && typed !== cardData.name) {
            status.textContent = `彻底删除需要输入项目名「${cardData.name}」以确认。`;
            return;
          }
          try {
            const res = purgeSource
              ? await api.deleteProjectWithSource(cardData.id, cardData.name)
              : await api.deleteProject(cardData.id);
            if (purgeSource) {
              toast(`已删除记录并清除源文件：${res.sourcePurged.path}（${res.sourcePurged.fileCount} 个文件）`, 'ok', 9000);
            } else {
              toast(`记录已删除，源码目录未动：${res.sourceDirectoryUntouched}`, 'ok', 8000);
            }
            dlg.close();
            await refreshShellData();
            Router.go('/projects');
          } catch (err) { status.textContent = `删除失败：${err.message}`; }
        },
      }),
    ]),
    status,
  ]));
}

