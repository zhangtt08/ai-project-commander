/** Typed error hierarchy. API layer maps these to HTTP status + safe messages. */

export class CommanderError extends Error {
  constructor(message, { code = 'commander_error', status = 500, hint = '', cause = null, expose = true } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.expose = expose;
    if (cause) this.cause = cause;
  }
  toJSON() {
    return { code: this.code, message: this.expose ? this.message : 'Internal error', hint: this.expose ? this.hint : '' };
  }
}

export class ValidationError extends CommanderError {
  constructor(message, details = []) {
    super(message, { code: 'validation_error', status: 400, hint: details.map((d) => `${d.path}: ${d.message}`).join('; ') });
    this.details = details;
  }
}

export class NotFoundError extends CommanderError {
  constructor(what, id) {
    super(`${what} not found: ${id}`, { code: 'not_found', status: 404 });
  }
}

export class ConflictError extends CommanderError {
  constructor(message, hint = '') {
    super(message, { code: 'conflict', status: 409, hint });
  }
}

export class WorkspaceError extends CommanderError {
  constructor(message, hint = '') {
    super(message, { code: 'workspace_error', status: 400, hint });
  }
}

export class CommandBlockedError extends CommanderError {
  constructor(message, hint = '') {
    super(message, { code: 'command_blocked', status: 403, hint });
  }
}

export class ProviderError extends CommanderError {
  constructor(message, hint = '', { expose = true } = {}) {
    super(message, { code: 'provider_error', status: 502, hint, expose });
  }
}

export class SchemaMismatchError extends CommanderError {
  constructor(message, details = []) {
    const list = typeof details === 'string' ? (details ? [details] : []) : details;
    super(message, { code: 'schema_mismatch', status: 502, hint: Array.isArray(list) ? list.join('; ') : String(list) });
    this.details = list;
  }
}

export class TimeoutError extends CommanderError {
  constructor(message) {
    super(message, { code: 'timeout', status: 504 });
  }
}

export function normalizeError(err) {
  if (err instanceof CommanderError) return err;
  const e = new CommanderError(err && err.message ? err.message : String(err), { expose: false });
  e.stack = err && err.stack;
  return e;
}
