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
        });
        toast('设置已保存', 'ok');
        await refreshShellData();
        render();
      } catch (err) { toast(err.message, 'error'); }
    };

    const providerCard = card('AI 服务', h('div', { class: 'stack' }, [
      h('div', { class: 'small muted', text: 'Deterministic facts (git, build, tests, file counts) NEVER come from the AI provider. The provider only summarises, explains and suggests. Every AI response is schema-validated; failures retry once then fall back to the deterministic Mock provider.' }),
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
      h('div', { class: 'small muted', text: `正在监控 ${system.watcher.watching.length} 个工作区。 Debounce ${system.watcher.debounceMs}ms, rate limit ${system.watcher.maxEventsPerMinute}/min.` }),
    ]));

    const rootsField = h('textarea', {
      class: 'textarea', rows: '5', 'aria-label': 'Search roots',
      placeholder: 'C:////Users////you////Desktop//nD:////dev',
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
      table([{ label: 'Framework', key: 'framework' }, { label: 'Recognised summary', key: 'summaryPattern' }], meta.testParsers),
      table([
        { label: 'Adapter', key: 'label' },
        { label: 'Real?', render: (r) => h('span', { class: `badge ${r.real ? 'badge-pass' : 'badge-mock'}`, text: r.real ? 'real' : 'mock' }) },
        { label: 'Note', render: (r) => h('span', { class: 'small' , text: r.note }) },
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

    return h('div', { class: 'stack' }, [
      providerCard,
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
      h('div', { class: 'small muted', text: 'Patterns: .env, .env.*, *.pem, *.key, id_rsa, id_ed25519, credentials*, secrets*, tokens*, .npmrc, .pypirc, .netrc, .git-credentials, .aws/**, .azure/**, serviceAccount*.json, *.jks, *.keystore, secring.gpg' }),
    ])),
    card('命令执行', h('div', { class: 'stack' }, [
      h('p', { class: 'small', text: 'Every external command goes through a single CommandRunner. `shell` is always false — no shell injection surface exists.' }),
      h('h3', { class: 'small', text: 'Auto-allowed' }),
      h('div', { class: 'tag-list' }, s.commandRunner.autoAllowed.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: 'Always blocked binaries' }),
      h('div', { class: 'tag-list' }, s.commandRunner.alwaysBlocked.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: 'Blocked argument patterns' }),
      table([{ label: 'Pattern', key: 'pattern' }, { label: 'Reason', key: 'reason' }], s.commandRunner.argumentPatternsBlocked),
    ])),
    card('受管工作区', h('p', { class: 'small', text: s.managedWorkspace })),
    card('AI 数据边界', h('p', { class: 'small', text: s.aiDataBoundary })),
    card('密钥', h('p', { class: 'small', text: s.secretsStorage })),
  ]), { loadingLabel: '正在加载安全模型…' });
}

