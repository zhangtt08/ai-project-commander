import { api } from '../api.js';
import { h, metric, card, healthBadge, gateBadge, statusBadge, progressBar, mountAsync, stateEmpty, suiteResult, projectStatusLabel, enumLabel, fmt } from '../ui.js';
import { state, setTopbar } from '../app.js';
import { Router } from '../router.js';
import { openImportDialog } from './import.js';

const SEV_GLYPH = { critical: '✕', high: '⚠', medium: 'ⓘ', low: '☰' };

function runCell(run, suite) {
  if (!run) return h('span', { class: 'muted small', text: '未运行' });
  const cls = run.status === 'pass' ? 'badge-pass' : run.status === 'fail' ? 'badge-fail' : run.status === 'error' ? 'badge-warning' : 'badge-unknown';
  const ZH = { unit: '单元', integration: '集成', e2e: '端到端' };
  return h('span', { class: `badge ${cls}`, title: run.command || '', text: `${ZH[suite] || suite}：${suiteResult(run)}` });
}

function projectCard(cardData) {
  const meta = cardData;
  const shell = {
    class: 'proj-card',
    tabindex: '0',
    role: 'link',
    'aria-label': `打开项目 ${meta.name}`,
    onClick: () => Router.go(`/projects/${meta.id}`),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Router.go(`/projects/${meta.id}`); } },
  };

  // The folder moved or was deleted outside Commander. Every cached verdict below would then be
  // a claim about a directory that cannot be read, so the card reports only what is known now.
  if (meta.workspaceMissing) {
    return h('article', shell, [
      h('div', { class: 'row-between' }, [
        h('h3', { text: meta.name }),
        h('span', { class: 'badge badge-critical', text: '目录已不存在' }),
      ]),
      h('div', { class: 'path', text: meta.workspacePath }),
      h('div', { class: 'stack-sm' }, [
        h('div', { class: 'small', text: '这个目录当前不在磁盘上，历史结论已隐藏，因为它们不代表现状。' }),
        h('div', { class: 'small muted', text: `最后一次分析：${fmt.date(meta.lastAnalyzedAt)} —— 请在「项目」页点「整理」修正路径后重新分析，或删除这条记录。` }),
      ]),
    ]);
  }

  return h('article', shell, [
    h('div', { class: 'row-between' }, [
      h('div', { class: 'row' }, [
        h('h3', { text: meta.name }),
        meta.isDemo ? h('span', { class: 'chip', text: '演示' }) : null,
        meta.watchPaused ? h('span', { class: 'chip', text: '监控已暂停' }) : null,
      ]),
      healthBadge(meta.health),
    ]),
    h('div', { class: 'path', text: meta.workspacePath }),
    h('div', { class: 'proj-stats' }, [
      h('span', {}, [h('span', { class: 'muted', text: '分类 ' }), h('b', { text: meta.categoryLabel || '未分类' })]),
      h('span', {}, [h('span', { class: 'muted', text: '阶段 ' }), h('b', { text: meta.currentStage || '未知' })]),
      h('span', {}, [h('span', { class: 'muted', text: '状态 ' }), h('b', { text: projectStatusLabel(meta.status) })]),
      h('span', {}, [h('span', { class: 'muted', text: '任务 ' }), h('b', { text: `${meta.taskSummary.done}/${meta.taskSummary.total}` })]),
      h('span', {}, [h('span', { class: 'muted', text: '风险 ' }), h('b', { text: `${meta.riskSummary.bySeverity.critical} 危急 / ${meta.riskSummary.bySeverity.high} 高` })]),
      meta.git && meta.git.isRepository ? h('span', {}, [h('span', { class: 'muted', text: '分支 ' }), h('b', { text: `${meta.git.branch}${meta.git.clean ? '' : `（${meta.git.changed + meta.git.untracked} 个未提交）`}` })]) : null,
    ]),
    h('div', { class: 'row wrap' }, [
      meta.build ? statusBadge(meta.build.status) : null,
      runCell(meta.unit, 'unit'),
      runCell(meta.e2e, 'e2e'),
      gateBadge(meta.gate),
      meta.drift && meta.drift.verdict === 'possible_drift' ? h('span', { class: 'badge badge-warning', text: `规范漂移 ${meta.drift.count}` }) : null,
      meta.regressionSummary && meta.regressionSummary.count ? h('span', { class: 'badge badge-critical', text: `${meta.regressionSummary.count} 项回归` }) : null,
      meta.suggestionCount ? h('span', { class: 'badge badge-unknown', title: '可优化的建议', text: `${meta.suggestionCount} 条优化建议` }) : null,
    ]),
    progressBar({ percent: meta.progress ? meta.progress.percent : null, reason: meta.progress ? meta.progress.reason : '尚未计算' }),
    h('div', { class: 'small muted' }, `最近活动 ${fmt.rel(meta.lastActivity)} · 分析于 ${fmt.rel(meta.lastAnalyzedAt)}`),
    meta.nextAction ? h('div', { class: 'small' }, [
      h('span', { class: 'muted', text: '下一步：' }),
      h('span', { text: fmt.truncate(meta.nextAction.objective, 110) }),
    ]) : null,
  ]);
}

export async function render() {
  setTopbar('仪表盘', '所有受管 AI 编码项目的实时工程状态。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
    h('button', { class: 'btn btn-primary', text: '+ 添加项目', onClick: () => openImportDialog() }),
  ]);
  const view = document.getElementById('view');

  await mountAsync(view, () => api.dashboard(), (data) => {
    const c = data.counts;
    const attentionData = state.attention || { items: [] };
    const criticals = attentionData.items.filter((i) => i.severity === 'critical').length;
    const head = h('div', { class: 'stack' }, [
      h('div', { class: 'grid grid-4' }, [
        metric('项目数', fmt.num(c.total), { foot: `${c.archived} 个已归档` }),
        metric('健康', fmt.num(c.healthy), { cls: 'ok' }),
        metric('警告', fmt.num(c.warning), { cls: c.warning ? 'warn' : '' }),
        metric('危急', fmt.num(c.critical), { cls: c.critical ? 'alert' : '', foot: c.missing ? `${c.missing} 个目录已丢失` : undefined }),
        metric('阻塞', fmt.num(c.blocked), { cls: c.blocked ? 'alert' : '' }),
        metric('关注项', fmt.num(attentionData.items.length), { cls: criticals ? 'alert' : '', foot: `${criticals} 个紧急` }),
      ]),
      card('需要立即关注', attentionData.items.slice(0, 6).length
        ? h('div', { class: 'stack-sm' }, attentionData.items.slice(0, 6).map((i) => h('div', { class: `risk-item alert-row sev-${i.severity}` }, [
          h('span', { class: `sev-dot dot-${i.severity}`, 'aria-hidden': 'true', text: SEV_GLYPH[i.severity] || '•' }),
          h('div', { class: 'alert-body' }, [
            h('strong', { class: 'small', text: i.title }),
            i.detail ? h('div', { class: 'small muted', text: fmt.truncate(i.detail, 200) }) : null,
            i.at ? h('div', { class: 'small muted alert-time', title: `观察时间 ${fmt.date(i.at)}`, text: `⏱ ${fmt.rel(i.at)}` }) : null,
          ]),
          h('span', { class: `badge badge-${i.severity === 'critical' ? 'critical' : i.severity === 'high' ? 'warning' : 'unknown'}`, text: enumLabel(i.severity) }),
          h('a', { class: 'alert-go', href: `#/projects/${i.projectId}`, 'aria-label': `打开项目 ${i.projectName || ''}`, text: '›' }),
        ])))
        : stateEmpty('暂无需关注的事项', '当前没有危急、阻塞、失败或回归的项目。'),
      { actions: [h('a', { class: 'small', href: '#/attention', text: '查看全部 →' })], hint: `共 ${attentionData.items.length} 条` }),

      h('div', { class: 'row-between' }, [
        h('h2', { style: { fontSize: '13px', margin: '8px 0 0' }, text: `项目（${data.cards.length}）` }),
      ]),
      data.cards.length
        ? h('div', { class: 'grid grid-2' }, data.cards.map(projectCard))
        : stateEmpty('还没有项目', '点击「+ 添加项目」扫描这台电脑，或直接输入一个本地工作区路径。'),
    ]);
    return head;
  }, { loadingLabel: '正在加载仪表盘…' });
}
