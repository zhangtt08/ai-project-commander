/**
 * Structured output pipeline — requirement #49 / ADR-008.
 *
 *   provider.generate()  ->  extract JSON  ->  validate against schema
 *        ^                                          |
 *        |                                          v (invalid)
 *        +---------- retry with error feedback <----+
 *                                                   |
 *                                                   v (still invalid)
 *                                        deterministic Mock fallback
 *
 * `JSON.parse` is never trusted on its own.
 */
import { validate, formatErrors, describeShape } from '../../domain/schema.js';
import { SchemaMismatchError } from '../../domain/errors.js';
import { logger } from '../logger.js';
import { CONFIDENCE } from '../../domain/constants.js';

const log = logger.child('ai.structured');

/** Extract the first JSON object/array from a possibly-chatty model response. */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty response' };
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    const start = candidate.search(/[[{]/);
    if (start === -1) return { ok: false, error: 'no JSON value found in response' };
    const openChar = candidate[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth += 1;
      else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          try {
            return { ok: true, value: JSON.parse(candidate.slice(start, i + 1)) };
          } catch (err) {
            return { ok: false, error: `JSON parse failed: ${err.message}` };
          }
        }
      }
    }
    return { ok: false, error: 'unbalanced JSON in response' };
  }
}

export class StructuredRunner {
  /**
   * @param {{registry:object, mockProvider:object}} deps
   */
  constructor({ registry, mockProvider }) {
    this.registry = registry;
    this.mockProvider = mockProvider;
    this.stats = { calls: 0, retries: 0, fallbacks: 0, failures: 0 };
  }

  /**
   * @returns {Promise<{data:object, provider:string, model:string, confidence:string,
   *   evidence:Array, attempts:number, fallbackUsed:boolean, schemaName:string, validationOk:boolean}>}
   */
  async run({ schemaName, schema, system, prompt, context = {}, maxRetries = 1 }) {
    this.stats.calls += 1;
    const provider = this.registry.active();
    const mustUseMock = !provider || provider.kind === 'mock' || !provider.isConfigured();
    const chain = mustUseMock ? [this.mockProvider] : [provider, this.mockProvider];

    let attempts = 0;
    let lastErrors = [];
    for (let idx = 0; idx < chain.length; idx += 1) {
      const p = chain[idx];
      const isFallback = idx > 0;
      if (isFallback) this.stats.fallbacks += 1;

      for (let attempt = 0; attempt <= (isFallback ? 0 : maxRetries); attempt += 1) {
        attempts += 1;
        if (attempt > 0) this.stats.retries += 1;
        const effectivePrompt = attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous response was rejected by schema validation:\n${formatErrors(lastErrors)}\n\nReturn ONLY a JSON object matching this shape:\n${describeShape(schema)}`;

        let raw;
        try {
          raw = await p.generate({ schemaName, schema, system, prompt: effectivePrompt, context, attempt });
        } catch (err) {
          lastErrors = [{ path: '<provider>', message: err.message }];
          log.warn('provider_error', { provider: p.name, schemaName, error: err.message, attempt });
          break;
        }

        let value = raw && raw.object !== undefined ? raw.object : null;
        if (value === null) {
          const extracted = extractJson(raw ? raw.text : '');
          if (!extracted.ok) {
            lastErrors = [{ path: '<json>', message: extracted.error }];
            log.warn('json_extract_failed', { provider: p.name, schemaName, error: extracted.error, attempt });
            continue;
          }
          value = extracted.value;
        }

        const result = validate(schema, value);
        if (result.ok) {
          return {
            data: result.value,
            provider: raw.provider || p.name,
            model: raw.model || p.model,
            confidence: (result.value && result.value.confidence) || CONFIDENCE.MEDIUM,
            evidence: (result.value && result.value.evidence) || [],
            attempts,
            fallbackUsed: isFallback,
            schemaName,
            validationOk: true,
            usage: raw.usage || null,
          };
        }
        lastErrors = result.errors;
        log.warn('schema_mismatch', { provider: p.name, schemaName, errors: result.errors.slice(0, 5), attempt });
      }
    }

    // Absolute last resort: an empty, schema-valid document. Never throw away the whole analysis.
    this.stats.failures += 1;
    const empty = validate(schema, emptyDocument(schema));
    if (empty.ok) {
      return {
        data: empty.value,
        provider: this.mockProvider.name,
        model: this.mockProvider.model,
        confidence: CONFIDENCE.UNKNOWN,
        evidence: [],
        attempts,
        fallbackUsed: true,
        schemaName,
        validationOk: false,
        warning: `AI output for "${schemaName}" could not be validated; returning an empty document with confidence=unknown. Details: ${formatErrors(lastErrors)}`,
      };
    }
    throw new SchemaMismatchError(`AI output for "${schemaName}" failed schema validation`, formatErrors(lastErrors));
  }

  describeStats() { return { ...this.stats, activeProvider: this.registry.activeName }; }
}

function emptyDocument(schema) {
  if (!schema || schema.kind !== 'object') return {};
  const out = {};
  for (const [key, sub] of Object.entries(schema.opts.shape)) {
    if (sub.opts.optional || Object.prototype.hasOwnProperty.call(sub.opts, 'default')) continue;
    out[key] = emptyValue(sub);
  }
  return out;
}

function emptyValue(schema) {
  switch (schema.kind) {
    case 'string': return schema.opts.enumValues ? schema.opts.enumValues[0] : '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return emptyDocument(schema);
    case 'record': return {};
    default: return null;
  }
}
