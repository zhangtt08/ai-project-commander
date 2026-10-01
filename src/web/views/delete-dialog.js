/**
 * The delete dialog. One decision by default: remove this project from Commander.
 *
 * Wiping the folder off the disk is a separate, opt-in step that stays hidden until asked for —
 * the everyday action must not be blocked by a choice most people do not want to make, and the
 * destructive path still requires typing the real directory name (the server refuses otherwise).
 */
import { api } from '../api.js';
import { h, modal, toast, errorText } from '../ui.js';
import { refreshShellData } from '../app.js';
import { Router } from '../router.js';

export function openDeleteDialog(cardData, { onDone = null } = {}) {
  const status = h('div', { class: 'small muted' });
  const purgeBox = h('div', { class: 'stack-sm' });
  purgeBox.hidden = true;
  let assessment = null;

  const finish = async (msg) => {
    toast(msg, 'ok', 8000);
    dlg.close();
    await refreshShellData();
    // Router.go() to the route you are already on fires no hashchange, so the list would keep
    // showing the deleted row until a manual refresh. Re-dispatch instead.
    if (onDone) onDone(); else Router.reload();
  };
  const fail = (err) => { status.textContent = `删除失败：${errorText(err)}`; };

  const confirmBtn = h('button', {
    class: 'btn btn-danger',
    text: '确认删除',
    onClick: async () => {
      confirmBtn.disabled = true;
      try {
        const res = await api.deleteProject(cardData.id);
        await finish(`已从 Commander 删除「${cardData.name}」，磁盘文件未改动：${res.sourceDirectoryUntouched}`);
      } catch (err) {
        confirmBtn.disabled = false;
        fail(err);
      }
    },
  });

  const toggle = h('button', {
    class: 'btn btn-sm btn-ghost',
    text: '不，连磁盘上的目录一起删',
    onClick: () => {
      if (!purgeBox.hidden) { purgeBox.hidden = true; purgeBox.replaceChildren(); return; }
      toggle.textContent = '取消彻底删除';
      renderPurge();
    },
  });

  function renderPurge() {
    const assess = h('div', { class: 'small muted', text: '正在检查源目录…' });
    const input = h('input', { class: 'input', placeholder: '正在读取确认口令…', 'aria-label': '彻底删除确认' });
    const go = h('button', {
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
        if (input.value.trim() !== token) {
          status.textContent = `请输入「${token}」—— 这是磁盘上真实的目录名。`;
          return;
        }
        try {
          const res = await api.deleteProjectWithSource(cardData.id, token);
          await finish(`已删除记录并清除源文件：${res.sourcePurged.path}（${res.sourcePurged.fileCount} 个文件）`);
        } catch (err) { fail(err); }
      },
    });
    purgeBox.hidden = false;
    purgeBox.replaceChildren(
      h('div', { class: 'danger-note', text: `会永久删除 ${cardData.workspacePath} 及其全部文件，无法恢复。请确认另有备份。` }),
      assess, input, go,
    );
    api.deletionAssessment(cardData.id).then((a) => {
      assessment = a;
      if (a.ok) {
        assess.textContent = `源目录：${a.fileCount} 个文件 · ${a.humanSize}${a.truncatedStats ? '（统计已达上限）' : ''}`;
        input.placeholder = `输入「${a.confirmToken}」以确认彻底删除`;
      } else {
        assess.textContent = `源目录不可清除：${a.reason}`;
        input.placeholder = '当前源目录不允许彻底删除';
      }
    }).catch((err) => { assess.textContent = `无法评估源目录：${err.message}`; });
  }

  const dlg = modal(`删除项目 — ${cardData.name}`, h('div', { class: 'stack' }, [
    h('div', { class: 'stack-sm' }, [
      h('div', { class: 'small', text: '从 Commander 移除这个项目的记录（任务、风险、快照、提示词等一并移除）。' }),
      h('div', { class: 'small muted', text: '磁盘上的项目目录不会被改动 —— 想再加回来，重新导入即可。' }),
      h('div', { class: 'evidence', text: cardData.workspacePath }),
    ]),
    h('div', { class: 'row wrap' }, [confirmBtn, toggle, h('button', { class: 'btn btn-ghost', text: '取消', onClick: () => dlg.close() })]),
    purgeBox,
    status,
  ]));
}
