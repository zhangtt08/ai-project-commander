import { api } from '../api.js';
import { h, card, table, mountAsync, stateEmpty, healthBadge, statusBadge, gateBadge, toast, modal } from '../ui.js';
import { setTopbar, refreshShellData } from '../app.js';
import { Router } from '../router.js';
import { renderImportPanel } from './dropzone.js';

export async function render() {
  setTopbar('项目', '注册本地工作区——Commander 对它们只读。', [
    h('button', { class: 'btn', text: '生成演示项目', onClick: seedDemo }),
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: '添加项目', onClick: () => openAddDialog() }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, () => api.projects(), (cards) => {
    if (!cards.length) {
      return h('div', { class: 'stack' }, [
        renderImportPanel({}),
        card('添加项目后会发生什么？', h('ol', { class: 'stack-sm small' }, [
          h('li', { text: '扫描目录：结构、技术栈、规范文档、TODO 标记。' }),
          h('li', { text: '敏感文件（.env、*.key、credentials…）只被识别，内容绝不会被读取。' }),
          h('li', { text: 'Git 状态、构建与测试命令被自动识别，并在严格安全规则下执行。' }),
          h('li', { text: '生成快照、健康结论、风险清单与下一步行动。' }),
        ])),
      ]);
    }
    return h('div', { class: 'stack' }, [
      renderImportPanel({ compact: true }),
      table([
      { label: '项目', render: (r) => h('div', {}, [h('a', { href: `#/projects/${r.id}`, text: r.name }), r.isDemo ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: '演示' }) : null, h('div', { class: 'path', text: r.workspacePath })]) },
      { label: '健康', render: (r) => healthBadge(r.health) },
      { label: '状态', render: (r) => h('span', { class: 'chip', text: r.status }) },
      { label: '阶段', render: (r) => r.currentStage || '—' },
      { label: '进度', render: (r) => (r.progress && r.progress.percent !== null ? `${r.progress.percent}%` : '未知'), num: true },
      { label: '构建', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },
      { label: 'Tests', render: (r) => h('span', { class: 'small mono', text: [r.unit ? `u ${r.unit.passed}/${r.unit.total}` : null, r.e2e ? `e2e ${r.e2e.passed}/${r.e2e.total}` : null].filter(Boolean).join(' · ') || '—' }) },
      { label: '验收门', render: (r) => gateBadge(r.gate) },
      { label: '技术栈', render: (r) => h('span', { class: 'small', text: `${r.primaryLanguage || '?'} / ${r.framework === 'unknown' ? '—' : r.framework || '?'}` }) },
      { label: '操作', render: (r) => h('div', { class: 'row' }, [
        h('button', { class: 'btn btn-sm', text: '扫描', onClick: (e) => { e.stopPropagation(); scan(r.id); } }),
        h('button', { class: 'btn btn-sm', text: '设置', onClick: (e) => { e.stopPropagation(); openProjectSettings(r); } }),
      ]) },
    ], cards, { empty: '暂无项目。' }),
    ]);
  }, { loadingLabel: 'Loading projects…' });
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

async function seedDemo() {
  try {
    toast('正在生成演示项目——真实执行构建与测试…', 'info', 10000);
    const results = await api.seedDemo({ runCommands: true });
    await refreshShellData();
    toast(`已生成 ${results.filter((r) => !r.skipped).length} 个演示项目`, 'ok');
    render();
  } catch (err) {
    toast(`生成失败：${err.message}`, 'error');
  }
}

export function openAddDialog() {
  const pathInput = h('input', { class: 'input', id: 'add-path', placeholder: 'C:\\path\\to\\your\\project', 'aria-label': 'Workspace path' });
  const nameInput = h('input', { class: 'input', id: 'add-name', placeholder: '(optional) display name', 'aria-label': 'Display name' });
  const descInput = h('textarea', { class: 'textarea', id: 'add-desc', rows: '3', placeholder: '(optional) what this project is', 'aria-label': 'Description' });
  const ignoreInput = h('input', { class: 'input', id: 'add-ignore', placeholder: 'extra ignore patterns, comma separated', 'aria-label': 'Ignore patterns' });
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
      toast(`Added ${project.name}. Running the first full scan…`, 'ok');
      dlg.close();
      await refreshShellData();
      Router.go(`/projects/${project.id}`);
      api.scan(project.id, { mode: 'full', runCommands: true, suites: ['unit', 'e2e'] })
        .then(() => toast('First scan queued.', 'info'))
        .catch((e) => toast(`Scan queue failed: ${e.message}`, 'error'));
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
  const confirmInput = h('input', { class: 'input', placeholder: '输入 DELETE 以确认', 'aria-label': '删除确认' });
  const status = h('div', { class: 'small muted' });

  const dlg = modal(`项目设置 — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '显示名称' }), nameInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '描述' }), descInput]),
    h('div', { class: 'row wrap' }, [
      h('button', {
        class: 'btn btn-primary',
        text: '保存',
        onClick: async () => {
          try {
            await api.updateProject(cardData.id, { name: nameInput.value.trim(), description: descInput.value.trim() });
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
      h('strong', { class: 'small', text: '删除 Commander 记录' }),
      h('div', { class: 'small muted', text: `仅删除 Commander 自己的数据库记录；源码目录 ${cardData.workspacePath} 绝不会被修改或删除。` }),
      confirmInput,
      h('button', {
        class: 'btn btn-danger',
        text: '删除记录',
        onClick: async () => {
          if (confirmInput.value.trim() !== 'DELETE') { status.textContent = '请输入 DELETE 以确认。'; return; }
          try {
            const res = await api.deleteProject(cardData.id);
            toast(`记录已删除，源码目录未动：${res.sourceDirectoryUntouched}`, 'ok', 8000);
            dlg.close();
            await refreshShellData();
            Router.go('/projects');
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
    ]),
    status,
  ]));
}

