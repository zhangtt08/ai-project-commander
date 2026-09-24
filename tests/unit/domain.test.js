import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { s, validate, describeShape, formatErrors } from '../../src/domain/schema.js';
import * as constants from '../../src/domain/constants.js';
import { AI_SCHEMAS, REQUIRED_PROMPT_SECTIONS } from '../../src/domain/ai-schemas.js';
import { classifyFile } from '../../src/core/analyzers/change-analyzer.js';
import { createMatcher, globToRegExp } from '../../src/core/glob.js';

describe('schema validator', () => {
  const schema = s.object({
    name: s.string({ min: 1, max: 10 }),
    count: s.int({ min: 0 }).optional(),
    kind: s.enum(['a', 'b']),
    tags: s.array(s.string(), { max: 3 }).optional().default([]),
    nested: s.object({ ok: s.boolean() }).optional(),
  });

  test('accepts a valid document and applies defaults', () => {
    const res = validate(schema, { name: 'hi', kind: 'a' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value.tags, []);
  });

  test('rejects missing required fields with a path', () => {
    const res = validate(schema, { kind: 'a' });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.path === 'name' && /required/.test(e.message)));
  });

  test('rejects wrong types and enums', () => {
    const res = validate(schema, { name: 'x', kind: 'z' });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /must be one of/.test(e.message)));
    const res2 = validate(schema, { name: 12, kind: 'a' });
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.some((e) => /expected string/.test(e.message)));
  });

  test('enforces min/max and array limits', () => {
    assert.equal(validate(schema, { name: 'x'.repeat(20), kind: 'a' }).ok, false);
    assert.equal(validate(schema, { name: 'x', kind: 'a', count: -1 }).ok, false);
    assert.equal(validate(schema, { name: 'x', kind: 'a', tags: ['1', '2', '3', '4'] }).ok, false);
  });

  test('strict objects reject unknown keys', () => {
    const strict = s.object({ a: s.string() }, { strict: true });
    assert.equal(validate(strict, { a: 'x', b: 1 }).ok, false);
  });

  test('describeShape produces a readable shape for prompts', () => {
    const shape = describeShape(schema);
    assert.match(shape, /"name"/);
    assert.match(shape, /"a" \| "b"/);
  });

  test('formatErrors is human readable', () => {
    const res = validate(schema, {});
    assert.match(formatErrors(res.errors), /name: is required/);
  });
});

describe('domain constants', () => {
  test('every enum has a matching *_VALUES companion', () => {
    const pairs = Object.keys(constants).filter((k) => k.endsWith('_VALUES'));
    assert.ok(pairs.length >= 10, `expected several _VALUES lists, got ${pairs.length}`);
    for (const key of pairs) {
      const base = key.replace(/_VALUES$/, '');
      assert.ok(constants[base], `${key} has no ${base}`);
      assert.ok(Array.isArray(constants[key]) && constants[key].length > 0);
    }
  });

  test('sensitive patterns and default ignores are populated', () => {
    assert.ok(constants.SENSITIVE_PATTERNS.length >= 20);
    assert.ok(constants.DEFAULT_IGNORE.includes('node_modules'));
    assert.ok(constants.DEFAULT_SCAN_LIMITS.maxFiles > 0);
  });
});

describe('AI schemas', () => {
  test('every AI schema rejects an empty document and accepts a minimal valid one', () => {
    for (const [name, schema] of Object.entries(AI_SCHEMAS)) {
      const empty = validate(schema, {});
      assert.equal(empty.ok, false, `${name} accepted an empty document`);
    }
    const promptSchema = AI_SCHEMAS.agentPrompt;
    assert.equal(validate(promptSchema, { title: 't', prompt: 'p' }).ok, true);
    const nextAction = AI_SCHEMAS.nextAction;
    assert.equal(validate(nextAction, { objective: 'o', reason: 'r' }).ok, true);
    assert.equal(validate(nextAction, { objective: 'o', reason: 'r', priority: 'p9' }).ok, false);
  });

  test('the prompt generator contract lists ten sections', () => {
    assert.equal(REQUIRED_PROMPT_SECTIONS.length, 10);
    for (const section of REQUIRED_PROMPT_SECTIONS) assert.equal(section, section.toUpperCase());
  });
});

describe('glob + ignore matcher', () => {
  test('translates the common glob forms', () => {
    const m = createMatcher(['node_modules', '*.log', 'src/**/*.test.js', 'build']);
    assert.equal(m.matches('node_modules'), true);
    assert.equal(m.matches('a/b/node_modules'), true);
    assert.equal(m.matches('app.log'), true);
    assert.equal(m.matches('src/deep/nested/x.test.js'), true);
    assert.equal(m.matches('src/x.ts'), false);
    assert.equal(m.matches('build'), true);
  });

  test('globToRegExp handles brace alternation and double star', () => {
    const { rx } = globToRegExp('dist/{a,b}/*.js');
    assert.equal(rx.test('dist/a/x.js'), true);
    assert.equal(rx.test('dist/c/x.js'), false);
  });
});

describe('change analyzer', () => {
  test('classifies by path and file type before falling back to commit hints', () => {
    assert.equal(classifyFile('tests/a.test.js').kind, 'test');
    assert.equal(classifyFile('docs/guide.md').kind, 'docs');
    assert.equal(classifyFile('package.json').kind, 'config');
    assert.equal(classifyFile('src/app.ts', { commitSubject: 'fix the crash' }).kind, 'fix');
    assert.equal(classifyFile('src/app.ts').kind, 'unknown');
  });
});
