#!/usr/bin/env node
/**
 * E2E orchestrator: seeds demo data into an isolated data dir, starts the real server,
 * runs the Python Playwright suite against it, then tears everything down.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const PORT = Number(process.env.E2E_PORT || 8791);
const DATA = process.env.E2E_DATA_DIR || path.join(os.tmpdir(), `apc-e2e-${Date.now()}`);
const PY = process.env.E2E_PYTHON || 'python';

const log = (m) => process.stdout.write(`${m}\n`);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...opts.env }, windowsHide: true });
    let out = '';
    if (opts.capture) {
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
    }
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function waitReady(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server did not become ready at ${url}`);
}

let exitCode = 1;
let server = null;
try {
  log(`[e2e] data dir: ${DATA}`);
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  log('[e2e] seeding demo projects (real builds + tests, ~1 minute)…');
  const seeded = await run(NODE, ['src/server/cli.js', 'seed-demo'], { capture: true, env: { COMMANDER_DATA_DIR: DATA } });
  if (seeded.code !== 0) throw new Error(`seed failed:\n${seeded.out}`);
  // Guard: seed-demo once built its App without COMMANDER_DATA_DIR and wrote demo projects
  // into the user's real database. Refuse to continue if the isolation ever breaks again.
  const usedDir = (String(seeded.out).match(/Data dir:\s*(.+)/) || [])[1];
  if (!usedDir) throw new Error('seed produced no "Data dir:" line — cannot verify isolation');
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (norm(usedDir) !== norm(DATA)) {
    throw new Error(
      `E2E isolation broken: seed wrote to ${usedDir} but the harness asked for ${DATA}. `
      + 'Refusing to start — this would pollute a real database.',
    );
  }
  log('[e2e] seed complete');

  log(`[e2e] starting server on port ${PORT}…`);
  server = spawn(NODE, ['src/server/cli.js', 'start', '--port', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, COMMANDER_DATA_DIR: DATA, COMMANDER_LOG_LEVEL: 'error' },
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  await waitReady(base);
  log(`[e2e] server ready at ${base}`);

  const py = await run(PY, ['e2e/e2e_test.py'], { env: { E2E_BASE_URL: base, E2E_ARTIFACTS: path.join(ROOT, '.e2e-artifacts') } });
  exitCode = py.code;
  if (py.code !== 0 && !py.out) log(py.out || '[e2e] python runner produced no output');
} catch (err) {
  log(`[e2e] FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  if (server) { try { server.kill(); } catch { /* noop */ } }
}

log(`[e2e] screenshots in ${path.join(ROOT, '.e2e-artifacts')}`);
process.exit(exitCode);
