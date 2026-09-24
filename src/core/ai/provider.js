/**
 * AIProvider abstraction — requirements #48 & #49.
 *
 * Contract: a provider NEVER returns unvalidated data to the caller.
 * Providers produce either `text` (to be JSON-parsed) or `object` (already structured,
 * as the deterministic Mock provider does). `structured.js` owns validation + retry.
 */
import { logger } from '../logger.js';
import { ProviderError } from '../../domain/errors.js';

const log = logger.child('ai');

export class AIProvider {
  /** @param {{name:string, kind:string, model?:string}} meta */
  constructor(meta = {}) {
    this.name = meta.name || 'provider';
    this.kind = meta.kind || 'unknown';
    this.model = meta.model || 'unknown';
  }

  isConfigured() { throw new Error('isConfigured() must be implemented'); }

  /** @returns {Promise<{text?:string, object?:object, model:string, provider:string, usage?:object}>} */
  async generate() { throw new Error('generate() must be implemented'); }

  async healthCheck() {
    try {
      await this.generate({
        schemaName: 'healthCheck',
        system: 'Reply with JSON.',
        prompt: 'Return {"ok":true}',
        context: {},
      });
      return { ok: true, provider: this.name };
    } catch (err) {
      return { ok: false, provider: this.name, error: err.message };
    }
  }
}

/**
 * Registry of available providers. Secrets live only here (server side) and are
 * never serialised to the frontend or written to logs.
 */
export class ProviderRegistry {
  constructor() { this.providers = new Map(); this.activeName = null; }

  register(provider, { active = false } = {}) {
    this.providers.set(provider.name, provider);
    if (active || !this.activeName) this.activeName = provider.name;
    return provider;
  }

  get(name) { return this.providers.get(name) || null; }

  active() { return this.providers.get(this.activeName) || null; }

  setActive(name) {
    if (!this.providers.has(name)) throw new ProviderError(`unknown provider: ${name}`);
    this.activeName = name;
    log.info('active_provider_changed', { provider: name });
    return this.active();
  }

  /** Public, secret-free description for the Settings screen. */
  describe() {
    return [...this.providers.values()].map((p) => ({
      name: p.name,
      kind: p.kind,
      model: p.model,
      configured: p.isConfigured(),
      active: p.name === this.activeName,
    }));
  }
}

/** Redact anything that looks like a secret before it leaves the process. */
export function maskSecrets(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{15,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED_SECRET]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/((?:api[-_]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)["']?[^\s"',]{6,}/gi, '$1[REDACTED]');
}

/** Hard cap on how much of a file we ever put into a prompt. */
export function excerpt(text, maxChars = 1200) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [${text.length - maxChars} chars omitted]`;
}

export { ProviderError };
