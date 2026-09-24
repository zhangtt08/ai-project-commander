import { h, stateEmpty, stateError } from '../ui.js';
import { setTopbar } from '../app.js';

export function renderNotFound(matched) {
  setTopbar('Not found', matched && matched.path ? `No view matches ${matched.path}` : 'No view matches this route');
  const view = document.getElementById('view');
  view.replaceChildren(stateEmpty('Route not found', 'Use the sidebar, or press / to search.'));
}

export function renderFatal(err, matched) {
  setTopbar('Error', matched && matched.path ? `Failed while rendering ${matched.path}` : 'Render failed');
  const view = document.getElementById('view');
  view.replaceChildren(stateError(err, () => window.location.reload()));
}

