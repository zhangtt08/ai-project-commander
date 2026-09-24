import { api } from '../api.js';
import { h, card, table, mountAsync, stateEmpty, healthBadge, statusBadge, gateBadge, toast, modal } from '../ui.js';
import { setTopbar, refreshShellData } from '../app.js';
import { Router } from '../router.js';

export async function render() {
  setTopbar('Projects', 'Register local workspaces. Commander only ever reads them.', [
    h('button', { class: 'btn', text: 'Seed demo projects', onClick: seedDemo }),
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: 'Add project', onClick: () => openAddDialog() }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, () => api.projects(), (cards) => {
    if (!cards.length) {
      return h('div', { class: 'stack' }, [
        stateEmpty('No projects registered', 'Add a local workspace directory, or seed the demo projects.'),
        card('What happens when you add a project?', h('ol', { class: 'stack-sm small' }, [
          h('li', { text: 'Commander scans the directory (structure, stack, specs, TODO markers).' }),
          h('li', { text: 'Sensitive files (.env, *.key, credentials…) are detected but never read.' }),
          h('li', { text: 'Git state, build command and test commands are detected and executed with strict safety rules.' }),
          h('li', { text: 'A snapshot, health verdict, risk list and next action are produced.' }),
        ])),
      ]);
    }
    return table([
      { label: 'Project', render: (r) => h('div', {}, [h('a', { href: `#/projects/${r.id}`, text: r.name }), r.isDemo ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: 'demo' }) : null, h('div', { class: 'path', text: r.workspacePath })]) },
      { label: 'Health', render: (r) => healthBadge(r.health) },
      { label: 'Status', render: (r) => h('span', { class: 'chip', text: r.status }) },
      { label: 'Stage', render: (r) => r.currentStage || '—' },
      { label: 'Progress', render: (r) => (r.progress && r.progress.percent !== null ? `${r.progress.percent}%` : 'unknown'), num: true },
      { label: 'Build', render: (r) => (r.build ? statusBadge(r.build.status) : '—') },
      { label: 'Tests', render: (r) => h('span', { class: 'small mono', text: [r.unit ? `u ${r.unit.passed}/${r.unit.total}` : null, r.e2e ? `e2e ${r.e2e.passed}/${r.e2e.total}` : null].filter(Boolean).join(' · ') || '—' }) },
      { label: 'Gate', render: (r) => gateBadge(r.gate) },
      { label: 'Stack', render: (r) => h('span', { class: 'small', text: `${r.primaryLanguage || '?'} / ${r.framework || '?'}` }) },
      { label: 'Actions', render: (r) => h('div', { class: 'row' }, [
        h('button', { class: 'btn btn-sm', text: 'Scan', onClick: (e) => { e.stopPropagation(); scan(r.id); } }),
        h('button', { class: 'btn btn-sm', text: 'Settings', onClick: (e) => { e.stopPropagation(); openProjectSettings(r); } }),
      ]) },
    ], cards, { empty: 'No projects registered.' });
  }, { loadingLabel: 'Loading projects…' });
}

async function scan(projectId) {
  try {
    toast('Full scan queued — running build and tests…', 'info', 6000);
    await api.scan(projectId, { mode: 'full', runCommands: true, suites: ['unit', 'e2e'] });
    toast('Scan queued. Watch the Analysis Queue for progress.', 'ok');
    setTimeout(() => { refreshShellData(); }, 1500);
  } catch (err) {
    toast(`Scan failed to queue: ${err.message}`, 'error');
  }
}

async function seedDemo() {
  try {
    toast('Seeding demo projects — real builds and tests are executing…', 'info', 10000);
    const results = await api.seedDemo({ runCommands: true });
    await refreshShellData();
    toast(`Seeded ${results.filter((r) => !r.skipped).length} demo project(s)`, 'ok');
    render();
  } catch (err) {
    toast(`Seeding failed: ${err.message}`, 'error');
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

  const dlg = modal('Add a local workspace', h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Workspace path (absolute)' }), pathInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Display name' }), nameInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Description' }), descInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Extra ignore patterns' }), ignoreInput]),
    h('div', { class: 'small muted', text: 'Commander never writes to this directory. Sensitive files are detected but their contents are never read.' }),
    errBox,
    h('div', { class: 'row' }, [
      h('button', { class: 'btn btn-primary', text: 'Add and scan', onClick: submit }),
      h('button', { class: 'btn', text: 'Cancel', onClick: () => dlg.close() }),
    ]),
  ]));
  pathInput.focus();
}

export async function openProjectSettings(cardData) {
  const nameInput = h('input', { class: 'input', value: cardData.name, 'aria-label': 'Display name' });
  const descInput = h('textarea', { class: 'textarea', rows: '3', value: cardData.description || '', 'aria-label': 'Description' });
  const confirmInput = h('input', { class: 'input', placeholder: 'type DELETE to confirm', 'aria-label': 'Delete confirmation' });
  const status = h('div', { class: 'small muted' });

  const dlg = modal(`Settings — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Display name' }), nameInput]),
    h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Description' }), descInput]),
    h('div', { class: 'row wrap' }, [
      h('button', {
        class: 'btn btn-primary',
        text: 'Save',
        onClick: async () => {
          try {
            await api.updateProject(cardData.id, { name: nameInput.value.trim(), description: descInput.value.trim() });
            toast('Project updated', 'ok');
            dlg.close();
            await refreshShellData();
            render();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', {
        class: 'btn',
        text: cardData.watchPaused ? 'Resume watching' : 'Pause watching',
        onClick: async () => {
          try {
            if (cardData.watchPaused) await api.resumeWatch(cardData.id); else await api.pauseWatch(cardData.id);
            toast('Watch state updated', 'ok');
            dlg.close();
            render();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', {
        class: 'btn',
        text: 'Archive',
        onClick: async () => {
          try { await api.archiveProject(cardData.id); toast('Project archived', 'ok'); dlg.close(); await refreshShellData(); render(); } catch (err) { toast(err.message, 'error'); }
        },
      }),
    ]),
    h('hr', { class: 'hr' }),
    h('div', { class: 'stack-sm' }, [
      h('strong', { class: 'small', text: 'Delete Commander record' }),
      h('div', { class: 'small muted', text: `This deletes only Commander's database rows. The source directory ${cardData.workspacePath} is never modified or deleted.` }),
      confirmInput,
      h('button', {
        class: 'btn btn-danger',
        text: 'Delete record',
        onClick: async () => {
          if (confirmInput.value.trim() !== 'DELETE') { status.textContent = 'Type DELETE to enable this action.'; return; }
          try {
            const res = await api.deleteProject(cardData.id);
            toast(`Record deleted. Source untouched: ${res.sourceDirectoryUntouched}`, 'ok', 8000);
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

