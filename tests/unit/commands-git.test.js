import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyCommand, CommandRunner, describeSecurityModel, DANGEROUS_BINARIES, resolveInvocation } from '../../src/core/command-runner.js';
import { GitAnalyzer, gitSummaryLine } from '../../src/core/git-analyzer.js';
import { parseTestOutput, stripAnsi } from '../../src/core/test-parser.js';
import { detectCommand, detectAllCommands, parseCommandLine } from '../../src/core/build-detect.js';
import { parsePorcelainSafe } from './helpers/porcelain.js';
import { createFixtureProject, applyRegression, initGitRepo } from '../../src/demo/fixture-factory.js';
import { makeTempDir } from '../helpers/tmp.js';

const tmp = () => makeTempDir('apc-cmd-');

describe('CommandRunner security classification', () => {
  test('allows the documented read-only and validation commands', () => {
    const allowed = [
      ['git', ['status']], ['git', ['diff']], ['git', ['log', '-n', '5']], ['git', ['branch']],
      ['npm', ['run', 'build']], ['npm', ['test']], ['npm', ['run', 'lint']], ['npm', ['run', 'typecheck']],
      ['npx', ['vitest', 'run']], ['npx', ['playwright', 'test']],
    ];
    for (const [bin, args] of allowed) {
      const v = classifyCommand(bin, args);
      assert.equal(v.allowed, true, `${bin} ${args.join(' ')} should be allowed`);
    }
    assert.equal(classifyCommand('git', ['status']).klass, 'read_only');
    assert.equal(classifyCommand('npm', ['run', 'build']).klass, 'validation');
  });

  test('blocks dangerous binaries outright', () => {
    for (const bin of ['rm', 'del', 'format', 'dd', 'chmod', 'curl', 'powershell']) {
      assert.ok(DANGEROUS_BINARIES.includes(bin), `${bin} must be on the deny list`);
      const v = classifyCommand(bin, ['x']);
      assert.equal(v.allowed, false, `${bin} was allowed`);
      assert.equal(v.klass, 'dangerous');
    }
  });

  test('blocks destructive argument patterns even for allowlisted binaries', () => {
    const blocked = [
      ['git', ['reset', '--hard']],
      ['git', ['clean', '-fd']],
      ['git', ['rebase', 'main']],
      ['git', ['push', '--force', 'origin', 'main']],
      ['git', ['checkout', '--', '.']],
      ['npm', ['install', 'lodash']],
      ['npm', ['run', 'x', '&&', 'rm', '-rf', '.']],
    ];
    for (const [bin, args] of blocked) {
      const v = classifyCommand(bin, args);
      assert.equal(v.allowed, false, `${bin} ${args.join(' ')} was allowed`);
      assert.ok(v.reason);
    }
  });

  test('unknown binaries are not silently allowed', () => {
    const v = classifyCommand('notepad', ['x']);
    assert.equal(v.allowed, false);
    assert.equal(v.klass, 'potentially_mutating');
  });

  test('a blocked command never spawns a process', async () => {
    const runner = new CommandRunner();
    const res = await runner.run({ command: 'git', args: ['reset', '--hard'], cwd: process.cwd() });
    assert.equal(res.blocked, true);
    assert.equal(res.exitCode, 127);
    assert.match(res.stderr, /discards uncommitted work/);
    assert.equal(runner.recentRuns(1)[0].blocked, true);
  });

  test('reports a missing executable instead of throwing', async () => {
    const { resolveExecutable } = await import('../../src/core/command-runner.js');
    assert.equal(resolveExecutable('definitely-not-a-real-binary-xyz'), null);
    const runner = new CommandRunner();
    // An unknown binary is not allowlisted, so it is blocked before any spawn attempt.
    const res = await runner.run({ command: 'definitely-not-a-real-binary-xyz', args: [], cwd: process.cwd() });
    assert.equal(res.blocked, true);
  });

  test('reports a missing cwd instead of throwing', async () => {
    const runner = new CommandRunner();
    const res = await runner.run({ command: 'git', args: ['status'], cwd: path.join(os.tmpdir(), 'nope-xyz') });
    assert.match(res.stderr, /cwd does not exist/);
  });

  test('resolveInvocation never enables a shell for .cmd shims', () => {
    const inv = resolveInvocation('git', ['status']);
    assert.ok(!inv.error);
    assert.equal(inv.shimmed, false);
    const security = describeSecurityModel();
    assert.equal(security.shellEnabled, false);
    assert.ok(security.autoAllowed.includes('npm run build'));
  });

  test('runs a real command and captures stdout, exit code and duration', async () => {
    const runner = new CommandRunner();
    const res = await runner.run({ command: 'git', args: ['--version'], cwd: process.cwd() });
    if (res.executableMissing) return; // environment without git
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /git version/);
    assert.ok(res.durationMs >= 0);
  });
});

describe('GitAnalyzer', () => {
  test('returns a clean snapshot for a fixture repository', async () => {
    const dir = path.join(tmp(), 'repo');
    createFixtureProject(dir, 'healthy');
    const runner = new CommandRunner();
    const git = await new GitAnalyzer({ runner }).analyze(dir);
    assert.equal(git.isRepository, true);
    assert.equal(git.gitAvailable, true);
    assert.ok(git.branch.length > 0);
    assert.match(git.commitHash, /^[0-9a-f]{40}$/);
    assert.equal(git.commitShort, git.commitHash.slice(0, 7));
    assert.equal(git.workingTreeClean, true);
    assert.equal(git.untracked.length, 0);
    assert.equal(git.recentCommits.length, 1);
    assert.match(gitSummaryLine(git), /@/);
  });

  test('detects modified, added, deleted and untracked files', async () => {
    const dir = path.join(tmp(), 'dirty');
    createFixtureProject(dir, 'healthy');
    fs.writeFileSync(path.join(dir, 'src/app.js'), 'export const changed = true;\n');
    fs.writeFileSync(path.join(dir, 'src/added.js'), 'export const added = true;\n');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', 'src/added.js'], { cwd: dir, stdio: 'ignore' });
    fs.unlinkSync(path.join(dir, 'tools/lint.js'));
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'hello\n');
    const git = await new GitAnalyzer({ runner: new CommandRunner() }).analyze(dir);
    assert.equal(git.workingTreeClean, false);
    assert.ok(git.modified.includes('src/app.js'));
    assert.ok(git.added.includes('src/added.js'));
    assert.ok(git.deleted.includes('tools/lint.js'));
    assert.ok(git.untracked.includes('untracked.txt'));
  });

  test('degrades gracefully outside a repository', async () => {
    const dir = tmp();
    const git = await new GitAnalyzer({ runner: new CommandRunner() }).analyze(dir);
    assert.equal(git.isRepository, false);
    assert.match(git.error, /not a git repository/);
  });

  test('handles a repository with no commits', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    const git = await new GitAnalyzer({ runner: new CommandRunner() }).analyze(dir);
    assert.equal(git.isRepository, true);
    assert.equal(git.isUnborn, true);
    assert.match(git.error, /no commits/);
  });

  test('porcelain parsing helper handles renames and conflicts', () => {
    const parsed = parsePorcelainSafe('M  a.js\nA  b.js\nD  c.js\nR  old.js -> new.js\n?? u.txt\nUU conflict.js\n');
    assert.deepEqual(parsed.modified, ['a.js']);
    assert.deepEqual(parsed.added, ['b.js']);
    assert.deepEqual(parsed.deleted, ['c.js']);
    assert.deepEqual(parsed.renamed, [{ from: 'old.js', to: 'new.js' }]);
    assert.deepEqual(parsed.untracked, ['u.txt']);
    assert.deepEqual(parsed.conflicted, ['conflict.js']);
  });
});

describe('test output parsers', () => {
  test('parses vitest summaries and failures', () => {
    const out = [
      ' RUN  v2.0.0',
      ' ❯ tests/a.test.js (2 tests | 1 failed) 12ms',
      '   × adds two numbers',
      'AssertionError: expected 3 to be 4',
      ' Test Files  1 failed | 1 passed (2)',
      '      Tests  1 failed | 5 passed (6)',
      '   Duration  512ms',
    ].join('\n');
    const p = parseTestOutput(out, '', { exitCode: 1 });
    assert.equal(p.framework, 'vitest');
    assert.equal(p.total, 6);
    assert.equal(p.passed, 5);
    assert.equal(p.failed, 1);
    assert.equal(p.confidence, 'high');
    assert.equal(p.failures.length, 1);
    assert.match(p.failures[0].name, /adds two numbers/);
    assert.equal(p.durationMs, 512);
  });

  test('parses jest summaries and failures', () => {
    const out = [
      'FAIL tests/x.test.js',
      '  ● renders the widget',
      '    TypeError: Cannot read properties of undefined',
      '',
      'Tests:       2 failed, 3 passed, 5 total',
      'Time:        1.24 s',
    ].join('\n');
    const p = parseTestOutput(out, '', { exitCode: 1 });
    assert.equal(p.framework, 'jest');
    assert.equal(p.total, 5);
    assert.equal(p.passed, 3);
    assert.equal(p.failed, 2);
    assert.equal(p.durationMs, 1240);
    assert.equal(p.failures.length, 1);
  });

  test('parses playwright summaries including the separate failed line', () => {
    const out = [
      'Running 25 tests using 2 workers',
      '  1) [chromium] › e2e/dashboard.spec.ts:44:1 › shows macro breakdown ─────',
      '    TimeoutError: locator(".macro") not found',
      '  22 passed (18.4s)',
      '  3 failed',
    ].join('\n');
    const p = parseTestOutput(out, '', { exitCode: 1, suite: 'e2e' });
    assert.equal(p.framework, 'playwright');
    assert.equal(p.passed, 22);
    assert.equal(p.failed, 3);
    assert.equal(p.total, 25);
    assert.equal(p.failures.length, 1);
    assert.equal(p.failures[0].file, 'e2e/dashboard.spec.ts');
  });

  test('never invents counts when the format is unknown', () => {
    const p = parseTestOutput('something went wrong\n', '', { exitCode: 1 });
    assert.equal(p.framework, 'unknown');
    assert.equal(p.total, 0);
    assert.equal(p.confidence, 'unknown');
    assert.match(p.parserNote, /did not match a supported reporter/);
  });

  test('downgrades confidence when the reporter disagrees with the exit code', () => {
    const out = ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  100ms';
    const p = parseTestOutput(out, '', { exitCode: 1 });
    assert.equal(p.failed, 0);
    assert.equal(p.confidence, 'low');
  });

  test('strips ANSI escapes', () => {
    assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
  });
});

describe('build command detection', () => {
  test('detects from package.json scripts and package manager', () => {
    const metadata = {
      packageJson: { scripts: { build: 'vite build', test: 'vitest', 'test:e2e': 'playwright test', lint: 'eslint .' } },
      packageManager: 'npm', frameworks: [], configFiles: {}, directories: {},
    };
    const cmds = detectAllCommands(metadata);
    assert.equal(cmds.build.display, 'npm run build');
    assert.equal(cmds.test.display, 'npm test');
    assert.equal(cmds.e2e.display, 'npm run test:e2e');
    assert.equal(cmds.lint.display, 'npm run lint');
    assert.equal(cmds.typecheck.unsupported, true);
    assert.match(cmds.typecheck.reason, /no typecheck command detected/);
  });

  test('uses framework and config fallbacks', () => {
    const metadata = { packageJson: { scripts: {} }, packageManager: 'npm', frameworks: ['Playwright'], configFiles: { tsconfig: true, eslint: true }, directories: {} };
    assert.equal(detectCommand(metadata, 'e2e').display, 'npx playwright test');
    assert.equal(detectCommand(metadata, 'typecheck').display, 'npx tsc --noEmit');
    assert.equal(detectCommand(metadata, 'lint').display, 'npx eslint .');
  });

  test('reports unsupported instead of guessing for an unknown project', () => {
    const metadata = { packageJson: { scripts: {} }, packageManager: 'unknown', frameworks: [], configFiles: {}, directories: {} };
    for (const kind of ['build', 'test', 'e2e']) {
      assert.equal(detectCommand(metadata, kind).unsupported, true);
    }
  });

  test('respects pnpm and yarn', () => {
    const base = { packageJson: { scripts: { build: 'x' } }, frameworks: [], configFiles: {}, directories: {} };
    assert.equal(detectCommand({ ...base, packageManager: 'pnpm' }, 'build').display, 'pnpm run build');
    assert.equal(detectCommand({ ...base, packageManager: 'yarn' }, 'build').display, 'yarn run build');
  });

  test('a hand-pinned command wins over detection', () => {
    const metadata = {
      packageJson: { scripts: { build: 'vite build' } }, packageManager: 'npm',
      frameworks: [], configFiles: {}, directories: {},
      manualCommands: { build: 'npm run custom:build' },
    };
    const r = detectCommand(metadata, 'build');
    assert.equal(r.unsupported, false);
    assert.equal(r.source, 'manual');
    assert.equal(r.display, 'npm run custom:build');
    assert.deepEqual(r.args, ['run', 'custom:build']);
    // kinds without a pin still auto-detect
    assert.equal(detectCommand(metadata, 'test').unsupported, true);
  });

  test('a pin rescues a kind nothing could detect', () => {
    const metadata = { packageJson: { scripts: {} }, packageManager: 'unknown', frameworks: [], configFiles: {}, directories: {}, manualCommands: { build: 'make all' } };
    const r = detectCommand(metadata, 'build');
    assert.equal(r.unsupported, false);
    assert.equal(r.command, 'make');
    assert.deepEqual(r.args, ['all']);
  });

  test('parseCommandLine is quote-aware and splits without a shell', () => {
    assert.deepEqual(parseCommandLine('npm run build'), { command: 'npm', args: ['run', 'build'] });
    assert.deepEqual(parseCommandLine('node "scripts/my build.js" --x'), { command: 'node', args: ['scripts/my build.js', '--x'] });
    assert.equal(parseCommandLine('   '), null);
  });
});

describe('regression helper fixture', () => {
  test('applyRegression really breaks the fixture build', async () => {
    const dir = path.join(tmp(), 'reg');
    createFixtureProject(dir, 'healthy');
    applyRegression(dir, 'build');
    initGitRepo(dir, 're-break');
    const runner = new CommandRunner();
    const res = await runner.run({ command: 'npm', args: ['run', 'build'], cwd: dir });
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /bundle failed/);
  });
});
