/**
 * One delete dialog, used from the project header and from each row of the project list.
 *
 * "Remove the record" and "wipe the folder too" are deliberately two separate buttons, and only
 * the destructive one asks to be typed for — the server refuses it without the real directory
 * name, so the UI must never suggest a word that will not work.
 */
import { api } from '../api.js';
import { h, modal, toast, errorText } from '../ui.js';
import { refreshShellData } from '../app.js';
import { Router } from '../router.js';

export function openDeleteDialog(cardData, { onDone = null } = {}) {
  const status = h('div', { class: 'small muted' });
  const assessBox = h('div', { class: 'small muted', text: '正在检查源目录…' });
  const purgeInput = h('input', { class: 'input', placeholder: '正在读取确认口令…', 'aria-label': '彻底删除确认' });
  let assessment = null;

  const closeAndRefresh = async (msg) => {
    toast(msg, 'ok', 9000);
    dlg.close();
    await refreshShellData();
    if (onDone) onDone(); else Router.go('/projects');
  };
  const fail = (err) => { status.textContent = `删除失败：${errorText(err)}`; };

  const dlg = modal(`删除项目 — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [
      h('div', { class: 'small muted', text: '项目目录' }),
      h('div', { class: 'evidence', text: cardData.workspacePath }),
      assessBox,
    ]),
    h('div', { class: 'stack-sm' }, [
      h('strong', { class: 'small', text: '只删除记录' }),
      h('div', { class: 'small', text: '从 Commander 移除这个项目（连同它的任务、风险、快照、提示词等记录）。磁盘上的源码目录不会被改动。' }),
      h('button', {
        class: 'btn',
        text: '删除记录，保留源码',
        onClick: async () => {
          try {
            const res = await api.deleteProject(cardData.id);
            await closeAndRefresh(`记录已删除，源码目录未动：${res.sourceDirectoryUntouched}`);
          } catch (err) { fail(err); }
        },
      }),
    ]),
    h('hr', { class: 'hr' }),
    h('div', { class: 'stack-sm' }, [
      h('strong', { class: 'small', text: '删除记录并清除源文件' }),
      h('div', { class: 'danger-note', text: '会永久删除上面那个目录及其全部文件，无法恢复。请确认你另有备份。' }),
      purgeInput,
      h('button', {
        class: 'btn btn-danger',
        text: '永久删除记录与源文件',
        onClick: async () => {
          const token = assessment && assessment.confirmToken;
          if (!token) {
            status.textContent = assessment && assessment.reason
              ? `不能清除源目录：${assessment.reason}`
              : '源目录信息还在载入，请稍候再点。';
            return;
          }
          if (purgeInput.value.trim() !== token) {
            status.textContent = `请输入「${token}」—— 这是磁盘上真实的目录名。`;
            return;
          }
          try {
            const res = await api.deleteProjectWithSource(cardData.id, token);
            await closeAndRefresh(`已删除记录并清除源文件：${res.sourcePurged.path}（${res.sourcePurged.fileCount} 个文件）`);
          } catch (err) { fail(err); }
        },
      }),
    ]),
    status,
    h('div', { class: 'row' }, [h('button', { class: 'btn btn-ghost', text: '取消', onClick: () => dlg.close() })]),
  ]));

  api.deletionAssessment(cardData.id).then((a) => {
    assessment = a;
    if (a.ok) {
      assessBox.textContent = `源目录：${a.fileCount} 个文件 · ${a.humanSize}${a.truncatedStats ? '（统计已达上限）' : ''}`;
      purgeInput.placeholder = `输入「${a.confirmToken}」以确认彻底删除`;
    } else {
      assessBox.textContent = `源目录不可清除：${a.reason}`;
      purgeInput.placeholder = '当前源目录不允许彻底删除';
    }
  }).catch((err) => {
    assessment = null;
    assessBox.textContent = `无法评估源目录：${err.message}`;
  });
}
