#!/usr/bin/env node
/**
 * CLI entry point.
 *   node src/server/cli.js dev|start [--port 8787]
 *   node src/server/cli.js seed-demo [--rebuild]
 *   node src/server/cli.js build      (validates that every module and web asset is present & parseable)
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from '../core/app.js';
import { buildRouter } from './routes.js';
import { createHttpServer, WEB_ROOT } from './http-server.js';
import { logger } from '../core/logger.js';
import { checkSyntaxAll } from '../../tools/syntax.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { args[k] = argv[i + 1]; i += 1; }
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

async function serve(args) {
  const port = Number(args.port || process.env.PORT || 8787);
  const host = args.host || '127.0.0.1';
  const app = new App({ dataDir: process.env.COMMANDER_DATA_DIR || undefined, logLevel: args.verbose ? 'debug' : (process.env.COMMANDER_LOG_LEVEL || 'info') });
  const router = buildRouter(app);
  const server = createHttpServer({ router, app });
  app.startBackground();

  // Demo mode: make sure a first-run experience is never an empty screen (requirement #59 / #50).
  if (app.listProjects().length === 0 && args.demo !== 'false') {
    logger.info('first_run_seeding_demo');
    await app.seedDemoAndAnalyze({ runCommands: true });
  }

  // Auto-fallback: if the port is taken by another local app, walk up instead of crashing.
  let bound = port;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = port + attempt;
    try {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
        const onListening = () => { server.removeListener('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate, host);
      });
      bound = candidate;
      break;
    } catch (err) {
      if (attempt === 19 || (err.code !== 'EADDRINUSE' && err.code !== 'EACCES')) {
        throw new Error(`could not bind ${host}:${candidate} — ${err.message}`);
      }
      logger.warn('port_busy', { port: candidate });
    }
  }
  const url = `http://${host}:${bound}`;
  logger.info('server_listening', { url, dataDir: app.dataDir, db: app.dbFile });
  // Persist the actual URL so launchers (see 启动.bat) can open the right address
  // even when the port auto-fallback kicked in.
  try {
    fs.writeFileSync(path.join(app.dataDir, 'server-url.txt'), url, 'utf8');
  } catch (err) {
    logger.warn('server_url_write_failed', { error: err.message });
  }
  process.stdout.write(`\n  AI Project Commander\n  ─────────────────────\n  URL       ${url}\n  API       ${url}/api/dashboard\n  Data dir  ${app.dataDir}\n  Provider  ${app.providerRegistry.activeName}\n  Demo      ${app.listProjects().filter((p) => p.is_demo).length} project(s)\n\n`);

  const shutdown = () => {
    logger.info('shutting_down');
    app.stopBackground();
    server.close(() => { app.db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function seedDemo(args) {
  const app = new App();
  const results = await app.seedDemoAndAnalyze({ rebuild: args.rebuild === true, runCommands: args.commands !== 'false' });
  const dashboard = app.dashboard();
  process.stdout.write(`\n  Demo seed complete\n  ──────────────────\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.skipped ? '(exists) ' : ''}${r.projectId}  health=${r.health || 'n/a'}  gate=${r.gate || 'n/a'}  files=${r.files ?? 'n/a'}\n`);
  }
  process.stdout.write(`\n  Dashboard: ${JSON.stringify(dashboard.counts)}\n  Data dir: ${app.dataDir}\n\n`);
  app.stopBackground();
  app.db.close();
}

async function build() {
  const errors = [];
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'tests'));
  walk(path.join(ROOT, 'tools'));
  walk(path.join(ROOT, 'scripts'));
  const results = await checkSyntaxAll(files);
  for (const r of results) {
    if (!r.ok) errors.push(`${path.relative(ROOT, r.file).replace(/\\/g, '/')}: ${r.reason}`);
  }

  const requiredWeb = ['index.html', 'app.js', 'styles.css', 'api.js', 'router.js', 'ui.js', 'views/dashboard.js', 'views/project.js', 'views/settings.js', 'views/attention.js', 'views/search.js'];
  for (const f of requiredWeb) {
    if (!fs.existsSync(path.join(WEB_ROOT, f))) errors.push(`missing web asset: src/web/${f}`);
  }
  if (!fs.existsSync(path.join(ROOT, 'README.md'))) errors.push('missing README.md');
  for (const f of ['PROJECT_STATE.md', 'MASTER_PLAN.md', 'NEXT_ACTION.md', 'DECISIONS.md', 'TEST_STATUS.md', 'KNOWN_ISSUES.md', 'CHANGELOG_DEV.md', 'ARCHITECTURE.md', 'RECOVERY.md']) {
    if (!fs.existsSync(path.join(ROOT, 'docs', 'agent', f))) errors.push(`missing agent memory file: docs/agent/${f}`);
  }

  if (errors.length) {
    process.stderr.write(`\n  Build check FAILED (${errors.length} problem(s))\n`);
    errors.slice(0, 50).forEach((e) => process.stderr.write(`   - ${e}\n`));
    process.exit(1);
  }
  process.stdout.write(`\n  Build check PASSED — all modules parse, web assets present, agent memory complete.\n\n`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'dev';
switch (command) {
  case 'dev':
  case 'start':
    await serve(args);
    break;
  case 'seed-demo':
    await seedDemo(args);
    break;
  case 'build':
    await build();
    break;
  default:
    process.stderr.write(`unknown command: ${command}\nusage: cli.js dev|start|seed-demo|build [--port 8787]\n`);
    process.exit(2);
}
