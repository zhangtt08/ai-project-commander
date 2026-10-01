/**
 * Dropzone import module — drag a project folder in from Explorer, Commander
 * recognises it and offers the resolved local paths as one-click candidates.
 *
 * Browser security means a dropped folder never carries its absolute path, so the
 * name + top-level entries are sent to the server, which searches the configured
 * roots (see workspace-resolver.js) and recognises each candidate with the real
 * ProjectScanner. Honest about the mechanism right in the UI copy.
 */
import { api } from '../api.js';
import { h, clear, fmt, toast, modal } from '../ui.js';
import { state } from '../app.js';
import { Router } from '../router.js';

function folderNameFromEntries(items) {
  // Prefer the first directory entry the browser exposes for the drop.
  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) return { name: entry.name, isDirectory: true };
  }
  return { name: '', isDirectory: false };
}

function folderNameFromFiles(files) {
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const first = rel.split('/')[0];
    if (first) return first;
  }
  return '';
}

function candidateCard(c, onAdd) {
  const badges = [];
  if (c.recognised) {
    if (c.language) badges.push(h('span', { class: 'badge badge-info', text: c.language }));
    if (c.framework && c.framework !== 'unknown') badges.push(h('span', { class: 'badge badge-accent', text: c.framework }));
    for (const fw of (c.frameworks || []).slice(1, 3)) badges.push(h('span', { class: 'badge badge-neutral', text: fw }));
    if (c.packageManager && c.packageManager !== 'unknown') badges.push(h('span', { class: 'badge badge-neutral', text: c.packageManager }));
    if (c.isGit) badges.push(h('span', { class: 'badge badge-neutral', text: 'git' }));
    if (c.hasSpec) badges.push(h('span', { class: 'badge badge-neutral', text: '发现规范文档' }));
    badges.push(h('span', { class: 'badge badge-neutral', text: `${fmt.num(c.fileCount)} 个文件` }));
  } else {
    badges.push(h('span', { class: 'badge badge-unknown', text: `not recognised: ${c.reason || 'unreadable'}` }));
  }
  return h('div', { class: `candidate match-${c.match || 'fuzzy'}` }, [
    h('div', { class: 'row-between wrap' }, [
      h('div', { class: 'row wrap' }, [
        h('span', { class: `badge ${c.match === 'exact' ? 'badge-healthy' : 'badge-neutral'}`, text: c.match === 'exact' ? '名称完全匹配' : '名称相近' }),
        h('strong', { class: 'small', text: c.name || c.path.split(/[\\/]/).pop() }),
      ]),
      h('button', {
        class: 'btn btn-primary btn-sm',
        text: '添加这个文件夹',
        onClick: () => onAdd(c),
      }),
    ]),
    h('div', { class: 'c-path', text: c.path }),
    h('div', { class: 'c-badges' }, badges),
  ]);
}

export function renderImportPanel({ onAdded = null, compact = false } = {}) {
  const zone = h('div', { class: `dropzone${compact ? ' compact' : ''}`, role: 'button', tabindex: '0', 'aria-label': 'Import a project folder by dropping it here' }, [
    h('div', { class: 'dz-icon' }, [h('span', { class: 'arrow' }), h('span', { class: 'tray' })]),
    h('h3', { text: '把项目文件夹拖到这里' }),
    h('p', { text: '从资源管理器拖入文件夹 —— Commander 会在磁盘上定位它并识别技术栈后再导入。全程不修改任何文件。' }),
    h('div', { class: 'dz-actions' }, compact ? [
      // With projects already listed the buttons duplicate 「+ 添加项目」; what is worth saying
      // here is only that dragging works.
      h('span', { class: 'kbd', text: '把项目文件夹从资源管理器拖进来即可导入' }),
    ] : [
      h('button', { class: 'btn btn-sm', text: '浏览并选择文件夹…', onClick: (e) => { e.stopPropagation(); picker.click(); } }),
      h('button', { class: 'btn btn-sm btn-ghost', text: '改为粘贴路径', onClick: (e) => { e.stopPropagation(); openAddDialog(); } }),
      h('span', { class: 'kbd', text: 'or drop it anywhere on this panel' }),
    ]),
  ]);

  const picker = h('input', { type: 'file', webkitdirectory: '', multiple: '', class: 'dz-file-input', 'aria-label': 'Choose a project folder' });
  picker.addEventListener('change', () => {
    const name = folderNameFromFiles(picker.files);
    if (name) resolveAndOffer(name);
    picker.value = '';
  });

  let dragDepth = 0;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth += 1; zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) zone.classList.remove('drag'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove('drag');
    const { name, isDirectory } = folderNameFromEntries([...(e.dataTransfer?.items || [])]);
    if (!name) {
      const fallback = folderNameFromFiles([...(e.dataTransfer?.files || [])]);
      if (fallback) return resolveAndOffer(fallback);
      toast('拖入文件夹（不是文件）即可导入项目', 'error');
      return;
    }
    if (!isDirectory) { toast('这看起来是个文件 —— 请拖入项目文件夹', 'error'); return; }
    resolveAndOffer(name);
  });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });

  async function resolveAndOffer(folderName) {
    const dlg = modal(`Recognising “${folderName}”…`, h('div', { class: 'stack' }, [
      h('div', { class: 'small muted', text: `正在已配置的根目录中查找“${folderName}”，并用扫描器识别每个匹配项…` }),
      h('div', { class: 'skeleton', style: { width: '80%' } }),
      h('div', { class: 'skeleton', style: { width: '64%' } }),
    ]));
    try {
      const res = await api.resolveWorkspace(folderName);
      clear(dlg.backdrop.querySelector('.modal-body'));
      const body = dlg.backdrop.querySelector('.modal-body');
      clear(body);
      appendCandidates(body, res, folderName, dlg, onAdded);
    } catch (err) {
      dlg.close();
      toast(`Recognition failed: ${err.message}`, 'error');
    }
  }

  function appendCandidates(body, res, folderName, dlg, onAdded) {
    const list = h('div', { class: 'stack-sm' });
    if (!res.candidates.length) {
      list.appendChild(h('div', { class: 'state' }, [
        h('h3', { text: '没有找到匹配的文件夹' }),
        h('div', { class: 'small', text: res.note || 'Try adding the parent folder to Settings → Search roots, or paste the path manually.' }),
      ]));
    }
    for (const c of res.candidates) {
      list.appendChild(candidateCard(c, async (cand) => {
        try {
          const project = await api.addProject({ workspacePath: cand.path });
          dlg.close();
          toast(`已添加 ${project.name}，正在执行首次全量扫描…`, 'ok', 8000);
          if (onAdded) onAdded(project);
          state.scanPending.add(project.id);
          api.scan(project.id, { mode: 'full', runCommands: true, suites: ['unit', 'integration', 'e2e'] })
            .catch((e) => toast(`扫描入队失败：${e.message}`, 'error'));
          Router.go(`/projects/${project.id}`);
        } catch (err) {
          toast(err.message + (err.hint ? ` — ${err.hint}` : ''), 'error');
        }
      }));
    }
    body.appendChild(h('div', { class: 'stack' }, [
      h('div', { class: 'row-between' }, [
        h('strong', { class: 'small', text: `“${folderName}” 找到 ${res.candidates.length} 个候选` }),
        h('button', { class: 'btn btn-sm', text: '改为粘贴路径', onClick: () => { dlg.close(); openAddDialog(); } }),
      ]),
      list,
      h('div', { class: 'small muted', text: '识别过程会运行真实扫描器（只读元数据 —— 不构建、不测试、不写入任何东西）。搜索根目录可在设置里配置。' }),
    ]));
  }

  const wrap = h('div', {}, [zone, picker]);
  return wrap;
}

/** Manual path entry dialog (delegates to the Projects view implementation). */
async function openAddDialog() {
  const mod = await import('./projects.js');
  mod.openAddDialog();
}
