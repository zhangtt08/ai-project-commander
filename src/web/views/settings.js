import { api } from '../api.js';
import { h, card, table, mountAsync, toast } from '../ui.js';
import { setTopbar, refreshShellData } from '../app.js';

export async function render() {
  setTopbar('设置', 'AI 服务、监控与扫描限制。密钥只保存在服务端。', [
    h('button', { class: 'btn', text: '刷新', onClick: () => render() }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, async () => ({ settings: await api.settings(), system: await api.system(), meta: await api.meta() }), ({ settings, system, meta }) => {
    const fields = {
      provider: h('select', { class: 'select', 'aria-label': 'AI provider' }, [
        h('option', { value: 'mock', selected: (settings['ai.provider'] || 'mock') === 'mock', text: 'mock —— 确定性、离线、无需 API Key' }),
        h('option', { value: 'openai-compatible', selected: settings['ai.provider'] === 'openai-compatible', text: 'openai-compatible —— 任意 /chat/completions 接口' }),
      ]),
      baseUrl: h('input', { class: 'input', value: settings['ai.baseUrl'] || '', placeholder: 'https://api.openai.com/v1', 'aria-label': 'Base URL' }),
      model: h('input', { class: 'input', value: settings['ai.model'] || 'gpt-4o-mini', 'aria-label': 'Model' }),
      apiKey: h('input', { class: 'input', type: 'password', value: '', placeholder: settings['ai.apiKey'] === '__stored__' ? '(stored — leave blank to keep)' : 'sk-…', 'aria-label': 'API key' }),
      timeoutMs: h('input', { class: 'input', value: settings['ai.timeoutMs'] || '60000', 'aria-label': 'Timeout ms' }),
      watcherEnabled: h('input', { type: 'checkbox', checked: settings['watcher.enabled'] !== 'false', 'aria-label': 'Watcher enabled' }),
      autoQuick: h('input', { type: 'checkbox', checked: settings['watcher.autoQuickScan'] === 'true', 'aria-label': 'Auto quick scan' }),
      maxFiles: h('input', { class: 'input', value: settings['scan.maxFiles'] || '20000', 'aria-label': 'Max files' }),
      ghEnabled: h('input', { type: 'checkbox', checked: settings['github.enabled'] === 'true', 'aria-label': '自动上传到 GitHub 私有仓库' }),
      ghToken: h('input', { class: 'input', type: 'password', value: '', placeholder: settings['github.token'] === '__stored__' ? '（已保存 — 留空则保持不变）' : 'ghp_… / github_pat_…', 'aria-label': 'GitHub token' }),
      ghOwner: h('input', { class: 'input', value: settings['github.owner'] || '', placeholder: '留空则自动取令牌所属账号', 'aria-label': 'GitHub 用户名' }),
    };

    const ghStatus = h('div', { class: 'small muted' });
    const verifyGithub = async () => {
      ghStatus.textContent = '正在校验令牌…';
      try {
        const r = await api.post('/api/github/verify', {});
        ghStatus.textContent = r.ok ? `校验通过：${r.username}，仓库将以非公开（private）方式创建。` : `校验失败：${r.reason}`;
      } catch (err) { ghStatus.textContent = `校验失败：${err.message}`; }
    };

    const save = async () => {
      try {
        await api.saveSettings({
          'ai.provider': fields.provider.value,
          'ai.baseUrl': fields.baseUrl.value.trim(),
          'ai.model': fields.model.value.trim(),
          'ai.timeoutMs': fields.timeoutMs.value.trim(),
          'ai.apiKey': fields.apiKey.value.trim(),
          'watcher.enabled': fields.watcherEnabled.checked ? 'true' : 'false',
          'watcher.autoQuickScan': fields.autoQuick.checked ? 'true' : 'false',
          'scan.maxFiles': fields.maxFiles.value.trim(),
          'workspace.searchRoots': JSON.stringify(rootsField.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12)),
          'github.enabled': fields.ghEnabled.checked ? 'true' : 'false',
          'github.owner': fields.ghOwner.value.trim(),
          'github.token': fields.ghToken.value.trim(),
        });
        toast('设置已保存', 'ok');
        await refreshShellData();
        render();
      } catch (err) { toast(err.message, 'error'); }
    };

    const providerCard = card('AI 服务', h('div', { class: 'stack' }, [
      h('div', { class: 'small muted', text: '确定性事实（git、构建、测试、文件数量）绝不来自 AI 提供方。提供方只做归纳、解释和建议。每次 AI 响应都会做结构校验；失败重试一次后回退到确定性 Mock 提供方。' }),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '提供方' }), fields.provider]),
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '模型' }), fields.model]),
      ]),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '接口地址' }), fields.baseUrl]),
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'API Key（永远不会回传浏览器）' }), fields.apiKey]),
      ]),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '超时（毫秒）' }), fields.timeoutMs]),
      ]),
      h('div', { class: 'row' }, [h('button', { class: 'btn btn-primary', text: '保存设置', onClick: save })]),
      h('div', { class: 'grid grid-3' }, [
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: '结构化调用' }), h('div', { class: 'value sm', text: String(system.aiStats.calls) })]),
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Schema 重试' }), h('div', { class: 'value sm', text: String(system.aiStats.retries) })]),
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Mock 回退' }), h('div', { class: 'value sm', text: String(system.aiStats.fallbacks) })]),
      ]),
    ]));

    const watcherCard = card('监控与扫描限制', h('div', { class: 'stack' }, [
      h('label', { class: 'row small' }, [fields.watcherEnabled, h('span', { text: '启用文件系统监控（去抖，忽略 node_modules/.git/dist）' })]),
      h('label', { class: 'row small' }, [fields.autoQuick, h('span', { text: '变更时自动排队快速扫描（绝不调用大模型）' })]),
      h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '每次扫描的最大文件数' }), fields.maxFiles]),
      h('div', { class: 'row' }, [h('button', { class: 'btn btn-primary', text: '保存设置', onClick: save })]),
      h('div', { class: 'small muted', text: `正在监控 ${system.watcher.watching.length} 个工作区；去抖 ${system.watcher.debounceMs}ms，限速 ${system.watcher.maxEventsPerMinute} 次/分钟。` }),
    ]));

    const rootsField = h('textarea', {
      class: 'textarea', rows: '5', 'aria-label': 'Search roots',
      placeholder: 'C:\\Users\\you\\Desktop\nD:\\dev',
    });
    try {
      const stored = settings['workspace.searchRoots'];
      const arr = stored ? JSON.parse(stored) : [];
      rootsField.value = Array.isArray(arr) ? arr.join('\n') : '';
    } catch { rootsField.value = ''; }
    const searchRootsCard = card('文件夹识别（拖拽导入）', h('div', { class: 'stack' }, [
      h('p', { class: 'small muted', text: '把文件夹拖到“项目”页时，浏览器只会暴露文件夹名——不会暴露路径。Commander 会在这些根目录中搜索真实位置，并用扫描器识别每个匹配项。' }),
      rootsField,
      h('div', { class: 'small muted', text: '每行一个绝对路径。按顺序搜索，最多向下 2 层；跳过 node_modules、.git 与系统目录。' }),
    ]));

    const metaCard = card('测试解析器与适配器', h('div', { class: 'grid grid-2' }, [
      table([{ label: '框架', key: 'framework' }, { label: '识别结果摘要', key: 'summaryPattern' }], meta.testParsers),
      table([
        { label: 'Adapter', key: 'label' },
        { label: '是否真实', render: (r) => h('span', { class: `badge ${r.real ? 'badge-pass' : 'badge-mock'}`, text: r.real ? 'real' : 'mock' }) },
        { label: '备注', render: (r) => h('span', { class: 'small' , text: r.note }) },
      ], meta.agentAdapters),
    ]));

    const systemCard = card('系统', h('dl', { class: 'kv' }, Object.entries({
      version: system.version,
      node: system.nodeVersion,
      platform: `${system.platform} (${system.os})`,
      'data dir': system.dataDir,
      'database': system.dbFile,
      'FTS5 full-text index': system.ftsAvailable ? 'available' : 'unavailable (LIKE fallback active)',
      'search indexed tables': system.search.indexedTables.join(', '),
      'queue': `${system.queue.byStatus.completed || 0} completed, ${system.queue.byStatus.failed || 0} failed, concurrency ${system.queue.concurrency}`,
      'uptime': `${system.uptimeSeconds}s`,
    }).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])));

    const githubCard = card('GitHub 私有仓库自动上传', h('div', { class: 'stack' }, [
      h('div', { class: 'small muted', text: '开启后，每导入一个项目就会在你的 GitHub 账号下创建一个非公开（private）仓库并推送。令牌只保存在服务端数据库，绝不会返回浏览器、绝不会写入项目的 .git/config，也不会出现在任何命令记录里。' }),
      h('label', { class: 'row small', style: { alignItems: 'center', gap: '7px' } }, [fields.ghEnabled, h('span', { text: '导入项目时自动创建并上传私有仓库' })]),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'GitHub 令牌（repo 权限）' }), fields.ghToken]),
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: '账号 / 组织' }), fields.ghOwner]),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn btn-primary', text: '保存设置', onClick: save }),
        h('button', { class: 'btn', text: '校验令牌', onClick: verifyGithub }),
      ]),
      ghStatus,
    ]));

    return h('div', { class: 'stack' }, [
      providerCard,
      githubCard,
      watcherCard,
      searchRootsCard,
      metaCard,
      systemCard,
    ]);
  }, { loadingLabel: '正在加载设置…' });
}

export async function renderSecurity() {
  setTopbar('安全模型', 'Commander 允许做什么——以及结构上被禁止做什么。');
  const view = document.getElementById('view');
  await mountAsync(view, () => api.security(), (s) => h('div', { class: 'stack' }, [
    card('敏感文件保护', h('div', { class: 'stack-sm' }, [
      h('p', { class: 'small', text: s.sensitiveFiles.policy }),
      h('h3', { class: 'small', text: `匹配模式（${(s.sensitiveFiles.patterns || []).length} 条，取自实际生效的规则）` }),
      h('div', { class: 'tag-list' }, (s.sensitiveFiles.patterns || []).map((p) => h('span', { class: 'chip mono', title: p.rule, text: p.pattern }))),
    ])),
    card('命令执行', h('div', { class: 'stack' }, [
      h('p', { class: 'small', text: '所有外部命令都经过同一个 CommandRunner。shell 恒为 false —— 不存在命令注入面。' }),
      h('h3', { class: 'small', text: '自动允许的' }),
      h('div', { class: 'tag-list' }, s.commandRunner.autoAllowed.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: '永远禁止的可执行程序' }),
      h('div', { class: 'tag-list' }, s.commandRunner.alwaysBlocked.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: '禁止的参数模式' }),
      table([{ label: '模式', key: 'pattern' }, { label: '原因', key: 'reason' }], s.commandRunner.argumentPatternsBlocked),
    ])),
    card('受管工作区', h('p', { class: 'small', text: s.managedWorkspace })),
    card('AI 数据边界', h('p', { class: 'small', text: s.aiDataBoundary })),
    card('密钥', h('p', { class: 'small', text: s.secretsStorage })),
  ]), { loadingLabel: '正在加载安全模型…' });
}

