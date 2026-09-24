/** Hash router. Small, explicit, dependency-free. */
let activeRouter = null;

export class Router {
  constructor() {
    this.routes = [];
    this.current = null;
    activeRouter = this;
    window.addEventListener('hashchange', () => this.#dispatch());
  }

  on(pattern, handler) {
    const keys = [];
    const rx = new RegExp(`^${pattern.replace(/:[A-Za-z0-9_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })}$`);
    this.routes.push({ rx, keys, handler, pattern });
    return this;
  }

  static hash() {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [pathPart, queryPart] = raw.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    return { path: pathPart || '/', query };
  }

  static go(path) {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  match() {
    const { path, query } = Router.hash();
    for (const r of this.routes) {
      const m = r.rx.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params, query, path };
    }
    return { route: null, params: {}, query, path };
  }

  /** Re-dispatch the current route through the active router instance. */
  static reload() {
    if (activeRouter) return activeRouter.#dispatch();
    window.location.reload();
  }

  start() { this.#dispatch(); return this; }

  async #dispatch() {
    const matched = this.match();
    this.current = matched;
    if (!matched.route) {
      const { renderNotFound } = await import('./views/notfound.js');
      renderNotFound(matched);
      return;
    }
    try {
      await matched.route.handler(matched);
    } catch (err) {
      const { renderFatal } = await import('./views/notfound.js');
      renderFatal(err, matched);
    }
  }
}
