#!/usr/bin/env node
/**
 * One-shot verification: static checks + build check + unit + integration tests.
 * This is the command a fresh agent (or CI) runs first. See docs/agent/RECOVERY.md.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function run(name, args, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ name, code: code === null ? 1 : code, out, durationMs: Date.now() - started });
    });
  });
}

const steps = [
  { name: 'typecheck', args: ['tools/typecheck.js'] },
  { name: 'lint', args: ['tools/lint.js'] },
  { name: 'build', args: ['src/server/cli.js', 'build'] },
  { name: 'unit tests', args: ['scripts/run-tests.js', '--unit'] },
  { name: 'integration tests', args: ['scripts/run-tests.js', '--integration'] },
];

let failed = 0;
for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`);
  const res = await run(step.name, step.args);
  const tail = res.out.trim().split('\n').filter(Boolean).slice(-4).map((l) => `    ${l}`).join('\n');
  process.stdout.write(`${tail}\n`);
  const ok = res.code === 0;
  if (!ok) failed += 1;
  results.push({ name: step.name, ok, durationMs: res.durationMs });
  process.stdout.write(`${ok ? '  ✔ PASS' : '  ✖ FAIL'} (${(res.durationMs / 1000).toFixed(1)}s)\n`);
  if (!ok) {
    process.stdout.write(`  ---- output tail ----\n${res.out.trim().split('\n').slice(-30).map((l) => `  ${l}`).join('\n')}\n`);
  }
}

process.stdout.write('\n══════════ VERIFICATION SUMMARY ══════════\n');
for (const r of results) {
  process.stdout.write(`  ${r.ok ? '✔' : '✖'} ${r.name.padEnd(20)} ${(r.durationMs / 1000).toFixed(1)}s\n`);
}
process.stdout.write(`\n  ${results.filter((r) => r.ok).length}/${results.length} checks passed\n`);
process.stdout.write('  E2E is run separately: npm run test:e2e (real Chromium, ~1 min)\n\n');
process.exit(failed ? 1 : 0);
