/**
 * Ad-hoc smoke harness used during development.
 * Usage: node scripts/smoke.js [stage]
 * This is a developer tool, not part of the app runtime.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createFixtureProject } from '../src/demo/fixture-factory.js';
import { ProjectScanner } from '../src/core/scanner.js';
import { CommandRunner } from '../src/core/command-runner.js';
import { GitAnalyzer } from '../src/core/git-analyzer.js';
import { TestAnalyzer } from '../src/core/analyzers/test-analyzer.js';
import { BuildAnalyzer } from '../src/core/analyzers/build-analyzer.js';
import { parseTestOutput } from '../src/core/test-parser.js';

const stage = process.argv[2] || 'all';
const base = path.join(os.tmpdir(), `apc-smoke-${Date.now()}`);
fs.mkdirSync(base, { recursive: true });

async function stageScan() {
  const { dir } = createFixtureProject(path.join(base, 'warning'), 'warning');
  const meta = await new ProjectScanner().scan(dir);
  console.log('SCAN', { ok: meta.ok, lang: meta.primaryLanguage, fw: meta.framework, pm: meta.packageManager, files: meta.fileCount, markers: meta.todos.length, sensitive: meta.sensitiveCount });
  const healthy = createFixtureProject(path.join(base, 'healthy'), 'healthy');
  const meta2 = await new ProjectScanner().scan(healthy.dir);
  console.log('SENSITIVE', JSON.stringify(meta2.sensitiveFiles));
  console.log('READ_AUDIT', JSON.stringify(meta2.readAudit));
  return dir;
}

async function stageCommands() {
  const { dir } = createFixtureProject(path.join(base, 'cmd'), 'warning');
  const meta = await new ProjectScanner().scan(dir);
  const runner = new CommandRunner();
  for (const script of ['build', 'test', 'test:e2e']) {
    const args = script === 'test' ? ['test'] : ['run', script];
    const res = await runner.run({ command: 'npm', args, cwd: dir });
    console.log('RUN', script, { exit: res.exitCode, ok: res.ok, shim: res.shimmed, ms: res.durationMs });
    if (script === 'test' || script === 'test:e2e') {
      const p = parseTestOutput(res.stdout, res.stderr, { exitCode: res.exitCode, suite: script === 'test' ? 'unit' : 'e2e' });
      console.log('   parsed', { fw: p.framework, total: p.total, passed: p.passed, failed: p.failed, conf: p.confidence, failures: p.failures.map((f) => f.name) });
    }
  }
  const analyzer = new TestAnalyzer({ runner });
  const run = await analyzer.runSuite({ root: dir, metadata: meta }, 'e2e');
  console.log('TEST_ANALYZER', { status: run.status, total: run.total, failed: run.failed, framework: run.framework, cases: run.cases.length });
  const b = await new BuildAnalyzer({ runner }).run({ root: dir, metadata: meta }, 'build');
  console.log('BUILD_ANALYZER', { status: b.status, exit: b.exitCode, ms: b.durationMs });
  const g = await new GitAnalyzer({ runner }).analyze(dir);
  console.log('GIT', { repo: g.isRepository, branch: g.branch, head: g.commitShort, clean: g.workingTreeClean, commits: g.recentCommits.length });
  return dir;
}

async function stageCritical() {
  const { dir } = createFixtureProject(path.join(base, 'critical'), 'critical');
  const meta = await new ProjectScanner().scan(dir);
  const runner = new CommandRunner();
  const build = await new BuildAnalyzer({ runner }).run({ root: dir, metadata: meta }, 'build');
  console.log('CRITICAL BUILD', { status: build.status, exit: build.exitCode });
  const analyzer = new TestAnalyzer({ runner });
  const unit = await analyzer.runSuite({ root: dir, metadata: meta }, 'unit');
  console.log('CRITICAL UNIT', { status: unit.status, total: unit.total, failed: unit.failed, framework: unit.framework, cases: unit.cases.map((c) => c.name) });
  const e2e = await analyzer.runSuite({ root: dir, metadata: meta }, 'e2e');
  console.log('CRITICAL E2E', { status: e2e.status, total: e2e.total, passed: e2e.passed, failed: e2e.failed });
}

if (stage === 'scan' || stage === 'all') await stageScan();
if (stage === 'cmd' || stage === 'all') await stageCommands();
if (stage === 'critical' || stage === 'all') await stageCritical();
console.log('smoke done ->', base);
