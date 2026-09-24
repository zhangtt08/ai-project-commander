/**
 * MockAIProvider — deterministic, offline, and HONEST about being a mock (ADR-008).
 *
 * It does not pretend to be a language model: every result is derived from the
 * deterministic context with explicit rules, and every payload is tagged
 * `provider: 'mock'` so the UI can label it.
 */
import { AIProvider } from './provider.js';
import { CONFIDENCE, SEVERITY, RUN_STATUS, BUILD_STATUS, TASK_PRIORITY } from '../../domain/constants.js';
import { REQUIRED_PROMPT_SECTIONS } from '../../domain/ai-schemas.js';

export class MockAIProvider extends AIProvider {
  constructor() {
    super({ name: 'mock', kind: 'mock', model: 'deterministic-rules-v1' });
  }

  isConfigured() { return true; }

  async generate({ schemaName, context = {} }) {
    const build = (object) => ({ object, model: this.model, provider: this.name, usage: { promptTokens: 0, completionTokens: 0 } });
    switch (schemaName) {
      case 'projectSummary': return build(this.#summary(context));
      case 'riskAnalysis': return build(this.#risks(context));
      case 'taskExtraction': return build(this.#tasks(context));
      case 'nextAction': return build(this.#nextAction(context));
      case 'stageInference': return build(this.#stages(context));
      case 'changeClassification': return build(this.#changes(context));
      case 'driftAnalysis': return build(this.#drift(context));
      case 'agentPrompt': return build(this.#prompt(context));
      case 'healthCheck': return build({ ok: true });
      default:
        return build({ note: `mock provider has no rule set for "${schemaName}"` });
    }
  }

  #summary(ctx) {
    const m = ctx.metadata || {};
    const technologies = [m.primaryLanguage, ...(m.frameworks || [])].filter(Boolean);
    const mainModules = Object.entries(m.directories || {}).filter(([, v]) => v).map(([k]) => k);
    const evidence = [];
    if (m.packageJson) evidence.push({ type: 'file', ref: 'package.json', note: 'stack metadata source' });
    for (const p of (m.specCandidates || []).slice(0, 3)) evidence.push({ type: 'spec', ref: p, note: 'specification document' });
    return {
      summary: `${ctx.projectName || 'This project'} is a ${m.primaryLanguage || 'unknown-language'} ${
        (m.frameworks || [])[0] || ''
      } application built with ${m.packageManager || 'an unknown package manager'}. It currently contains ${m.fileCount || 0} tracked files, ${
        (m.roleCounts && m.roleCounts.test) || 0
      } of which are test files. Business purpose was not described in the repository, so it is inferred from file and folder naming only.`.replace(/\s+/g, ' ').trim(),
      purpose: (ctx.specs && ctx.specs[0] && ctx.specs[0].parsed && ctx.specs[0].parsed.goals && ctx.specs[0].parsed.goals[0] && ctx.specs[0].parsed.goals[0].text) || '',
      currentStageGuess: (ctx.currentStage || {}).name || '',
      technologies,
      mainModules,
      confidence: m.packageJson ? CONFIDENCE.HIGH : CONFIDENCE.LOW,
      evidence,
    };
  }

  #risks(ctx) {
    const risks = [];
    const push = (title, severity, description, evidence, action) => risks.push({ title, severity, description, suggestedAction: action, confidence: CONFIDENCE.HIGH, evidence });
    const { unit, e2e, build, git, metadata } = ctx;
    if (build && build.status === BUILD_STATUS.FAIL) {
      push('Build failure blocks all further verification', SEVERITY.CRITICAL, `The build command exited ${build.exitCode}, so nothing downstream can be trusted.`, [{ type: 'command', ref: build.command }], 'Fix the build before any other work.');
    }
    if (e2e && e2e.status === RUN_STATUS.FAIL) {
      push('End-to-end flows are broken', SEVERITY.HIGH, `${e2e.failed} of ${e2e.total} E2E tests fail, which means real user journeys may be broken.`, [{ type: 'test', ref: 'e2e' }], 'Repair the failing journeys in the Tests tab.');
    }
    if (unit && unit.status === RUN_STATUS.FAIL) {
      push('Unit test failures indicate unstable logic', SEVERITY.HIGH, `${unit.failed} of ${unit.total} unit tests fail.`, [{ type: 'test', ref: 'unit' }], 'Fix unit failures first — they localise the defect.');
    }
    if (git && git.isRepository && git.changedFileCount > 10) {
      push('Large uncommitted diff reduces traceability', SEVERITY.MEDIUM, `${git.changedFileCount} files differ from HEAD.`, [{ type: 'diff', ref: 'working tree' }], 'Commit a checkpoint so change attribution is possible.');
    }
    if (metadata && metadata.sensitiveCount) {
      push('Workspace contains sensitive files', SEVERITY.MEDIUM, `${metadata.sensitiveCount} file(s) matched sensitive patterns. Contents were never read.`, (metadata.sensitiveFiles || []).slice(0, 3).map((f) => ({ type: 'file', ref: f.path })), 'Confirm .gitignore coverage.');
    }
    if (!risks.length) {
      push('No blocking risk identified from current evidence', SEVERITY.LOW, 'Build and test signals are consistent and the workspace is tidy.', [], 'Continue with the planned work.');
    }
    return { risks };
  }

  #tasks(ctx) {
    const tasks = [];
    const criteria = ctx.criteria || [];
    for (const c of criteria.filter((x) => x.status === 'unmet').slice(0, 20)) {
      tasks.push({
        title: `Satisfy: ${String(c.text).slice(0, 120)}`,
        description: `Acceptance criterion from ${c.spec_path || 'specification'} is unmet.`,
        priority: TASK_PRIORITY.P1,
        stage: c.stage_name || '',
        confidence: CONFIDENCE.HIGH,
        evidence: c.evidence || [],
      });
    }
    const failing = [];
    for (const key of ['unit', 'e2e', 'integration']) {
      const run = ctx[key];
      if (run && run.status === RUN_STATUS.FAIL) {
        for (const c of (run.cases || []).slice(0, 10)) {
          failing.push({
            title: `Fix failing ${key} test: ${String(c.name).slice(0, 120)}`,
            description: String(c.errorSummary || '').slice(0, 400),
            priority: TASK_PRIORITY.P0,
            stage: '',
            confidence: CONFIDENCE.HIGH,
            evidence: [{ type: 'test', ref: c.name, note: c.file || key }],
          });
        }
      }
    }
    return { tasks: [...failing, ...tasks] };
  }

  #nextAction(ctx) {
    const { unit, e2e, build, gate, tasks = [], currentStage, risks = [], projectName } = ctx;
    let objective = '';
    let reason = '';
    let priority = TASK_PRIORITY.P1;
    const verificationCommands = [];

    if (build && build.status === BUILD_STATUS.FAIL) {
      objective = 'Restore a passing build';
      reason = `The build command \`${build.command}\` exits ${build.exitCode}. Until it passes, no other signal is trustworthy.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(build.command);
    } else if (e2e && e2e.status === RUN_STATUS.FAIL) {
      objective = `Repair the ${e2e.failed} failing end-to-end test(s) blocking the acceptance gate`;
      reason = `Unit tests are green${unit ? ` (${unit.passed}/${unit.total})` : ''} but E2E is ${e2e.passed}/${e2e.total}, so the gate cannot pass.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(e2e.command || 'npm run test:e2e');
    } else if (unit && unit.status === RUN_STATUS.FAIL) {
      objective = `Fix the ${unit.failed} failing unit test(s)`;
      reason = `${unit.failed} of ${unit.total} unit tests fail, which blocks the acceptance gate.`;
      priority = TASK_PRIORITY.P0;
      verificationCommands.push(unit.command || 'npm test');
    } else {
      const blocked = tasks.filter((t) => t.status === 'blocked');
      const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      if (blocked.length) {
        objective = `Unblock task: ${String(blocked[0].title).slice(0, 120)}`;
        reason = `${blocked.length} task(s) are blocked and are stalling ${currentStage ? `"${currentStage.name}"` : 'the current stage'}.`;
        priority = TASK_PRIORITY.P1;
      } else if (open.length) {
        objective = String(open[0].title).slice(0, 160);
        reason = `${open.length} open task(s) remain in the ledger; this is the highest-priority open item.`;
      } else {
        objective = 'Extend the specification with the next milestone';
        reason = 'No open tasks were found, so the next unit of work must come from the specification.';
        priority = TASK_PRIORITY.P2;
      }
      verificationCommands.push(build && !build.unsupportedReason ? build.command : 'npm run build');
      verificationCommands.push(unit && unit.command ? unit.command : 'npm test');
    }

    const openRisks = risks.filter((r) => r.status === 'open' && (r.severity === SEVERITY.HIGH || r.severity === SEVERITY.CRITICAL));
    const acceptance = [];
    if (e2e && e2e.total) acceptance.push(`E2E reaches ${e2e.total}/${e2e.total} PASS`);
    if (unit && unit.total) acceptance.push(`Unit tests remain at ${unit.total}/${unit.total} PASS`);
    if (build) acceptance.push('Build command exits 0');
    acceptance.push('No new critical risks appear');
    if (gate && gate.failedChecks && gate.failedChecks.length) acceptance.push(`Gate checks cleared: ${gate.failedChecks.join(', ')}`);

    return {
      objective,
      reason,
      scope: (tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').slice(0, 8).map((t) => String(t.title).slice(0, 200))),
      relevantFiles: (ctx.relevantFiles || []).slice(0, 25),
      constraints: [
        'Do not weaken or delete existing tests to make the suite pass.',
        'Do not change the public schema or API surface unless the acceptance criteria require it.',
        'Keep the change set focused on the objective above.',
      ],
      acceptanceCriteria: acceptance,
      verificationCommands: [...new Set(verificationCommands)].filter(Boolean),
      risks: openRisks.map((r) => `${r.title}: ${r.suggested_action || ''}`).slice(0, 6),
      priority,
      confidence: (unit || e2e || build) ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      evidence: [
        ...(build ? [{ type: 'command', ref: build.command }] : []),
        ...(e2e ? [{ type: 'test', ref: 'e2e' }] : []),
        ...(unit ? [{ type: 'test', ref: 'unit' }] : []),
      ],
    };
  }

  #stages(ctx) {
    const inferred = (ctx.plannedStages || []).map((s) => ({
      name: s.name,
      description: s.description || '',
      status: s.status || 'not_started',
      confidence: s.confidence || CONFIDENCE.MEDIUM,
      evidence: s.evidence || [],
    }));
    return { stages: inferred };
  }

  #changes(ctx) {
    const changes = (ctx.changes || []).map((c) => ({
      path: c.path,
      kind: c.kind || 'unknown',
      rationale: c.rationale || 'deterministic classifier',
      confidence: c.kindConfidence || CONFIDENCE.LOW,
    }));
    return { changes };
  }

  #drift(ctx) {
    const drifts = (ctx.drifts || []).map((d) => ({
      title: d.title,
      description: d.description,
      severity: d.severity,
      requirementRef: d.requirementRef || '',
      confidence: d.confidence || CONFIDENCE.LOW,
      evidence: d.evidence || [],
    }));
    return { drifts, verdict: drifts.length ? 'possible_drift' : (ctx.verdict || 'unknown') };
  }

  #prompt(ctx) {
    const action = ctx.nextAction || {};
    const sections = REQUIRED_PROMPT_SECTIONS.map((section) => {
      switch (section) {
        case 'PROJECT CONTEXT':
          return `## PROJECT CONTEXT\n${ctx.projectMemoryText || '(no project memory)'}\n`;
        case 'CURRENT STATE':
          return `## CURRENT STATE\n${ctx.stateText || '(no state captured)'}\n`;
        case 'OBJECTIVE':
          return `## OBJECTIVE\n${action.objective || '(none)'}\n\n${action.reason || ''}\n`;
        case 'RELEVANT FILES':
          return `## RELEVANT FILES\n${(action.relevantFiles || []).map((f) => `- ${f}`).join('\n') || '- (none identified)'}\n`;
        case 'KNOWN FAILURES':
          return `## KNOWN FAILURES\n${ctx.failureText || '- none recorded'}\n`;
        case 'CONSTRAINTS':
          return `## CONSTRAINTS\n${(action.constraints || []).map((c) => `- ${c}`).join('\n')}\n`;
        case 'DO NOT BREAK':
          return `## DO NOT BREAK\n${(ctx.doNotBreak || []).map((c) => `- ${c}`).join('\n')}\n`;
        case 'ACCEPTANCE CRITERIA':
          return `## ACCEPTANCE CRITERIA\n${(action.acceptanceCriteria || []).map((c) => `- ${c}`).join('\n')}\n`;
        case 'VERIFICATION COMMANDS':
          return `## VERIFICATION COMMANDS\n${(action.verificationCommands || []).map((c) => `- \`${c}\``).join('\n')}\n`;
        case 'COMPLETION REQUIREMENTS':
          return `## COMPLETION REQUIREMENTS\n- All verification commands must pass.\n- Report the exact commands you ran and their results.\n- Do not delete or disable tests.\n- Update the specification if the acceptance criteria changed.\n`;
        default:
          return '';
      }
    });
    return {
      title: `Next: ${String(action.objective || 'continue the project').slice(0, 90)}`,
      prompt: sections.join('\n'),
      completionRequirements: [
        'All verification commands pass',
        'No test was deleted or disabled',
        'A short report of commands run and their output is provided',
      ],
      confidence: CONFIDENCE.HIGH,
    };
  }
}
