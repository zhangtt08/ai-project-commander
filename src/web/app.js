/** Application shell: navigation, topbar, route wiring. */
import { api } from './api.js';
import { h, clear, toast, fmt } from './ui.js';
import { Router } from './router.js';

export const state = {
  system: null,
  meta: null,
  dashboard: null,
  attention: null,
  sidebarCounts: { attention: 0, projects: 0 },
};

const NAV = [
  { group: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  { id: 'attention', label: 'Attention Center', path: '/attention', countKey: 'attention' },
  { id: 'projects', label: 'Projects', path: '/projects', countKey: 'projects' },
  { id: 'search', label: 'Search', path: '/search' },
  { group: 'Operations' },
  { id: 'jobs', label: 'Analysis Queue', path: '/jobs' },
  { id: 'events', label: 'Global Timeline', path: '/events' },
  { group: 'System' },
  { id: 'settings', label: 'Settings', path: '/settings' },
  { id: 'security', label: 'Security', path: '/security' },
];

export function setTopbar(title, subtitle = '', actions = []) {
  const bar = document.getElementById('topbar');
  clear(bar);
  bar.appendChild(h('div', {}, [
    h('h1', { text: title }),
    subtitle ? h('div', { class: 'subtitle', text: subtitle }) : null,
  ]));
  bar.appendChild(h('div', { class: 'topbar-actions' }, actions));
}

export function renderNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  const { path } = Router.hash();
  for (const item of NAV) {
    if (item.group) { nav.appendChild(h('div', { class: 'nav-group', text: item.group })); continue; }
    const active = item.path === '/' ? path === '/' : path.startsWith(item.path);
    const count = item.countKey ? state.sidebarCounts[item.countKey] : null;
    nav.appendChild(h('a', {
      class: 'nav-item',
      href: `#${item.path}`,
      'aria-current': active ? 'page' : null,
      onClick: () => setTimeout(renderNav, 0),
    }, [
      h('span', { text: item.label }),
      count ? h('span', { class: 'count', text: String(count) }) : null,
    ]));
  }
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('commander.theme', t); } catch { /* private mode */ }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    clear(btn);
    btn.appendChild(h('span', { text: t === 'dark' ? 'Dark' : 'Light' }));
    btn.title = 'Toggle light / dark theme';
    btn.setAttribute('aria-label', `Current theme: ${t}. Click to switch.`);
  }
}

export function setSystemPill() {
  const pill = document.getElementById('system-pill');
  if (!pill) return;
  clear(pill);
  const s = state.system;
  if (!s) { pill.className = 'pill pill-idle'; pill.textContent = 'connecting…'; return; }
  const active = (s.providers || []).find((p) => p.active);
  pill.className = `pill ${active && active.configured ? 'pill-ok' : 'pill-idle'}`;
  pill.appendChild(h('span', { text: `AI: ${active ? active.name : 'none'}` }));
  pill.appendChild(h('span', { class: 'muted', text: `· v${s.version}` }));
  pill.title = `Node ${s.nodeVersion} · DB ${s.dbFile} · FTS5 ${s.ftsAvailable ? 'on' : 'off'}`;
}

export async function refreshShellData() {
  try {
    const [dashboard, attention, system] = await Promise.all([api.dashboard(), api.attention(), api.system()]);
    state.dashboard = dashboard;
    state.attention = attention;
    state.system = system;
    state.sidebarCounts = {
      attention: attention.items.filter((i) => i.severity === 'critical' || i.severity === 'high').length,
      projects: dashboard.counts.total,
    };
    setSystemPill();
    renderNav();
  } catch (err) {
    toast(`Shell refresh failed: ${err.message}`, 'error');
  }
}

function renderSidebarTools() {
  const tools = document.getElementById('sidebar-tools');
  if (!tools || tools.childElementCount) return;
  const toggle = h('button', { class: 'btn btn-sm btn-ghost', id: 'theme-toggle', onClick: () => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  } });
  tools.appendChild(toggle);
  applyTheme(document.documentElement.dataset.theme || 'dark');
}

async function boot() {
  const router = new Router();
  const views = await Promise.all([
    import('./views/dashboard.js'),
    import('./views/attention.js'),
    import('./views/projects.js'),
    import('./views/project.js'),
    import('./views/settings.js'),
    import('./views/search.js'),
    import('./views/jobs.js'),
    import('./views/notfound.js'),
  ]);
  const [dashboard, attention, projects, project, settings, search, jobs, notfound] = views;

  router
    .on('/', () => dashboard.render())
    .on('/attention', () => attention.render())
    .on('/projects', () => projects.render())
    .on('/projects/:id', ({ params }) => project.render(params.id, 'overview'))
    .on('/projects/:id/:tab', ({ params }) => project.render(params.id, params.tab))
    .on('/search', ({ query }) => search.render(query))
    .on('/jobs', () => jobs.render('jobs'))
    .on('/events', () => jobs.render('events'))
    .on('/settings', () => settings.render())
    .on('/security', () => settings.renderSecurity())
    .on('/notfound', () => notfound.renderNotFound({ path: window.location.hash }));

  try {
    state.meta = await api.meta();
  } catch (err) {
    toast(`Could not load API metadata: ${err.message}`, 'error');
  }
  await refreshShellData();
  renderSidebarTools();
  if ((state.dashboard?.counts?.total || 0) === 0) {
    Router.go('/projects');
  }
  router.start();
  setInterval(() => { if (!document.hidden) refreshShellData(); }, 20000);
  window.addEventListener('hashchange', () => setTimeout(renderNav, 0));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      Router.go('/search');
    }
  });
  document.documentElement.dataset.booted = fmt.date(new Date().toISOString());
}

boot().catch((err) => {
  const view = document.getElementById('view');
  clear(view);
  view.appendChild(h('div', { class: 'state error' }, [
    h('h3', { text: 'The interface failed to start' }),
    h('div', { class: 'small', text: err.message }),
    h('div', { class: 'evidence', text: 'Check that the API server is running (npm run dev) and reload.' }),
  ]));
});
