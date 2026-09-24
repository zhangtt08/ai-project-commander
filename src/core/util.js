/** Small shared utilities. No dependencies. */
import crypto from 'node:crypto';

export function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso() { return new Date().toISOString(); }

export function sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function truncate(text, max = 4000) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.floor(max * 0.7))}\n... [${text.length - max} chars truncated] ...\n${text.slice(-Math.floor(max * 0.25))}`;
}

/** Keep only the most informative tail of command output. */
export function summarizeOutput(text, max = 2000) {
  if (!text) return '';
  const cleaned = text.replace(/\u001b\[[0-9;]*m/g, '').trimEnd();
  if (cleaned.length <= max) return cleaned;
  const head = cleaned.slice(0, Math.floor(max * 0.25));
  const tail = cleaned.slice(-Math.floor(max * 0.7));
  return `${head}\n... [truncated] ...\n${tail}`;
}

export function uniqueBy(array, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of array) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function groupBy(array, keyFn) {
  const map = new Map();
  for (const item of array) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * A sleep whose timer can be cancelled. Required wherever a timeout races a real
 * operation — otherwise the timer keeps the event loop alive for the full timeout
 * even after the operation has finished.
 */
export function sleepCancellable(ms) {
  let timer = null;
  const promise = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => { if (timer) { clearTimeout(timer); timer = null; } } };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toPosix(p) { return String(p).replace(/\\/g, '/'); }
