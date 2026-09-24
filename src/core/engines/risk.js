/**
 * RiskEngine — requirement #31.
 *
 * 16 transparent, deterministic rules. Every risk carries severity, evidence and a
 * concrete suggested action. AI may *add* explanatory risks later, but never removes
 * or downgrades a deterministic one.
 */
import {
  SEVERITY, SEVERITY_RANK, BUILD_STATUS, RUN_STATUS, CONFIDENCE, TASK_STATUS, TASK_SOURCE,
} from '../../domain/constants.js';
import { sha1, truncate } from '../util.js';
import { evCommand, evFile, evTest, evSnapshot, evSpec } from '../evidence.js';

const SUSPICIOUS_SCRIPT_RE = /(\brm\s+-rf\b|\bdel\s+\/[sq]\b|curl\s+[^|]*\|\s*(sh|bash)|\bnpm\s+install\b.*&&|Invoke-Expression|eval\s*\(|chmod\s+777)/i;
const MOCK_LEAK_RE = /\b(mock(Data|Response|User)?|fake[A-Z]|dummy[A-Z]|TODO_STUB|NotImplementedError|throw new Error\(['"]not implemented)/;

function risk(code, title, severity, description, { evidence = [], action = '', confidence = CONFIDENCE.HIGH, source = 'deterministic', data = {} } = {}) {
  return {
    code, title, severity, description,
    suggested_action: action, confidence, source, evidence, data,
    fingerprint: sha1(`${code}::${JSON.stringify(data)}`).slice(0, 16),
    status: 'open',
  };
}

export function analyzeRisks({
  build = null, unit = null, integration = null, e2e = null,
  git = null, metadata = null, previous = null, tasks = [], criteria = [],
  regressions = [], project = null,
} = {}) {
  const out = [];

  if (build && build.status === BUILD_STATUS.FAIL) {
    out.push(risk('BUILD_FAILED', 'Build is failing', SEVERITY.CRITICAL,
      `\`${build.command}\` exited ${build.exitCode}. No downstream signal is trustworthy while the build is red.`,
      { evidence: [evCommand(build.command)], action: 'Fix the first build error reported in the Build tab, then re-run the build.' }));
  }
  if (build && build.status === BUILD_STATUS.TIMEOUT) {
    out.push(risk('BUILD_TIMEOUT', 'Build timed out', SEVERITY.HIGH,
      `The build did not finish within ${build.durationMs}ms.`,
      { evidence: [evCommand(build.command)], action: 'Check for a hanging watcher/process, or raise buildTimeoutMs in Settings.' }));
  }

  for (const [name, run] of [['unit', unit], ['integration', integration], ['e2e', e2e]]) {
    if (!run) continue;
    if (run.status === RUN_STATUS.FAIL) {
      out.push(risk(`TESTS_FAILED_${name.toUpperCase()}`, `${name} tests are failing`, name === 'unit' ? SEVERITY.HIGH : SEVERITY.HIGH,
        `${run.failed} of ${run.total} ${name} tests failed (${run.framework}).`,
        { evidence: [evTest(name)], action: `Open the Tests tab, inspect the failing ${name} cases and repair them.`, data: { failed: run.failed, total: run.total } }));
    }
    if (run.status === RUN_STATUS.ERROR) {
      out.push(risk(`TEST_PARSE_${name.toUpperCase()}`, `${name} test output could not be parsed`, SEVERITY.MEDIUM,
        `The ${name} command exited ${run.exitCode} but the output did not match a supported reporter format, so counts are unknown.`,
        { evidence: [evTest(name)], action: 'Switch to a supported reporter (vitest/jest/playwright default output) or extend the parser.' }));
    }
    if (run.parseConfidence === CONFIDENCE.LOW) {
      out.push(risk(`TEST_CONFIDENCE_${name.toUpperCase()}`, `${name} test results are low-confidence`, SEVERITY.LOW,
        `The ${name} reporter summary disagrees with the process exit code.`,
        { evidence: [evTest(name)], action: 'Verify the test command is the intended one.' }));
    }
  }

  if (git && git.isRepository) {
    const dirty = git.changedFileCount + (git.untracked ? git.untracked.length : 0);
    if (dirty > 25) {
      out.push(risk('MANY_DIRTY_FILES', 'Large uncommitted change set', SEVERITY.HIGH,
        `${dirty} files differ from HEAD. Large uncommitted diffs hide regressions and make attribution impossible.`,
        { evidence: [evFile((git.modified || [])[0] || '(working tree)')], action: 'Commit or stash a checkpoint before continuing.', data: { dirty } }));
    } else if (dirty > 8) {
      out.push(risk('DIRTY_FILES', 'Uncommitted changes present', SEVERITY.MEDIUM,
        `${dirty} files differ from HEAD.`,
        { action: 'Consider committing a checkpoint so Commander can diff against a known state.', data: { dirty } }));
    }
  }

  if (previous && metadata) {
    const prevCount = previous.file_count || 0;
    if (prevCount && metadata.fileCount < prevCount * 0.8 && prevCount - metadata.fileCount >= 5) {
      out.push(risk('FILE_COUNT_DROP', 'Workspace file count dropped sharply', SEVERITY.HIGH,
        `Files fell from ${prevCount} to ${metadata.fileCount} since snapshot #${previous.seq}. Files may have been deleted.`,
        { evidence: [evSnapshot(previous.id)], action: 'Diff the working tree against the previous commit to confirm nothing important was removed.', data: { prevCount, now: metadata.fileCount } }));
    }
  }

  if (git && git.deleted && git.deleted.length) {
    const important = git.deleted.filter((p) => /(^|\/)(src|lib|app|packages)\//.test(p) || /\.(ts|tsx|js|jsx|py|go|rs)$/.test(p));
    if (important.length) {
      out.push(risk('CRITICAL_FILE_DELETED', 'Source files were deleted', SEVERITY.HIGH,
        `${important.length} source file(s) were deleted in the working tree: ${important.slice(0, 5).join(', ')}.`,
        { evidence: important.slice(0, 5).map((p) => evFile(p)), action: 'Confirm the deletion was intentional; restore from git if not.', data: { files: important.slice(0, 10) } }));
    }
  }

  if (tasks.length) {
    const blocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
    if (blocked.length) {
      out.push(risk('BLOCKED_TASKS', 'Tasks are blocked', blocked.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        `${blocked.length} task(s) are blocked: ${blocked.slice(0, 3).map((t) => t.title).join('; ')}.`,
        { evidence: blocked.slice(0, 3).map((t) => evFile(t.title)), action: 'Resolve the blocking dependency or re-scope the task.', data: { count: blocked.length } }));
    }
    const staleTodo = tasks.filter((t) => t.source === TASK_SOURCE.TODO_COMMENT && t.status === TASK_STATUS.TODO);
    if (staleTodo.length > 15) {
      out.push(risk('TODO_SURGE', 'TODO/FIXME markers are accumulating', SEVERITY.MEDIUM,
        `${staleTodo.length} unresolved TODO/FIXME markers exist in source.`,
        { evidence: staleTodo.slice(0, 3).flatMap((t) => t.evidence || []), action: 'Triage markers into real tasks or delete the stale ones.', data: { count: staleTodo.length } }));
    }
  }

  if (criteria.length) {
    const unmetAcceptance = criteria.filter((c) => c.kind === 'checkbox' && c.status === 'unmet');
    if (unmetAcceptance.length) {
      out.push(risk('ACCEPTANCE_NOT_MET', 'Acceptance criteria are unmet', unmetAcceptance.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        `${unmetAcceptance.length} acceptance criterion/criteria are still unmet, for example: "${truncate(unmetAcceptance[0].text, 160)}".`,
        { evidence: unmetAcceptance.slice(0, 3).flatMap((c) => c.evidence || []), action: 'Complete the criteria before declaring the stage done.', data: { count: unmetAcceptance.length } }));
    }
  }

  if (metadata) {
    if (metadata.sensitiveCount > 0) {
      out.push(risk('SENSITIVE_FILES_PRESENT', 'Sensitive files present in the workspace', SEVERITY.MEDIUM,
        `${metadata.sensitiveCount} sensitive file(s) matched the protection rules. Their contents were NOT read, stored or transmitted.`,
        { evidence: (metadata.sensitiveFiles || []).slice(0, 5).map((f) => evFile(f.path, f.rule)), action: 'Confirm these files are covered by .gitignore and were never committed.', data: { count: metadata.sensitiveCount } }));
    }

    const oversized = (metadata.largestFiles || []).filter((f) => f.sizeBytes > 1024 * 1024);
    if (oversized.length) {
      out.push(risk('OVERSIZED_FILE', 'Very large source file', SEVERITY.LOW,
        `${oversized.length} file(s) exceed 1 MB, largest ${Math.round(oversized[0].sizeBytes / 1024)} KB (${oversized[0].path}).`,
        { evidence: oversized.slice(0, 3).map((f) => evFile(f.path)), action: 'Split large files; they are hard for humans and agents to reason about.', data: { files: oversized.slice(0, 3) } }));
    }

    if (metadata.packageJson && metadata.packageJson.scripts) {
      for (const [name, body] of Object.entries(metadata.packageJson.scripts)) {
        if (SUSPICIOUS_SCRIPT_RE.test(String(body))) {
          out.push(risk('UNKNOWN_SCRIPT', `Suspicious npm script "${name}"`, SEVERITY.HIGH,
            `The script "${name}" contains a destructive or remote-execution pattern: ${truncate(String(body), 200)}`,
            { evidence: [evFile('package.json', `scripts.${name}`)], action: 'Review this script manually. CommandRunner will refuse to run it automatically.', data: { script: name } }));
        }
      }
    }

    const hasLockfile = (metadata.topLevelFiles || []).some((f) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(f));
    if (metadata.packageJson && !hasLockfile) {
      out.push(risk('NO_LOCKFILE', 'No dependency lockfile', SEVERITY.LOW,
        'package.json exists but no lockfile was found, so installs are not reproducible.',
        { evidence: [evFile('package.json')], action: 'Commit a lockfile generated by the project\'s package manager.', data: {} }));
    }

    if (Array.isArray(metadata.e2eMockLeak) && metadata.e2eMockLeak.length) {
      out.push(risk('MOCK_LEAK', 'Mock/stub code found in production source', SEVERITY.HIGH,
        `Mock-like identifiers were found outside test directories: ${metadata.e2eMockLeak.slice(0, 3).join(', ')}.`,
        { evidence: metadata.e2eMockLeak.slice(0, 3).map((p) => evFile(p)), action: 'Move mocks behind a test-only boundary or remove them from shipped code.', data: { files: metadata.e2eMockLeak.slice(0, 5) } }));
    }
  }

  if (regressions && regressions.length) {
    for (const r of regressions) {
      out.push(risk(`REGRESSION_${r.type.toUpperCase()}`, `Regression: ${r.title}`, r.severity,
        `Detected between snapshot #${(r.before || {}).seq ?? '?'} and #${(r.after || {}).seq ?? '?'}.`,
        { evidence: r.evidence || [], action: r.suggested_action || 'Inspect the Changes tab and repair or revert.', source: 'regression', data: { type: r.type } }));
    }
  }

  if (!metadata && !build && !unit && !e2e) {
    out.push(risk('NO_EVIDENCE', 'No engineering evidence collected', SEVERITY.MEDIUM,
      'The project has never been scanned, so no risk analysis is possible.',
      { action: 'Add the project and run a full scan.' }));
  }

  return dedupe(out);
}

export function dedupe(risks) {
  const byCode = new Map();
  for (const r of risks) {
    const existing = byCode.get(r.code);
    if (!existing || SEVERITY_RANK[r.severity] > SEVERITY_RANK[existing.severity]) byCode.set(r.code, r);
  }
  return [...byCode.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** Extra deterministic check used by the scanner hook: mock identifiers outside tests. */
export function scanForMockLeak(root, files) {
  const suspects = [];
  for (const f of files) {
    if (f.role !== 'source') continue;
    if (!/\.(ts|tsx|js|jsx|py|go)$/.test(f.path)) continue;
    if (/\.(test|spec)\./.test(f.path)) continue;
    if (f.sizeBytes > 512 * 1024) continue;
    suspects.push(f.path);
    if (suspects.length >= 60) break;
  }
  return suspects;
}

export function riskSummary(risks) {
  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of risks) if (r.status === 'open') bySeverity[r.severity] += 1;
  return {
    total: risks.length,
    open: risks.filter((r) => r.status === 'open').length,
    bySeverity,
    worst: risks.length ? risks[0].severity : null,
  };
}

export { SUSPICIOUS_SCRIPT_RE, MOCK_LEAK_RE, risk };
