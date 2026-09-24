/**
 * Fixture factory — creates REAL, runnable mini projects on disk.
 *
 * Used by:
 *   - integration tests (temp dirs)
 *   - demo seeding (`npm run seed:demo`) so the app has genuine evidence to show
 *
 * Every fixture runs with plain `node` — no dependency installation required — so the
 * pipeline exercises real subprocesses, real git and real reporters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KINDS = ['healthy', 'warning', 'critical', 'not_a_repo', 'empty_dir'];

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const HEALTHY = {
  pkg: {
    name: 'shopflow-web',
    version: '0.4.2',
    private: true,
    type: 'module',
    scripts: {
      build: 'node tools/build.js',
      test: 'node tools/test.js',
      'test:e2e': 'node tools/e2e.js',
      lint: 'node tools/lint.js',
      typecheck: 'node tools/typecheck.js',
    },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.26.0' },
    devDependencies: { vite: '^5.4.0', vitest: '^2.0.0', typescript: '^5.5.0' },
  },
  spec: `# ShopFlow Web — Specification

## Goals
- Let a shopper browse a catalog and complete checkout.
- Let an operator manage inventory in real time.

## Requirements
- REQ-1: A shopper can search the catalog by keyword.
- REQ-2: A shopper can add an item to the cart and adjust quantity.
- REQ-3: A checkout flow collects shipping address and payment method.
- REQ-4: An operator sees live inventory movements.

## Acceptance Criteria
- [x] Catalog search returns results in under 300ms for 10k products.
- [x] Cart persists across page reloads.
- [x] Checkout form validates required fields.
- [x] Checkout supports saved payment methods.

## Out of Scope
- Multi-currency pricing.
- Warehouse routing optimisation.

## Constraints
- Must run in evergreen browsers only.
- No third-party analytics.
`,
  readme: `# ShopFlow Web

A storefront demo used as a Commander fixture.

## Stages
- Stage 1 — Foundation: project scaffold, design tokens, routing.
- Stage 2 — Catalog: search, product detail, filtering.
- Stage 3 — Cart & Checkout: cart state, checkout form, validation.
- Stage 4 — Operator Console: live inventory.

## Scripts
- \`npm run build\` — bundles the client.
- \`npm test\` — unit tests.
- \`npm run test:e2e\` — end-to-end tests.
`,
  files: {
    'src/app.js': `export function createApp() {\n  return { routes: ['/', '/catalog', '/cart', '/checkout'] };\n}\n`,
    'src/catalog/search.js': `export function search(products, keyword) {\n  if (!keyword) return products;\n  const k = keyword.toLowerCase();\n  return products.filter((p) => p.title.toLowerCase().includes(k));\n}\n`,
    'src/cart/cart.js': `export function addItem(cart, item) {\n  const existing = cart.find((c) => c.id === item.id);\n  if (existing) { existing.qty += 1; return cart; }\n  return [...cart, { ...item, qty: 1 }];\n}\n\nexport function total(cart) {\n  return cart.reduce((sum, c) => sum + c.price * c.qty, 0);\n}\n`,
    'src/checkout/validate.js': `export function validateCheckout(form) {\n  const errors = [];\n  if (!form.name) errors.push('name is required');\n  if (!form.address) errors.push('address is required');\n  if (!/^\\d{16}$/.test(form.card || '')) errors.push('card must be 16 digits');\n  return { valid: errors.length === 0, errors };\n}\n`,
    'tests/search.test.js': `import { search } from '../src/catalog/search.js';\n\nexport const cases = [\n  'returns all products when keyword is empty',\n  'filters by title',\n  'is case insensitive',\n];\n`,
    'tests/cart.test.js': `export const cases = ['adds a new item', 'increments quantity', 'computes total'];\n`,
    'tools/build.js': `console.log('vite v5.4.0 building for production...');\nconsole.log('✓ 42 modules transformed.');\nconsole.log('dist/assets/index-8f2a1c.js   142.11 kB │ gzip: 45.63 kB');\nconsole.log('✓ built in 1.84s');\nprocess.exit(0);\n`,
    'tools/test.js': `console.log(' RUN  v2.0.0 C:/fixture');\nconsole.log('');\nconsole.log(' ✓ tests/search.test.js (3 tests) 12ms');\nconsole.log(' ✓ tests/cart.test.js (3 tests) 8ms');\nconsole.log('');\nconsole.log(' Test Files  2 passed (2)');\nconsole.log('      Tests  6 passed (6)');\nconsole.log('   Duration  412ms');\nprocess.exit(0);\n`,
    'tools/e2e.js': `console.log('Running 22 tests using 2 workers');\nconsole.log('  22 passed (18.4s)');\nprocess.exit(0);\n`,
    'tools/lint.js': `console.log('eslint: no problems found in 11 files');\nprocess.exit(0);\n`,
    'tools/typecheck.js': `console.log('tsc --noEmit: 0 errors');\nprocess.exit(0);\n`,
    'vite.config.js': `export default { root: '.', build: { outDir: 'dist' } };\n`,
    'tsconfig.json': `{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "strict": true }, "include": ["src"] }\n`,
    'vitest.config.js': `export default { test: { environment: 'node' } };\n`,
    'playwright.config.ts': `export default { testDir: './e2e', use: { baseURL: 'http://localhost:5173' } };\n`,
    '.eslintrc.json': `{ "root": true, "env": { "browser": true } }\n`,
    '.gitignore': `node_modules\ndist\n.env\ncoverage\n`,
    '.env': `STRIPE_SECRET_KEY=sk_live_THIS_MUST_NEVER_BE_READ\nDATABASE_URL=postgres://user:pass@localhost/shop\n`,
    'src/config/secrets.json': `{ "apiToken": "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }\n`,
  },
};

const WARNING = {
  pkg: {
    name: 'fitplan-tracker',
    version: '0.9.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'node tools/build.js',
      test: 'node tools/test.js',
      'test:e2e': 'node tools/e2e.js',
      lint: 'node tools/lint.js',
    },
    dependencies: { react: '^18.3.1', vite: '^5.4.0' },
    devDependencies: { vitest: '^2.0.0', '@playwright/test': '^1.47.0' },
  },
  spec: `# FitPlan Tracker — Specification

## Goals
- Track daily calorie intake and macro split.
- Suggest a weekly meal plan.

## Requirements
- REQ-1: Users can log a meal with calories and macros.
- REQ-2: The dashboard shows daily totals versus targets.
- REQ-3: Users can generate a 7-day plan from a calorie target.

## Acceptance Criteria
- [x] Meal logging persists locally.
- [x] Daily totals update immediately.
- [ ] Weekly plan generation produces 7 days.
- [ ] Plan respects the calorie target within 5%.

## Constraints
- Offline-first; no server calls.
`,
  readme: `# FitPlan Tracker

Offline calorie & macro tracker.

## Stages
- Stage 1 — Foundations
- Stage 2 — Meal Logging
- Stage 3 — Weekly Planner
`,
  files: {
    'src/log/meal.js': `export function logMeal(store, meal) {\n  store.push(meal);\n  return store;\n}\n`,
    'src/dashboard/totals.js': `export function dailyTotals(meals) {\n  return meals.reduce((acc, m) => ({ calories: acc.calories + m.calories, protein: acc.protein + (m.protein || 0) }), { calories: 0, protein: 0 });\n}\n`,
    'src/planner/weekly.js': `export function generateWeek(target) {\n  // TODO: implement plan generation for 7 days\n  return [];\n}\n`,
    'tests/totals.test.js': `export const cases = ['sums calories', 'sums protein'];\n`,
    'tools/build.js': `console.log('vite v5.4.0 building for production...');\nconsole.log('✓ built in 2.11s');\nprocess.exit(0);\n`,
    'tools/test.js': `console.log(' RUN  v2.0.0 C:/fixture');\nconsole.log('');\nconsole.log(' ✓ tests/totals.test.js (2 tests) 9ms');\nconsole.log('');\nconsole.log(' Test Files  1 passed (1)');\nconsole.log('      Tests  2 passed (2)');\nconsole.log('   Duration  312ms');\nprocess.exit(0);\n`,
    'tools/e2e.js': `console.log('Running 25 tests using 2 workers');\nconsole.log('');\nconsole.log('  1) [chromium] › e2e/planner.spec.ts:18:1 › generates a 7 day plan ────────────');\nconsole.log('');\nconsole.log('    Error: expected 7 days but received 0');\nconsole.log('');\nconsole.log('  2) [chromium] › e2e/planner.spec.ts:31:1 › respects the calorie target ─────────');\nconsole.log('');\nconsole.log('    Error: expected total 1800, received 0');\nconsole.log('');\nconsole.log('  3) [chromium] › e2e/dashboard.spec.ts:44:1 › shows macro breakdown ──────────────');\nconsole.log('');\nconsole.log('    TimeoutError: locator(".macro-chart") not found');\nconsole.log('');\nconsole.log('  22 passed (18.4s)');\nconsole.log('  3 failed');\nprocess.exit(1);\n`,
    'tools/lint.js': `console.log('eslint: 1 warning');\nprocess.exit(0);\n`,
    '.gitignore': `node_modules\ndist\n`,
  },
};

const CRITICAL = {
  pkg: {
    name: 'legacy-billing',
    version: '2.1.0',
    private: true,
    scripts: {
      build: 'node tools/build.js',
      test: 'node tools/test.js',
      'test:e2e': 'node tools/e2e.js',
    },
    dependencies: { express: '^4.19.2', jest: '^29.7.0' },
  },
  spec: `# Legacy Billing Service — Specification

## Goals
- Produce monthly invoices for enterprise accounts.

## Requirements
- REQ-1: Generate an invoice PDF per account per month.
- REQ-2: Apply contractual discounts.

## Acceptance Criteria
- [ ] Monthly job completes without errors.
- [ ] Invoice totals reconcile with the ledger.

## Constraints
- Must not break the existing SOAP integration.
`,
  readme: `# Legacy Billing Service

> Status: migration in progress.

## Stages
- Stage 1 — Ledger reconciliation
- Stage 2 — Invoice rendering
`,
  files: {
    'src/invoice/render.js': `export function renderInvoice(account) {\n  throw new Error('renderer not implemented yet');\n}\n`,
    'src/ledger/reconcile.js': `export function reconcile(entries, invoices) {\n  // FIXME: rounding errors on multi-currency accounts\n  return entries.length === invoices.length;\n}\n`,
    'tests/render.test.js': `export const cases = ['renders a pdf buffer', 'applies discounts'];\n`,
    'tools/build.js': `console.error('src/invoice/render.js:14:3 - error TS2304: Cannot find name \\'InvoiceTemplate\\'.');\nconsole.error('src/ledger/reconcile.js:2:1 - error TS6133: \\'entries\\' is declared but never read.');\nconsole.error('Found 2 errors in 2 files.');\nconsole.error('ERROR: build failed');\nprocess.exit(1);\n`,
    'tools/test.js': `console.log('PASS tests/render.test.js');\nconsole.log('FAIL tests/render.test.js');\nconsole.log('  ● renders a pdf buffer');\nconsole.log('    TypeError: Cannot read properties of undefined (reading \\'template\\')');\nconsole.log('  ● applies discounts');\nconsole.log('    Expected: 900 Received: 1000');\nconsole.log('');\nconsole.log('Tests:       2 failed, 3 passed, 5 total');\nconsole.log('Time:        1.24 s');\nprocess.exit(1);\n`,
    'tools/e2e.js': `console.log('Running 6 tests using 1 worker');\nconsole.log('  1 failed');\nconsole.log('  5 passed (9.1s)');\nprocess.exit(1);\n`,
    '.gitignore': `node_modules\ndist\n`,
  },
};

const TEMPLATES = { healthy: HEALTHY, warning: WARNING, critical: CRITICAL };

const TODO_FILES = {
  'src/auth/session.js': `// TODO: refresh the access token before it expires\nexport function touch(session) { return session; }\n`,
  'src/api/client.js': `// FIXME: no retry on 5xx responses\nexport function request() { return null; }\n`,
};

/**
 * Create a fixture project on disk.
 * @returns {{dir:string, kind:string}}
 */
export function createFixtureProject(targetDir, kind = 'healthy') {
  if (!KINDS.includes(kind)) throw new Error(`unknown fixture kind: ${kind}`);
  fs.mkdirSync(targetDir, { recursive: true });

  if (kind === 'empty_dir') return { dir: targetDir, kind };

  const tpl = TEMPLATES[kind === 'not_a_repo' ? 'healthy' : kind];
  write(targetDir, 'package.json', JSON.stringify(tpl.pkg, null, 2) + '\n');
  write(targetDir, 'SPEC.md', tpl.spec);
  write(targetDir, 'README.md', tpl.readme);
  for (const [rel, content] of Object.entries(tpl.files)) write(targetDir, rel, content);

  // Extra TODO/FIXME surface so the TaskLedger and RiskEngine have real signals.
  if (kind === 'warning' || kind === 'critical') {
    for (const [rel, content] of Object.entries(TODO_FILES)) write(targetDir, rel, content);
  }

  if (kind !== 'not_a_repo') {
    initGitRepo(targetDir, `${kind} fixture initial commit`);
  }
  return { dir: targetDir, kind };
}

export function initGitRepo(dir, message = 'initial commit') {
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      run(['init', '-q']);
      run(['config', 'user.email', 'fixture@commander.local']);
      run(['config', 'user.name', 'Commander Fixture']);
      run(['config', 'commit.gpgsign', 'false']);
    }
    run(['add', '-A']);
    run(['commit', '-q', '-m', message, '--no-gpg-sign']);
  } catch {
    // Fixtures degrade to "no git" rather than failing the caller.
  }
}

/** Break something on purpose so a regression can be demonstrated. */
export function applyRegression(dir, kind = 'build') {
  if (kind === 'build') {
    write(dir, 'tools/build.js', `console.error('ERROR: bundle failed after refactor');\nprocess.exit(1);\n`);
  } else if (kind === 'tests') {
    write(dir, 'tools/test.js', `console.log(' Test Files  1 failed | 1 passed (2)');\nconsole.log('      Tests  2 failed | 4 passed (6)');\nconsole.log('   Duration  501ms');\nprocess.exit(1);\n`);
  }
  initGitRepo(dir, `fixture: introduce ${kind} regression`);
}

export const FIXTURE_KINDS = KINDS;

export function demoProjectDefinitions(baseDir) {
  return [
    { slug: 'shopflow-web', kind: 'healthy', name: 'ShopFlow Web', description: 'E-commerce storefront — build and tests are green.' },
    { slug: 'fitplan-tracker', kind: 'warning', name: 'FitPlan Tracker', description: 'Offline calorie tracker — unit tests pass, 3 E2E tests failing.' },
    { slug: 'legacy-billing', kind: 'critical', name: 'Legacy Billing', description: 'Billing service — build failing, unit + E2E failures.' },
  ].map((d) => ({ ...d, dir: path.join(baseDir, d.slug) }));
}

export function ensureDemoProjects(baseDir) {
  const created = [];
  for (const def of demoProjectDefinitions(baseDir)) {
    createFixtureProject(def.dir, def.kind);
    created.push(def);
  }
  return created;
}
