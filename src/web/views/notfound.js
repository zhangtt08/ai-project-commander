import { h, stateEmpty, stateError } from '../ui.js';
import { setTopbar } from '../app.js';

export function renderNotFound(matched) {
  setTopbar('页面不存在', matched && matched.path ? `没有视图匹配路径 ${matched.path}` : '没有视图匹配该路径');
  const view = document.getElementById('view');
  view.replaceChildren(stateEmpty('找不到该路由', '请使用左侧导航，或按 / 进行搜索。'));
}

export function renderFatal(err, matched) {
  setTopbar('渲染出错', matched && matched.path ? `渲染 ${matched.path} 时失败` : '渲染时发生错误');
  const view = document.getElementById('view');
  view.replaceChildren(stateError(err, () => window.location.reload()));
}

