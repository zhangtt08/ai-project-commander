/**
 * Minimal, dependency-free schema validator with a Zod-like surface.
 * Used for (a) validating AI structured output, (b) validating API request bodies.
 *
 * Supports: object / string / number / boolean / enum / array / record / any
 * plus .optional(), .default(), .nullable(), .min()/.max() for strings & numbers.
 */

class Schema {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.opts = opts;
    this.description = opts.description || '';
  }

  optional() {
    return new Schema(this.kind, { ...this.opts, optional: true });
  }

  nullable() {
    return new Schema(this.kind, { ...this.opts, nullable: true });
  }

  default(v) {
    return new Schema(this.kind, { ...this.opts, default: v });
  }

  describe(desc) {
    return new Schema(this.kind, { ...this.opts, description: desc });
  }

  _validate(value, path, errors) {
    const { opts } = this;
    if (value === undefined) {
      if (opts.optional || Object.prototype.hasOwnProperty.call(opts, 'default')) return true;
      errors.push({ path, message: 'is required' });
      return false;
    }
    if (value === null) {
      if (opts.nullable) return true;
      errors.push({ path, message: 'must not be null' });
      return false;
    }
    switch (this.kind) {
      case 'any':
        return true;
      case 'string': {
        if (typeof value !== 'string') { errors.push({ path, message: `expected string, got ${typeof value}` }); return false; }
        if (opts.min !== undefined && value.length < opts.min) { errors.push({ path, message: `must be at least ${opts.min} chars` }); return false; }
        if (opts.max !== undefined && value.length > opts.max) { errors.push({ path, message: `must be at most ${opts.max} chars` }); return false; }
        if (opts.enumValues && !opts.enumValues.includes(value)) { errors.push({ path, message: `must be one of ${opts.enumValues.join('|')}` }); return false; }
        return true;
      }
      case 'number': {
        if (typeof value !== 'number' || Number.isNaN(value)) { errors.push({ path, message: `expected number, got ${typeof value}` }); return false; }
        if (opts.int && !Number.isInteger(value)) { errors.push({ path, message: 'must be an integer' }); return false; }
        if (opts.min !== undefined && value < opts.min) { errors.push({ path, message: `must be >= ${opts.min}` }); return false; }
        if (opts.max !== undefined && value > opts.max) { errors.push({ path, message: `must be <= ${opts.max}` }); return false; }
        return true;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') { errors.push({ path, message: `expected boolean, got ${typeof value}` }); return false; }
        return true;
      }
      case 'array': {
        if (!Array.isArray(value)) { errors.push({ path, message: 'expected array' }); return false; }
        if (opts.min !== undefined && value.length < opts.min) { errors.push({ path, message: `must have at least ${opts.min} items` }); return false; }
        if (opts.max !== undefined && value.length > opts.max) { errors.push({ path, message: `must have at most ${opts.max} items` }); return false; }
        let ok = true;
        value.forEach((item, i) => {
          if (!opts.items._validate(item, `${path}[${i}]`, errors)) ok = false;
        });
        return ok;
      }
      case 'object': {
        if (typeof value !== 'object' || Array.isArray(value)) { errors.push({ path, message: 'expected object' }); return false; }
        let ok = true;
        for (const [key, sub] of Object.entries(opts.shape)) {
          if (!sub._validate(value[key], path ? `${path}.${key}` : key, errors)) ok = false;
        }
        if (opts.strict) {
          for (const key of Object.keys(value)) {
            if (!Object.prototype.hasOwnProperty.call(opts.shape, key)) {
              errors.push({ path: `${path}.${key}`, message: 'unknown key (strict)' });
              ok = false;
            }
          }
        }
        return ok;
      }
      case 'record': {
        if (typeof value !== 'object' || Array.isArray(value) || value === null) { errors.push({ path, message: 'expected object' }); return false; }
        let ok = true;
        for (const [k, v] of Object.entries(value)) {
          if (!opts.values._validate(v, `${path}.${k}`, errors)) ok = false;
        }
        return ok;
      }
      default:
        errors.push({ path, message: `unknown schema kind ${this.kind}` });
        return false;
    }
  }
}

function applyDefaults(schema, value) {
  if (schema.kind !== 'object' || typeof value !== 'object' || value === null) return value;
  const out = { ...value };
  for (const [key, sub] of Object.entries(schema.opts.shape)) {
    if (out[key] === undefined && Object.prototype.hasOwnProperty.call(sub.opts, 'default')) {
      out[key] = typeof sub.opts.default === 'function' ? sub.opts.default() : sub.opts.default;
    }
    if (out[key] !== undefined && sub.kind === 'object') out[key] = applyDefaults(sub, out[key]);
    if (out[key] !== undefined && sub.kind === 'array' && sub.opts.items.kind === 'object') {
      out[key] = out[key].map((v) => applyDefaults(sub.opts.items, v));
    }
  }
  return out;
}

export const s = {
  string: (opts = {}) => new Schema('string', opts),
  number: (opts = {}) => new Schema('number', opts),
  int: (opts = {}) => new Schema('number', { ...opts, int: true }),
  boolean: (opts = {}) => new Schema('boolean', opts),
  enum: (values, opts = {}) => new Schema('string', { ...opts, enumValues: values }),
  array: (items, opts = {}) => new Schema('array', { ...opts, items }),
  object: (shape, opts = {}) => new Schema('object', { ...opts, shape }),
  record: (values, opts = {}) => new Schema('record', { ...opts, values }),
  any: (opts = {}) => new Schema('any', opts),
};

/**
 * @returns {{ok:boolean, value?:any, errors:Array<{path:string,message:string}>}}
 */
export function validate(schema, input) {
  const errors = [];
  let target = input;
  if (schema.kind === 'object' && typeof input !== 'object') target = input;
  const ok = schema._validate(target, '', errors);
  if (!ok) return { ok: false, errors };
  return { ok: true, value: applyDefaults(schema, target), errors: [] };
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
}

/** Human/LLM readable shape description, used inside AI prompts. */
export function describeShape(schema, indent = 0) {
  const pad = '  '.repeat(indent);
  const opt = schema.opts.optional ? '?' : '';
  switch (schema.kind) {
    case 'object':
      return `{\n${Object.entries(schema.opts.shape)
        .map(([k, v]) => `${pad}  "${k}"${v.opts.optional ? '?' : ''}: ${describeShape(v, indent + 1)}`)
        .join(',\n')}\n${pad}}`;
    case 'array':
      return `${describeShape(schema.opts.items, indent)}[]`;
    case 'string':
      return schema.opts.enumValues ? `"${schema.opts.enumValues.join('" | "')}"` : 'string';
    case 'number':
      return schema.opts.int ? 'integer' : 'number';
    case 'boolean':
      return 'boolean';
    case 'record':
      return `Record<string, ${describeShape(schema.opts.values, indent)}>`;
    default:
      return `any${opt}`;
  }
}

export const SCHEMA_KIND = Symbol('schemaKind');
export function isSchema(v) {
  return v instanceof Schema;
}
