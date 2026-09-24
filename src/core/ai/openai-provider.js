/**
 * OpenAI-compatible provider — works with OpenAI, Azure OpenAI, OpenRouter,
 * Together, Groq, Ollama (/v1), vLLM and any other `/chat/completions` endpoint.
 *
 * The API key is held in memory on the server only. It is never sent to the frontend,
 * never logged, and never embedded in a prompt.
 */
import { AIProvider, maskSecrets } from './provider.js';
import { ProviderError } from '../../domain/errors.js';
import { logger } from '../logger.js';

const log = logger.child('ai.openai');

export class OpenAICompatibleProvider extends AIProvider {
  constructor({ name = 'openai-compatible', baseUrl, apiKey, model, timeoutMs = 60000 } = {}) {
    super({ name, kind: 'openai-compatible', model: model || 'gpt-4o-mini' });
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey || '';
    this.timeoutMs = timeoutMs;
  }

  isConfigured() { return Boolean(this.baseUrl && this.apiKey); }

  async generate({ system, prompt, context = {} }) {
    if (!this.isConfigured()) {
      throw new ProviderError('AI provider is not configured (baseUrl and apiKey are required)');
    }
    const body = {
      model: this.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: maskSecrets(system || 'You are a precise engineering analyst. Reply with JSON only.') },
        { role: 'user', content: maskSecrets(prompt || '') },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Never surface the response body verbatim: it can echo request headers.
        throw new ProviderError(`AI provider returned HTTP ${res.status}`, text.slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]'));
      }
      const json = await res.json();
      const text = json && json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
      log.info('completed', { model: this.model, durationMs: Date.now() - started, chars: String(text || '').length });
      return { text, model: this.model, provider: this.name, usage: json.usage || null };
    } catch (err) {
      if (err.name === 'AbortError') throw new ProviderError(`AI provider timed out after ${this.timeoutMs}ms`);
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`AI provider request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function providerFromSettings(settings = {}) {
  const kind = settings['ai.provider'] || 'mock';
  if (kind === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      name: 'openai-compatible',
      baseUrl: settings['ai.baseUrl'] || process.env.OPENAI_BASE_URL,
      apiKey: settings['ai.apiKey'] || process.env.OPENAI_API_KEY,
      model: settings['ai.model'] || 'gpt-4o-mini',
      timeoutMs: Number(settings['ai.timeoutMs'] || 60000),
    });
  }
  return null;
}
