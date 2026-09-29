#!/usr/bin/env node
/**
 * Static policy checks. These encode the project's architectural rules so they cannot
 * silently regress (ADR-003, ADR-004, ADR-009).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'data' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const SRC = walk(path.join(ROOT, 'src'));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

for (const file of SRC) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const loc = `${r}:${i + 1}`;
    if (/^\s*(import|export)[^\n]*from\s+['"]node:child_process['"]/.test(line) || /require\(['"]child_process['"]\)/.test(line)) {
      // command-runner.js       : the ONLY runtime process spawn (ADR-003)
      // demo/fixture-factory.js : git init/commit on Commander's OWN demo projects
      //                           (data/demo-projects) so demo data has real history
      const childProcessAllowed = ['src/core/command-runner.js', 'src/demo/fixture-factory.js'];
      if (!childProcessAllowed.includes(r)) {
        violations.push(`${loc} — child_process may only be used by ${childProcessAllowed.join(', ')} (ADR-003)`);
      }
    }
    if (/^\s*(import|export)[^\n]*from\s+['"]node:fs['"]/.test(line) || /from\s+['"]node:fs\/promises['"]/.test(line)) {
      // fs-safe.js  : the single audited read path
      // logger.js   : appends to Commander's own log file
      // database.js : creates the data directory
      // jobs.js     : fs.watch on managed workspaces (read-only)
      // app.js      : creates the data/demo directories only
      // command-runner.js : executable lookup + cwd existence probe
      // demo/fixture-factory.js : writes ONLY under Commander's own data/demo-projects
      //                           directory (never into a managed workspace, ADR-009)
      const allowed = [
        'src/core/fs-safe.js', 'src/core/logger.js', 'src/db/database.js',
        'src/core/jobs.js', 'src/core/app.js', 'src/core/command-runner.js',
        'src/demo/fixture-factory.js',
        // workspace-resolver.js: read-only directory probing for drag & drop
        // import (readdirSync/statSync/existsSync only — never writes, ADR-009)
        'src/core/workspace-resolver.js',
        // discovery.js: read-only machine-wide walk for "这台电脑上有哪些项目"
        // (readdirSync/statSync only, never writes — ADR-009 holds)
        'src/core/discovery.js',
        // source-purge.js: the ONE user-initiated deletion path. It is exempt from the
        // read-only rule by design (the product requirement is 删除项目后清除源文件),
        // but assessPurgeTarget() refuses drive roots / home / Desktop / shallow paths /
        // Commander's own data dir, and purgeDirectory() demands an echoed token.
        // Guarded by tests/unit/source-purge.test.js.
        'src/core/source-purge.js',
      ];
      if (r.startsWith('src/core/') && !allowed.includes(r)) {
        violations.push(`${loc} — direct node:fs import in src/core is not allowed outside ${allowed.join(', ')} (ADR-004/ADR-009)`);
      }
      if (r.startsWith('src/domain/')) {
        violations.push(`${loc} — the domain layer must not touch the filesystem`);
      }
    }
    if (/\b(fs\.)?(writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rmdirSync|unlinkSync|unlink|renameSync|rename|mkdirSync|copyFileSync|createWriteStream)\s*\(/.test(line)) {
      // demo/fixture-factory.js writes ONLY into Commander's own data/demo-projects
      // directory when seeding demo data — never into a managed workspace (ADR-009,
      // enforced by tests/integration/security.test.js).
      const allowed = ['src/core/fs-safe.js', 'src/core/logger.js', 'src/db/database.js', 'src/core/app.js', 'src/server/cli.js', 'src/server/routes.js', 'src/demo/fixture-factory.js', 'src/core/source-purge.js'];
      if (r.startsWith('src/') && !allowed.includes(r)) {
        violations.push(`${loc} — filesystem write operations are restricted (ADR-009); found in ${r}`);
      }
    }
    if (/\.innerHTML\s*=/.test(line) && !/static|allowed|self-authored|none/.test(line)) {
      const inUi = r === 'src/web/ui.js';
      if (!inUi) warnings.push(`${loc} — innerHTML assignment outside ui.js; prefer textContent (XSS surface)`);
    }
    if (/\bJSON\.parse\s*\(/.test(line) && r.startsWith('src/core/ai/') && !r.endsWith('structured.js') && !/safeJsonParse|try\s*\{|catch/.test(lines.slice(Math.max(0, i - 3), i + 3).join(' '))) {
      warnings.push(`${loc} — JSON.parse inside AI code should go through structured.js / safeJsonParse (ADR-008)`);
    }
    if (/: any\b|as any\b|@ts-ignore|@ts-nocheck/.test(line)) {
      violations.push(`${loc} — type-escape hatch detected (no-any rule)`);
    }
    if (/eval\s*\(|new Function\s*\(/.test(line)) {
      violations.push(`${loc} — eval / new Function is forbidden`);
    }
  });

  if (r.startsWith('src/')) {
    // Only real comment markers count — several modules legitimately contain the
    // literal strings "TODO"/"FIXME" because they DETECT them.
    const count = (text.match(/(?:\/\/|\*)\s*(TODO|FIXME)\b[^:\n]*/g) || []).length;
    if (count) warnings.push(`${r} — contains ${count} TODO/FIXME comment marker(s)`);
  }
}

// Domain layer purity: no imports from core/db/server/web.
for (const file of SRC.filter((f) => rel(f).startsWith('src/domain/'))) {
  const text = fs.readFileSync(file, 'utf8');
  const bad = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((p) => /\.\.\/(core|db|server|web)\//.test(p));
  if (bad.length) violations.push(`${rel(file)} — domain layer imports an upper layer: ${bad.join(', ')}`);
}

process.stdout.write(`\n  Lint: ${SRC.length} source file(s) scanned\n`);
if (warnings.length) {
  process.stdout.write(`  ${warnings.length} warning(s):\n`);
  warnings.slice(0, 40).forEach((w) => process.stdout.write(`   ~ ${w}\n`));
}
if (violations.length) {
  process.stderr.write(`  ${violations.length} VIOLATION(S):\n`);
  violations.forEach((v) => process.stderr.write(`   ! ${v}\n`));
  process.exit(1);
}
process.stdout.write('  No policy violations.\n\n');
