/**
 * Test output parsers — requirement #19.
 * Supports Vitest, Jest and Playwright reporter output.
 * Parser confidence is reported so downstream engines can degrade instead of lying.
 */
import { CONFIDENCE } from '../domain/constants.js';

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
export function stripAnsi(s) { return String(s || '').replace(ANSI, ''); }

function emptyResult(framework, confidence = CONFIDENCE.UNKNOWN) {
  return { framework, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, confidence, failures: [], summaryLine: '' };
}

/** Vitest:  "Tests  2 failed | 4 passed (6)"  /  "Tests  5 passed (5)" */
function parseVitestSummary(text) {
  const re = /^\s*Tests\s+(.+?)\((\d+)\)\s*$/m;
  const m = re.exec(text);
  if (!m) return null;
  const parts = m[1];
  const total = Number(m[2]);
  const grab = (word) => {
    const r = new RegExp(`(\\d+)\\s+${word}`, 'i').exec(parts);
    return r ? Number(r[1]) : 0;
  };
  const passed = grab('passed');
  const failed = grab('failed');
  const skipped = grab('skipped') + grab('todo');
  return { total, passed, failed, skipped, summaryLine: m[0].trim() };
}

/** Jest:  "Tests:       2 failed, 4 passed, 6 total" */
function parseJestSummary(text) {
  const re = /^\s*Tests:\s+(.+)$/m;
  const m = re.exec(text);
  if (!m) return null;
  const parts = m[1];
  const grab = (word) => {
    const r = new RegExp(`(\\d+)\\s+${word}`, 'i').exec(parts);
    return r ? Number(r[1]) : 0;
  };
  const total = grab('total');
  const passed = grab('passed');
  const failed = grab('failed');
  const skipped = grab('skipped') + grab('todo');
  return { total, passed, failed, skipped, summaryLine: m[0].trim() };
}

/** Playwright:  "22 passed (1.2m)" / "3 failed" / "1 flaky" */
function parsePlaywrightSummary(text) {
  const counts = {};
  const summaryLines = [];
  // Only accept strict standalone summary lines, so prose is never counted twice.
  const lineRe = /^\s*(\d+)\s+(passed|failed|flaky|skipped|did not run|interrupted)\s*(?:\([^)]*\))?\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe.exec(line);
    if (!m) continue;
    counts[m[2]] = (counts[m[2]] || 0) + Number(m[1]);
    summaryLines.push(line.trim());
  }
  if (!Object.keys(counts).length) return null;
  const passed = counts.passed || 0;
  const failed = (counts.failed || 0) + (counts.interrupted || 0);
  const flaky = counts.flaky || 0;
  const skipped = (counts.skipped || 0) + (counts['did not run'] || 0);
  return {
    total: passed + failed + skipped + flaky,
    passed,
    failed,
    skipped: skipped + flaky,
    summaryLine: summaryLines.join(' | '),
  };
}

function parseDuration(text, framework) {
  const patterns = [
    /Duration\s+([\d.]+)(ms|s|m)\b/i,
    /Time:\s+([\d.]+)\s*(ms|s|m)?\b/i,
    /\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/im,
    /finished in ([\d.]+)\s*(ms|s|m)?/i,
  ];
  for (const rx of patterns) {
    const m = rx.exec(text);
    if (m) {
      const val = Number(m[1]);
      const unit = m[2] || 'ms';
      return unit === 'm' ? val * 60000 : unit === 's' ? val * 1000 : val;
    }
  }
  return 0;
}

/** Vitest failing test: " × describe > it" plus a following error block */
function parseVitestFailures(text) {
  const failures = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*(?:×|✕|❯)\s+(.+?)(?:\s+\d+ms)?\s*$/.exec(lines[i]);
    // Skip file-level summary lines such as "❯ tests/a.test.js (2 tests | 1 failed) 12ms".
    if (m && (/\(\d+ tests?/.test(m[1]) || /\d+ms\)?$/.test(m[1]) || /\.(test|spec)\.[a-z]+ \(/.test(m[1]))) continue;
    if (m) {
      const name = m[1].trim();
      let err = '';
      let file = '';
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j += 1) {
        const l = lines[j];
        if (!file) {
          const fm = /(?:❯|at)\s+([^\s:]+\.(?:ts|tsx|js|jsx|mjs|cjs))(?::(\d+))?/.exec(l);
          if (fm) file = fm[1];
        }
        if (/^\s*(AssertionError|Error|TypeError|ReferenceError|expected)/.test(l)) { err = l.trim(); break; }
        if (l.trim() && !err) err = l.trim();
      }
      failures.push({ name, file, error: err.slice(0, 400) });
    }
  }
  return failures;
}

/** Jest failing test header: "  ● describe › it" */
function parseJestFailures(text) {
  const failures = [];
  const blocks = text.split(/\n\s*●\s/).slice(1);
  for (const block of blocks) {
    const firstLine = block.split(/\r?\n/)[0].trim();
    const file = (/([^\s:]+\.(?:ts|tsx|js|jsx|mjs|cjs))/.exec(block) || [])[1] || '';
    const err = (/^\s*(Expected|Received|Error|TypeError|AssertionError)[^\n]*/m.exec(block) || [])[0] || '';
    failures.push({ name: firstLine, file, error: err.trim().slice(0, 400) });
  }
  return failures;
}

/** Playwright failure header: "  1) [chromium] › tests/a.spec.ts:12:1 › does a thing ─────" */
function parsePlaywrightFailures(text) {
  const failures = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*\d+\)\s+(.+?)\s*─+\s*$/.exec(lines[i]);
    if (m) {
      const raw = m[1].trim();
      const fileMatch = /([^\s›]+\.(?:spec|test)\.(?:ts|tsx|js|jsx))(?::(\d+))?(?::(\d+))?/.exec(raw);
      const name = raw.split('›').pop().trim();
      let err = '';
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j += 1) {
        if (/^\s*(Error|TimeoutError|expect|Expected)/.test(lines[j])) { err = stripAnsi(lines[j]).trim(); break; }
      }
      failures.push({ name, file: fileMatch ? fileMatch[1] : '', error: err.slice(0, 400) });
    }
  }
  return failures;
}

/**
 * @returns {{framework:string,total:number,passed:number,failed:number,skipped:number,durationMs:number,confidence:string,failures:Array,summaryLine:string}}
 */
export function parseTestOutput(stdout, stderr = '', { exitCode = null, suite = 'unit' } = {}) {
  const text = stripAnsi(`${stdout || ''}\n${stderr || ''}`);
  const detectors = [
    { name: 'vitest', summary: parseVitestSummary, failures: parseVitestFailures },
    { name: 'jest', summary: parseJestSummary, failures: parseJestFailures },
    { name: 'playwright', summary: parsePlaywrightSummary, failures: parsePlaywrightFailures },
  ];

  let best = null;
  for (const d of detectors) {
    let summary;
    try { summary = d.summary(text); } catch { summary = null; }
    if (!summary) continue;
    const score = d.name === 'playwright' && suite === 'e2e' ? 2 : 1;
    if (!best || score > best.score) best = { name: d.name, summary, failures: d.failures, score };
  }

  if (!best) {
    // No recognisable summary. Report unknown instead of fabricating counts.
    const looksLikeTestFailure = exitCode !== null && exitCode !== 0;
    return {
      ...emptyResult('unknown', CONFIDENCE.UNKNOWN),
      framework: 'unknown',
      failed: 0,
      passed: 0,
      total: 0,
      exitCode,
      parserNote: looksLikeTestFailure
        ? 'test command failed but output did not match a supported reporter format (vitest/jest/playwright)'
        : 'no recognisable test summary found in output',
    };
  }

  let failures = [];
  try { failures = best.failures(text).slice(0, 100); } catch { failures = []; }

  // Cross-check with exit code: if the reporter says 0 failed but the process failed, downgrade confidence.
  let confidence = CONFIDENCE.HIGH;
  if (exitCode !== null && exitCode !== 0 && best.summary.failed === 0) confidence = CONFIDENCE.LOW;
  if (best.summary.total === 0) confidence = CONFIDENCE.LOW;

  return {
    ...best.summary,
    framework: best.name,
    durationMs: parseDuration(text, best.name),
    confidence,
    failures,
    exitCode,
    parserNote: '',
  };
}

export function describeParsers() {
  return [
    { framework: 'vitest', summaryPattern: 'Tests  N failed | N passed (N)' },
    { framework: 'jest', summaryPattern: 'Tests: N failed, N passed, N total' },
    { framework: 'playwright', summaryPattern: 'N passed / N failed (+ failure list)' },
  ];
}
