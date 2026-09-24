/**
 * Structured logger. Never logs secrets or full source code (requirement #52).
 * Levels: debug | info | warn | error
 */
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_RE = /(api[-_]?key|secret|token|password|passwd|pwd|authorization|credential|private[-_]?key|npmrc|pypirc)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/g;

export function redact(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.replace(SECRET_VALUE_RE, '[REDACTED]').slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

class Logger {
  constructor({ level = 'info', file = null, sink = null } = {}) {
    this.level = LEVELS[level] ?? LEVELS.info;
    this.file = file;
    this.sink = sink;
    this.buffer = [];
  }

  configure({ level, file }) {
    if (level) this.level = LEVELS[level] ?? this.level;
    if (file !== undefined) this.file = file;
  }

  child(scope) { return new ScopedLogger(this, scope); }

  _write(level, event, data) {
    if (LEVELS[level] < this.level) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(data && Object.keys(data).length ? { data: redact(data) } : {}),
    };
    this.buffer.push(record);
    if (this.buffer.length > 500) this.buffer.shift();
    if (this.sink) { try { this.sink(record); } catch { /* sink must never break logging */ } }
    const line = `[${record.ts}] ${level.toUpperCase().padEnd(5)} ${event}${data ? ' ' + JSON.stringify(record.data) : ''}`;
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    if (this.file) {
      try { fs.appendFileSync(this.file, line + '\n'); } catch { /* ignore fs errors */ }
    }
  }

  debug(event, data) { this._write('debug', event, data); }
  info(event, data) { this._write('info', event, data); }
  warn(event, data) { this._write('warn', event, data); }
  error(event, data) { this._write('error', event, data); }

  recent(n = 100) { return this.buffer.slice(-n); }
}

class ScopedLogger {
  constructor(root, scope) { this.root = root; this.scope = scope; }
  _ev(event) { return `${this.scope}.${event}`; }
  debug(e, d) { this.root.debug(this._ev(e), d); }
  info(e, d) { this.root.info(this._ev(e), d); }
  warn(e, d) { this.root.warn(this._ev(e), d); }
  error(e, d) { this.root.error(this._ev(e), d); }
  child(sub) { return new ScopedLogger(this.root, `${this.scope}.${sub}`); }
}

export const logger = new Logger({ level: process.env.COMMANDER_LOG_LEVEL || 'info' });
export { Logger };

export function logFileFor(dataDir) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'commander.log');
}
