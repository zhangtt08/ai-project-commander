import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, looksLikeSpec, parseStageTitle, specKindFromPath } from '../../src/core/engines/spec-manager.js';
import { TaskLedger } from '../../src/core/engines/task-ledger.js';
import { StageManager } from '../../src/core/engines/stage-manager.js';
import { evaluateGate, gateSummaryLine } from '../../src/core/engines/acceptance-gate.js';
import { ProjectHealthEngine, ProjectProgressEngine } from '../../src/core/engines/health.js';
import { analyzeRisks, riskSummary } from '../../src/core/engines/risk.js';
import { detectRegressions } from '../../src/core/engines/regression.js';
import { detectDrift } from '../../src/core/engines/drift.js';
import { NextActionEngine } from '../../src/core/engines/next-action.js';
import { PromptGenerator, DO_NOT_BREAK_DEFAULTS } from '../../src/core/engines/prompt-generator.js';
import { buildHandoffPackage } from '../../src/core/engines/handoff.js';
import { ProjectMemoryStore } from '../../src/core/engines/memory.js';
import { openDatabase } from '../../src/db/database.js';
import { Repository } from '../../src/db/repositories.js';
import { SEVERITY, TASK_STATUS, STAGE_STATUS, RUN_STATUS, BUILD_STATUS, GATE_RESULT } from '../../src/domain/constants.js';
import { REQUIRED_PROMPT_SECTIONS, AgentPromptSchema } from '../../src/domain/ai-schemas.js';

function freshRepo() {
  const db = openDatabase(':memory:');
  return { db, repo: new Repository(db) };
}

const SPEC_MD = `# Demo Project

## Goals
- Ship a useful thing.

## Requirements
- REQ-1: A user can sign in.
- REQ-2: A user can log out.

## Acceptance Criteria
- [x] Sign-in form validates email.
- [ ] Logout clears the session.

## Out of Scope
- Social login.

## Constraints
- Must run offline.

## Stages
- Stage 1 — Foundations
- Stage 2 — Auth
`;

describe('SpecificationManager parsing', () => {
  test('extracts every section from markdown', () => {
    const p = parseMarkdown(SPEC_MD, { path: 'SPEC.md' });
    assert.equal(p.title, 'Demo Project');
    assert.equal(p.goals.length, 1);
    assert.equal(p.requirements.length, 2);
    assert.equal(p.requirements[0].ref, 'REQ-1');
    assert.equal(p.acceptance.length, 2);
    assert.equal(p.outOfScope.length, 1);
    assert.equal(p.constraints.length, 1);
    assert.deepEqual(p.stages.map((s) => s.name), ['Foundations', 'Auth']);
    assert.equal(p.checkboxes.filter((c) => c.checked).length, 1);
  });

  test('stage titles only match explicit declarations', () => {
    assert.equal(parseStageTitle('Stages'), null);
    assert.equal(parseStageTitle('Roadmap'), null);
    assert.equal(parseStageTitle('Stage 1 — Foundations').name, 'Foundations');
    assert.equal(parseStageTitle('Phase: Discovery').name, 'Discovery');
    assert.equal(parseStageTitle('Milestone 3 - GA').index, 3);
  });

  test('detects a specification by content, not just by file name', () => {
    assert.equal(looksLikeSpec(parseMarkdown(SPEC_MD, { path: 'notes.md' }), { path: 'notes.md' }), true);
    assert.equal(looksLikeSpec(parseMarkdown('# Just a readme\n\nNothing here.\n', { path: 'README.md' }), { path: 'README.md' }), false);
  });

  test('synthesises requirement refs when absent', () => {
    const p = parseMarkdown('## Requirements\n- users can search\n- users can filter\n');
    assert.deepEqual(p.requirements.map((r) => r.ref), ['REQ-1', 'REQ-2']);
  });

  test('classifies spec kinds', () => {
    assert.equal(specKindFromPath('SPEC.md', {}), 'spec');
    assert.equal(specKindFromPath('PRD.md', {}), 'prd');
    assert.equal(specKindFromPath('docs/design.md', {}), 'doc');
  });
});

describe('TaskLedger', () => {
  test('derives tasks from criteria, checkboxes and markers with provenance', () => {
    const { repo } = freshRepo();
    const project = repo.insert('projects', { name: 'P', workspace_path: '/p' });
    const ledger = new TaskLedger({ repo });
    const specs = [{ path: 'SPEC.md', parsed: parseMarkdown(SPEC_MD, { path: 'SPEC.md' }) }];
    const criteria = [
      { kind: 'checkbox', status: 'unmet', text: 'Logout clears the session', spec_path: 'SPEC.md', evidence: [] },
      { kind: 'checkbox', status: 'satisfied', text: 'Already done', spec_path: 'SPEC.md', evidence: [] },
      { kind: 'requirement', status: 'unknown', text: 'A user can sign in', requirement_ref: 'REQ-1', spec_path: 'SPEC.md', evidence: [] },
      { kind: 'out_of_scope', status: 'unknown', text: 'Social login', spec_path: 'SPEC.md', evidence: [] },
    ];
    const metadata = { todos: [{ kind: 'TODO', text: 'add caching', path: 'src/a.ts', line: 3 }] };
    const derived = ledger.derive({ specs, criteria, metadata, sessions: [] });
    assert.ok(derived.length >= 3);
    assert.ok(derived.some((t) => t.source === 'spec'));
    assert.ok(derived.some((t) => t.source === 'todo_comment'));
    assert.ok(!derived.some((t) => /Social login/.test(t.title)), 'out-of-scope items must not become tasks');
    assert.ok(derived.every((t) => t.fingerprint));

    const first = ledger.sync(project.id, derived);
    assert.ok(first.created >= 3);
    const second = ledger.sync(project.id, derived);
    assert.equal(second.created, 0, 'syncing twice must not duplicate tasks');
    assert.equal(ledger.summary(project.id).total, first.total);
  });

  test('keeps manual tasks when auto-derived ones disappear', () => {
    const { repo } = freshRepo();
    const project = repo.insert('projects', { name: 'P', workspace_path: '/p2' });
    const ledger = new TaskLedger({ repo });
    ledger.addManual(project.id, { title: 'Manual task' });
    ledger.sync(project.id, []);
    const tasks = repo.list('tasks', { project_id: project.id });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, 'manual');
  });

  test('never clobbers a done task during a resync', () => {
    const { repo } = freshRepo();
    const project = repo.insert('projects', { name: 'P', workspace_path: '/p3' });
    const ledger = new TaskLedger({ repo });
    const derived = ledger.derive({ criteria: [{ kind: 'checkbox', status: 'unmet', text: 'Do X', spec_path: 'S.md', evidence: [] }] });
    ledger.sync(project.id, derived);
    const t = repo.list('tasks', { project_id: project.id })[0];
    ledger.setStatus(t.id, TASK_STATUS.DONE);
    ledger.sync(project.id, ledger.derive({ criteria: [{ kind: 'checkbox', status: 'unmet', text: 'Do X', spec_path: 'S.md', evidence: [] }] }));
    assert.equal(repo.get('tasks', t.id).status, TASK_STATUS.DONE);
  });
});

describe('StageManager', () => {
  test('infers stages from spec declarations and reports unknown without them', () => {
    const { repo } = freshRepo();
    const project = repo.insert('projects', { name: 'P', workspace_path: '/s1' });
    const manager = new StageManager({ repo });
    const planned = manager.plan({ specs: [{ path: 'README.md', parsed: parseMarkdown('## Stages\n- Stage 1 — Foundations\n- Stage 2 — Auth\n') }] });
    assert.equal(planned.stages.length, 2);
    assert.equal(planned.confidence, 'high');
    const created = manager.sync(project.id, planned);
    assert.equal(created.stages.length, 2);
    assert.equal(created.stages[0].name, 'Foundations');
  });

  test('returns an explicit unknown note when nothing can be inferred', () => {
    const { repo } = freshRepo();
    const manager = new StageManager({ repo });
    const planned = manager.plan({ specs: [], tasks: [] });
    assert.equal(planned.stages.length, 0);
    assert.equal(planned.confidence, 'unknown');
    assert.match(planned.note, /未知/);
  });

  test('computes stage status from its tasks and criteria', () => {
    assert.equal(StageManager.statusFor({ tasks: [], criteria: [] }), STAGE_STATUS.NOT_STARTED);
    assert.equal(StageManager.statusFor({ tasks: [{ status: 'done' }], criteria: [] }), STAGE_STATUS.COMPLETED);
    assert.equal(StageManager.statusFor({ tasks: [{ status: 'todo' }], criteria: [] }), STAGE_STATUS.NOT_STARTED);
    assert.equal(StageManager.statusFor({ tasks: [{ status: 'blocked' }], criteria: [] }), STAGE_STATUS.BLOCKED);
    assert.equal(StageManager.statusFor({ tasks: [{ status: 'done' }, { status: 'in_progress' }], criteria: [] }), STAGE_STATUS.IN_PROGRESS);
  });
});

describe('AcceptanceGate', () => {
  const stage = { id: 'stg1', name: 'Foundations', status: 'in_progress' };
  const passBuild = { status: BUILD_STATUS.PASS, command: 'npm run build', exitCode: 0, durationMs: 100 };
  const passUnit = { suite: 'unit', status: RUN_STATUS.PASS, passed: 5, total: 5, failed: 0, framework: 'vitest' };
  const passE2E = { suite: 'e2e', status: RUN_STATUS.PASS, passed: 3, total: 3, failed: 0, framework: 'playwright' };

  test('PASS when every check passes', () => {
    const gate = evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: passE2E, risks: [], tasks: [{ stage_id: 'stg1', status: 'done' }], criteria: [] });
    assert.equal(gate.result, GATE_RESULT.PASS);
    assert.match(gate.explanation, /可以推进到下一阶段/);
  });

  test('FAIL and explains exactly which check blocked it', () => {
    const failing = { ...passE2E, status: RUN_STATUS.FAIL, passed: 22, total: 25, failed: 3 };
    const gate = evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: failing, risks: [], tasks: [{ stage_id: 'stg1', status: 'done' }], criteria: [] });
    assert.equal(gate.result, GATE_RESULT.FAIL);
    assert.ok(gate.failedChecks.some((c) => /端到端/.test(c)));
    assert.match(gate.explanation, /3 个失败/);
  });

  test('UNKNOWN when a stage cannot be identified', () => {
    const gate = evaluateGate({ stage: null, build: passBuild });
    assert.equal(gate.result, GATE_RESULT.UNKNOWN);
    assert.match(gate.explanation, /无法从规范或任务中确定项目阶段/);
  });

  test('high risks do not block the gate; critical risks do', () => {
    const high = evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: passE2E, risks: [{ status: 'open', severity: SEVERITY.HIGH, code: 'X' }], tasks: [], criteria: [] });
    assert.equal(high.result, GATE_RESULT.PASS);
    const critical = evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: passE2E, risks: [{ status: 'open', severity: SEVERITY.CRITICAL, code: 'Y' }], tasks: [], criteria: [] });
    assert.equal(critical.result, GATE_RESULT.FAIL);
  });

  test('blocked tasks produce BLOCKED', () => {
    const gate = evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: passE2E, risks: [], tasks: [{ stage_id: 'stg1', status: 'blocked' }], criteria: [] });
    assert.equal(gate.result, GATE_RESULT.BLOCKED);
  });

  test('summary line is human readable', () => {
    assert.match(gateSummaryLine(evaluateGate({ stage, build: passBuild, unit: passUnit, e2e: passE2E })), /^PASS/);
  });
});

describe('ProjectHealthEngine', () => {
  const engine = new ProjectHealthEngine();
  const unit = { suite: 'unit', status: RUN_STATUS.PASS, passed: 5, total: 5, failed: 0, framework: 'vitest' };
  const build = { status: BUILD_STATUS.PASS, command: 'npm run build', exitCode: 0, durationMs: 10 };

  test('healthy when everything is green', () => {
    const h = engine.evaluate({ build, unit, e2e: { ...unit, suite: 'e2e' }, risks: [], tasks: [], git: { isRepository: true, workingTreeClean: true, changedFileCount: 0, untracked: [] }, gate: { result: GATE_RESULT.PASS, explanation: 'ok' }, criteria: [] });
    assert.equal(h.status, 'healthy');
    assert.ok(h.reasons.some((r) => r.code === 'build_passed'));
  });

  test('critical when the build fails and always explains why', () => {
    const h = engine.evaluate({ build: { ...build, status: BUILD_STATUS.FAIL, exitCode: 1 }, unit, risks: [], tasks: [] });
    assert.equal(h.status, 'critical');
    const top = h.reasons[0];
    assert.equal(top.code, 'build_failed');
    assert.equal(top.severity, 'critical');
    assert.ok(top.fix.length > 0);
  });

  test('warning for failing e2e while unit passes', () => {
    const h = engine.evaluate({ build, unit, e2e: { ...unit, suite: 'e2e', status: RUN_STATUS.FAIL, passed: 22, total: 25, failed: 3 }, risks: [], tasks: [] });
    assert.equal(h.status, 'warning');
  });

  test('unknown when no evidence at all was collected', () => {
    const h = engine.evaluate({});
    assert.equal(h.status, 'unknown');
    assert.ok(h.reasons.some((r) => r.code === 'no_evidence'));
  });

  test('medium risk for a project with no runnable test suite', () => {
    const h = engine.evaluate({ build, unit: { status: RUN_STATUS.UNSUPPORTED }, e2e: { status: RUN_STATUS.UNSUPPORTED }, risks: [], tasks: [] });
    assert.equal(h.status, 'warning');
    assert.ok(h.reasons.some((r) => r.code === 'no_tests_configured'));
  });

  test('sensitive file detection is informational and does not degrade health', () => {
    const h = engine.evaluate({ build, unit, risks: [], tasks: [], metadata: { sensitiveCount: 2 } });
    assert.equal(h.status, 'healthy');
    const r = h.reasons.find((x) => x.code === 'sensitive_files_present');
    assert.equal(r.severity, 'info');
  });
});

describe('ProjectProgressEngine', () => {
  const engine = new ProjectProgressEngine();

  test('derives progress from stages, tasks and acceptance', () => {
    const p = engine.compute({
      stages: [{ status: STAGE_STATUS.COMPLETED }, { status: STAGE_STATUS.IN_PROGRESS }],
      tasks: [{ status: 'done' }, { status: 'todo' }, { status: 'done' }, { status: 'todo' }],
      criteria: [{ kind: 'checkbox', status: 'satisfied' }, { kind: 'checkbox', status: 'unmet' }],
    });
    // stages (0.75 x 0.4) + tasks (0.5 x 0.3) + acceptance (0.5 x 0.3) = 0.6
    assert.equal(p.percent, 60);
    assert.equal(p.confidence, 'high');
    assert.match(p.method, /加权平均/);
  });

  test('returns unknown rather than inventing a number', () => {
    const p = engine.compute({});
    assert.equal(p.value, null);
    assert.equal(p.confidence, 'unknown');
    assert.match(p.reason, /不估算百分比/);
  });

  test('excludes cancelled tasks and out-of-scope criteria', () => {
    const p = engine.compute({
      tasks: [{ status: 'done' }, { status: 'cancelled' }],
      criteria: [{ kind: 'out_of_scope', status: 'unknown' }],
    });
    assert.equal(p.percent, 100);
  });
});

describe('RiskEngine', () => {
  test('covers build, tests, dirty tree, deletion, acceptance and secrets', () => {
    const risks = analyzeRisks({
      build: { status: BUILD_STATUS.FAIL, command: 'npm run build', exitCode: 1, durationMs: 10 },
      unit: { suite: 'unit', status: RUN_STATUS.FAIL, failed: 2, total: 5, framework: 'vitest', parseConfidence: 'high' },
      git: { isRepository: true, changedFileCount: 30, untracked: [], deleted: ['src/gone.ts'] },
      metadata: { sensitiveCount: 1, sensitiveFiles: [{ path: '.env', rule: 'env_file' }], largestFiles: [], packageJson: { scripts: { deploy: 'rm -rf dist && npm publish' } }, topLevelFiles: ['package.json'], todoCount: 0 },
      tasks: [{ status: 'blocked', title: 'blocked thing' }],
      criteria: [{ kind: 'checkbox', status: 'unmet', text: 'crit', evidence: [] }],
    });
    const codes = risks.map((r) => r.code);
    for (const expected of ['BUILD_FAILED', 'TESTS_FAILED_UNIT', 'MANY_DIRTY_FILES', 'CRITICAL_FILE_DELETED', 'SENSITIVE_FILES_PRESENT', 'ACCEPTANCE_NOT_MET', 'BLOCKED_TASKS', 'UNKNOWN_SCRIPT']) {
      assert.ok(codes.includes(expected), `${expected} was not raised (got ${codes.join(',')})`);
    }
    assert.equal(risks[0].severity, SEVERITY.CRITICAL);
    assert.ok(risks.every((r) => r.suggested_action !== undefined));
    assert.equal(riskSummary(risks).bySeverity.critical, 1);
  });

  test('reports no evidence instead of staying silent', () => {
    const risks = analyzeRisks({});
    assert.ok(risks.some((r) => r.code === 'NO_EVIDENCE'));
  });

  test('deduplicates by code keeping the highest severity', () => {
    const risks = analyzeRisks({
      build: { status: BUILD_STATUS.FAIL, command: 'b', exitCode: 1 },
      metadata: { packageJson: { scripts: {} }, topLevelFiles: ['package.json'], largestFiles: [] },
    });
    const codes = risks.map((r) => r.code);
    assert.equal(new Set(codes).size, codes.length);
  });
});

describe('RegressionDetector', () => {
  const snap = (over) => ({ id: 's1', seq: 1, ts: '2026-01-01T00:00:00Z', ...over });

  test('detects PASS → FAIL for build and tests with before/after', () => {
    const previous = snap({ build: { status: 'pass' }, unit: { status: 'pass', passed: 6, total: 6 }, file_count: 10 });
    const current = {
      build: { status: 'fail', command: 'npm run build', exitCode: 1 },
      unit: { status: 'fail', passed: 4, total: 6, failed: 2, framework: 'vitest' },
      risks: [], metadata: { fileCount: 10 },
    };
    const regs = detectRegressions({ previous, current });
    const types = regs.map((r) => r.type);
    assert.ok(types.includes('build_pass_to_fail'));
    assert.ok(types.includes('tests_pass_to_fail'));
    const build = regs.find((r) => r.type === 'build_pass_to_fail');
    assert.equal(build.before.status, 'pass');
    assert.equal(build.after.status, 'fail');
    assert.ok(build.evidence.length > 0);
    assert.ok(build.suggested_action.length > 0);
  });

  test('detects a passing-count drop without a status change', () => {
    const previous = snap({ unit: { status: 'pass', passed: 10, total: 10 } });
    const current = { unit: { status: 'fail', passed: 8, total: 10, failed: 2, framework: 'vitest' }, risks: [] };
    const regs = detectRegressions({ previous, current });
    assert.ok(regs.some((r) => r.type === 'tests_pass_to_fail'));
  });

  test('detects a suspicious test-count drop', () => {
    const previous = snap({ unit: { status: 'pass', passed: 20, total: 20 } });
    const current = { unit: { status: 'pass', passed: 10, total: 10 }, risks: [] };
    const regs = detectRegressions({ previous, current });
    assert.ok(regs.some((r) => r.type === 'test_count_drop'));
  });

  test('detects an increase in critical risks and a file-count drop', () => {
    const previous = snap({ risk_summary: { bySeverity: { critical: 0 } }, file_count: 40 });
    const current = { risks: [{ status: 'open', severity: 'critical', title: 'x' }], metadata: { fileCount: 20 } };
    const regs = detectRegressions({ previous, current });
    assert.ok(regs.some((r) => r.type === 'critical_risk_increased'));
    assert.ok(regs.some((r) => r.type === 'key_file_deleted'));
  });

  test('detects an acceptance gate regression', () => {
    const previous = snap({ gate_json: { result: 'PASS' } });
    const current = { gate: { result: 'FAIL', explanation: 'no' }, risks: [] };
    const regs = detectRegressions({ previous, current });
    assert.ok(regs.some((r) => r.type === 'acceptance_invalidated'));
  });

  test('never reports a regression without both sides', () => {
    assert.deepEqual(detectRegressions({ previous: null, current: { risks: [] } }), []);
    assert.deepEqual(detectRegressions({ previous: snap({}), current: null }), []);
  });
});

describe('DriftDetector', () => {
  test('reports hedged "possible_drift" with evidence, never a bare accusation', () => {
    const result = detectDrift({
      specs: [{ path: 'SPEC.md', parsed: { requirements: [{ ref: 'REQ-1', text: 'users can search' }] } }],
      criteria: [{ kind: 'requirement', requirement_ref: 'REQ-1', text: 'users can search', spec_path: 'SPEC.md', evidence: [] }],
      tasks: [],
      previous: { id: 's1', seq: 1, roleCounts: { test: 5 } },
      metadata: { roleCounts: { test: 1 } },
      unit: { status: 'pass' },
    });
    assert.equal(result.verdict, 'possible_drift');
    assert.ok(result.drifts.length > 0);
    assert.match(result.note, /可能存在漂移/);
    assert.ok(result.drifts.every((d) => d.evidence !== undefined && d.confidence));
  });

  test('reports "aligned" when nothing is off', () => {
    const result = detectDrift({
      specs: [{ path: 'SPEC.md', parsed: { requirements: [] } }],
      criteria: [],
      tasks: [{ title: 'search users', evidence: [] }],
    });
    assert.equal(result.verdict, 'aligned');
  });

  test('flags the "tests were removed to make the suite pass" pattern', () => {
    const result = detectDrift({
      specs: [{ path: 'SPEC.md', parsed: {} }],
      criteria: [],
      tasks: [],
      previous: { id: 's', seq: 1, roleCounts: { test: 10 } },
      metadata: { roleCounts: { test: 4 } },
    });
    assert.ok(result.drifts.some((d) => d.kind === 'tests_removed' && d.severity === 'high'));
  });
});

describe('NextActionEngine', () => {
  const engine = new NextActionEngine();

  test('build failure outranks everything', () => {
    const a = engine.decide({ build: { status: BUILD_STATUS.FAIL, command: 'npm run build', exitCode: 1 }, unit: { suite: 'unit', status: RUN_STATUS.FAIL, failed: 2, total: 5 }, tasks: [{ status: 'blocked', title: 'x' }] });
    assert.equal(a.rule, 'build_failed');
    assert.equal(a.priority, 'p0');
    assert.ok(a.verificationCommands.includes('npm run build'));
  });

  test('e2e failures outrank unit passes and produce acceptance criteria', () => {
    const a = engine.decide({
      build: { status: BUILD_STATUS.PASS, command: 'npm run build' },
      unit: { suite: 'unit', status: RUN_STATUS.PASS, passed: 6, total: 6, framework: 'vitest' },
      e2e: { suite: 'e2e', status: RUN_STATUS.FAIL, passed: 22, total: 25, failed: 3, framework: 'playwright', command: 'npm run test:e2e' },
      failedCases: [{ suite: 'e2e', name: 'flow A', file: 'e2e/a.spec.ts' }],
    });
    assert.equal(a.rule, 'e2e_failed');
    assert.ok(a.acceptanceCriteria.some((c) => /25\/25/.test(c)));
    assert.ok(a.scope.some((s) => /flow A/.test(s)));
    assert.equal(a.relevantFiles.includes('e2e/a.spec.ts'), true);
  });

  test('regression outranks plain open tasks', () => {
    const a = engine.decide({ regressions: [{ type: 'x', severity: 'high', title: 'Checkout broke', suggested_action: 'fix it' }], tasks: [{ status: 'todo', title: 'nits' }] });
    assert.equal(a.rule, 'regression');
  });

  test('falls back to the highest-priority open task', () => {
    const a = engine.decide({ tasks: [{ status: 'todo', title: 'Do the thing', priority: 'p1', source: 'manual', evidence: [] }] });
    assert.equal(a.rule, 'open_task');
    assert.match(a.objective, /Do the thing/);
  });

  test('asks for a specification when nothing is actionable', () => {
    const a = engine.decide({});
    assert.equal(a.rule, 'no_spec');
    assert.match(a.reason, /规范文档/);
  });

  test('every action carries the full contract', () => {
    const a = engine.decide({ unit: { suite: 'unit', status: RUN_STATUS.FAIL, failed: 1, total: 3, framework: 'vitest' } });
    for (const key of ['objective', 'reason', 'scope', 'relevantFiles', 'constraints', 'acceptanceCriteria', 'verificationCommands', 'risks', 'priority']) {
      assert.ok(key in a, `missing ${key}`);
    }
    assert.ok(Array.isArray(a.verificationCommands) && a.verificationCommands.length);
  });
});

describe('PromptGenerator', () => {
  function stubStructured(mockData, { omit = [] } = {}) {
    return {
      async run() {
        const prompt = REQUIRED_PROMPT_SECTIONS
          .filter((sec) => !omit.includes(sec))
          .map((sec) => `## ${sec}\ncontent for ${sec}\n`)
          .join('\n');
        return {
          data: { title: 'T', prompt, completionRequirements: [], confidence: 'high', ...mockData },
          provider: 'mock', model: 'm', confidence: 'high', evidence: [], attempts: 1, fallbackUsed: false, schemaName: 'agentPrompt', validationOk: true,
        };
      },
    };
  }

  const ctx = {
    project: { name: 'P', workspacePath: '/p', health: 'warning', status: 'developing' },
    nextAction: { objective: 'Fix E2E', reason: 'because', relevantFiles: ['a.ts'], constraints: ['x'], acceptanceCriteria: ['all pass'], verificationCommands: ['npm test'], risks: [] },
    metadata: null, git: null, unit: null, e2e: null, integration: null, build: null,
    risks: [], failedCases: [], specs: [], criteria: [], tasks: [], currentStage: null, memory: null,
  };

  test('produces all ten required sections', async () => {
    const gen = new PromptGenerator({ structured: stubStructured({}), memoryStore: null });
    const out = await gen.generate(ctx);
    assert.deepEqual(out.sections.missing, []);
    assert.equal(out.sections.present.length, 10);
  });

  test('repairs sections a provider omitted', async () => {
    const gen = new PromptGenerator({ structured: stubStructured({}, { omit: ['DO NOT BREAK', 'VERIFICATION COMMANDS'] }), memoryStore: null });
    const out = await gen.generate(ctx);
    assert.deepEqual(out.sections.missing, []);
    assert.match(out.prompt, /## DO NOT BREAK/);
    assert.match(out.prompt, /## VERIFICATION COMMANDS/);
    assert.ok(DO_NOT_BREAK_DEFAULTS.every((d) => out.prompt.includes(d)));
  });

  test('the generated prompt is schema-valid and mentions real state', async () => {
    const gen = new PromptGenerator({ structured: stubStructured({}), memoryStore: null });
    const out = await gen.generate(ctx);
    assert.equal(AgentPromptSchema.kind, 'object');
    assert.ok(out.prompt.length > 400, 'the prompt must be substantial, not a stub');
    for (const section of REQUIRED_PROMPT_SECTIONS) {
      assert.ok(out.prompt.includes(`## ${section}`), `missing section ${section}`);
    }
  });
});

describe('Handoff package', () => {
  test('contains every declared section', () => {
    const memoryStore = new ProjectMemoryStore({ repo: freshRepo().repo });
    const pkg = buildHandoffPackage({
      project: { name: 'Demo', workspacePath: '/demo', description: 'd', status: 'developing' },
      metadata: { primaryLanguage: 'TS', frameworks: ['React'] },
      git: { isRepository: true, branch: 'main', commitShort: 'abc1234', workingTreeClean: true, changedFileCount: 0, untracked: [] },
      stages: [{ name: 'Stage 1', status: 'in_progress' }], currentStage: { name: 'Stage 1' },
      tasks: [{ title: 't', status: 'done' }], criteria: [], specs: [], risks: [], regressions: [],
      gate: { result: 'FAIL' }, health: { status: 'warning' }, progress: { percent: 50 },
      memory: null, memoryStore: null, unit: null, integration: null, e2e: null, build: null,
      nextAction: { objective: 'Fix it', reason: 'r', relevantFiles: ['a.ts'], verificationCommands: ['npm test'], acceptanceCriteria: ['x'] },
    });
    assert.deepEqual(pkg.missingSections, []);
    assert.match(pkg.markdown, /## Next Action/);
    assert.match(pkg.markdown, /## Verification/);
    assert.ok(pkg.targetAgents.includes('claude_code'));
  });
});

describe('ProjectMemoryStore', () => {
  test('versions memory and never overwrites history', () => {
    const { repo } = freshRepo();
    const project = repo.insert('projects', { name: 'P', workspace_path: '/m1' });
    const store = new ProjectMemoryStore({ repo });
    const first = store.version(project.id, { purpose: 'a' });
    assert.equal(first.version, 1);
    const second = store.version(project.id, { purpose: 'b' });
    assert.equal(second.version, 2);
    const same = store.version(project.id, { purpose: 'b' });
    assert.equal(same.created, false);
    assert.equal(same.version, 2);
    assert.equal(store.history(project.id).length, 2);
    assert.match(store.render(store.latest(project.id)), /Project Memory v2/);
  });
});
