import { api } from '../api.js';
import { h, card, table, mountAsync, toast } from '../ui.js';
import { setTopbar, refreshShellData } from '../app.js';

export async function render() {
  setTopbar('Settings', 'AI provider, watcher and scan limits. Secrets stay on the server.', [
    h('button', { class: 'btn', text: 'Refresh', onClick: () => render() }),
  ]);
  const view = document.getElementById('view');
  await mountAsync(view, async () => ({ settings: await api.settings(), system: await api.system(), meta: await api.meta() }), ({ settings, system, meta }) => {
    const fields = {
      provider: h('select', { class: 'select', 'aria-label': 'AI provider' }, [
        h('option', { value: 'mock', selected: (settings['ai.provider'] || 'mock') === 'mock', text: 'mock — deterministic, offline, no API key' }),
        h('option', { value: 'openai-compatible', selected: settings['ai.provider'] === 'openai-compatible', text: 'openai-compatible — any /chat/completions endpoint' }),
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
        });
        toast('Settings saved', 'ok');
        await refreshShellData();
        render();
      } catch (err) { toast(err.message, 'error'); }
    };

    const providerCard = card('AI Provider', h('div', { class: 'stack' }, [
      h('div', { class: 'small muted', text: 'Deterministic facts (git, build, tests, file counts) NEVER come from the AI provider. The provider only summarises, explains and suggests. Every AI response is schema-validated; failures retry once then fall back to the deterministic Mock provider.' }),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Provider' }), fields.provider]),
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Model' }), fields.model]),
      ]),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Base URL' }), fields.baseUrl]),
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'API key (never returned to the browser)' }), fields.apiKey]),
      ]),
      h('div', { class: 'grid grid-2' }, [
        h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Timeout (ms)' }), fields.timeoutMs]),
      ]),
      h('div', { class: 'row' }, [h('button', { class: 'btn btn-primary', text: 'Save settings', onClick: save })]),
      h('div', { class: 'grid grid-3' }, [
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Structured calls' }), h('div', { class: 'value sm', text: String(system.aiStats.calls) })]),
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Schema retries' }), h('div', { class: 'value sm', text: String(system.aiStats.retries) })]),
        h('div', { class: 'metric' }, [h('div', { class: 'label', text: 'Mock fallbacks' }), h('div', { class: 'value sm', text: String(system.aiStats.fallbacks) })]),
      ]),
    ]));

    const watcherCard = card('Watcher & Scan Limits', h('div', { class: 'stack' }, [
      h('label', { class: 'row small' }, [fields.watcherEnabled, h('span', { text: 'Enable filesystem watcher (debounced, ignores node_modules/.git/dist)' })]),
      h('label', { class: 'row small' }, [fields.autoQuick, h('span', { text: 'Automatically queue a quick scan on change (never calls an LLM)' })]),
      h('div', { class: 'stack-sm' }, [h('label', { class: 'small muted', text: 'Maximum files per scan' }), fields.maxFiles]),
      h('div', { class: 'row' }, [h('button', { class: 'btn btn-primary', text: 'Save settings', onClick: save })]),
      h('div', { class: 'small muted', text: `Watching ${system.watcher.watching.length} workspace(s). Debounce ${system.watcher.debounceMs}ms, rate limit ${system.watcher.maxEventsPerMinute}/min.` }),
    ]));

    const metaCard = card('Test parsers & adapters', h('div', { class: 'grid grid-2' }, [
      table([{ label: 'Framework', key: 'framework' }, { label: 'Recognised summary', key: 'summaryPattern' }], meta.testParsers),
      table([
        { label: 'Adapter', key: 'label' },
        { label: 'Real?', render: (r) => h('span', { class: `badge ${r.real ? 'badge-pass' : 'badge-mock'}`, text: r.real ? 'real' : 'mock' }) },
        { label: 'Note', render: (r) => h('span', { class: 'small' , text: r.note }) },
      ], meta.agentAdapters),
    ]));

    const systemCard = card('System', h('dl', { class: 'kv' }, Object.entries({
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
      metaCard,
      systemCard,
    ]);
  }, { loadingLabel: 'Loading settings…' });
}

export async function renderSecurity() {
  setTopbar('Security Model', 'What Commander is allowed to do — and what it is structurally prevented from doing.');
  const view = document.getElementById('view');
  await mountAsync(view, () => api.security(), (s) => h('div', { class: 'stack' }, [
    card('Sensitive file protection', h('div', { class: 'stack-sm' }, [
      h('p', { class: 'small', text: s.sensitiveFiles.policy }),
      h('div', { class: 'small muted', text: 'Patterns: .env, .env.*, *.pem, *.key, id_rsa, id_ed25519, credentials*, secrets*, tokens*, .npmrc, .pypirc, .netrc, .git-credentials, .aws/**, .azure/**, serviceAccount*.json, *.jks, *.keystore, secring.gpg' }),
    ])),
    card('Command execution', h('div', { class: 'stack' }, [
      h('p', { class: 'small', text: 'Every external command goes through a single CommandRunner. `shell` is always false — no shell injection surface exists.' }),
      h('h3', { class: 'small', text: 'Auto-allowed' }),
      h('div', { class: 'tag-list' }, s.commandRunner.autoAllowed.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: 'Always blocked binaries' }),
      h('div', { class: 'tag-list' }, s.commandRunner.alwaysBlocked.map((c) => h('span', { class: 'chip', text: c }))),
      h('h3', { class: 'small', text: 'Blocked argument patterns' }),
      table([{ label: 'Pattern', key: 'pattern' }, { label: 'Reason', key: 'reason' }], s.commandRunner.argumentPatternsBlocked),
    ])),
    card('Managed workspace', h('p', { class: 'small', text: s.managedWorkspace })),
    card('AI data boundary', h('p', { class: 'small', text: s.aiDataBoundary })),
    card('Secrets', h('p', { class: 'small', text: s.secretsStorage })),
  ]), { loadingLabel: 'Loading security model…' });
}

