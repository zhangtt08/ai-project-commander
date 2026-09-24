#!/usr/bin/env node
/**
 * Cross-platform test runner.
 * `node --test <dir>` is not reliable across Node versions/platforms, so the file list is
 * resolved here and passed explicitly. Uses async spawn (spawnSync returns EBUSY in sandbox).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { collect(p, out); continue; }
    if (/\.test\.js$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith('--')) || '--all';
const dirs = mode === '--unit' ? ['tests/unit']
  : mode === '--integration' ? ['tests/integration']
    : ['tests/unit', 'tests/integration'];

const files = dirs.flatMap((d) => collect(path.join(ROOT, d)));
if (!files.length) {
  process.stderr.write(`No test files found in: ${dirs.join(', ')}\n`);
  process.exit(1);
}

const runnerArgs = ['--test', '--test-force-exit', '--test-reporter=spec', ...files.map((f) => path.relative(ROOT, f))];
const child = spawn(process.execPath, runnerArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning' },
});

child.on('close', (code) => process.exit(code === null ? 1 : code));
