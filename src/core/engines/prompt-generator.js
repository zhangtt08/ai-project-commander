/**
 * PromptGenerator — requirement #38.
 *
 * Produces a prompt that can be pasted straight into Codex / Claude Code / Cursor.
 * The ten required sections are guaranteed to exist: if the provider omits one, the
 * deterministic skeleton supplies it. An empty or hand-wavy prompt is a bug.
 */
import { AgentPromptSchema, REQUIRED_PROMPT_SECTIONS } from '../../domain/ai-schemas.js';
import { CONFIDENCE, RUN_STATUS, BUILD_STATUS } from '../../domain/constants.js';
import { logger } from '../logger.js';
import { truncate } from '../util.js';

const log = logger.child('prompt-gen');

export const DO_NOT_BREAK_DEFAULTS = [
  'Do not delete, skip or weaken existing tests.',
  'Do not change public APIs or data schemas that the acceptance criteria depend on.',
  'Do not commit secrets, .env files or credentials.',
  'Do not reformat or "clean up" files unrelated to the objective.',
];

export class PromptGenerator {
  constructor({ structured, memoryStore }) {
    this.structured = structured;
    this.memoryStore = memoryStore;
  }

  buildContext(ctx) {
    const { project, metadata, git, unit, e2e, integration, build, nextAction, risks, memory, failedCases, specs, criteria, tasks } = ctx;
    const stateLines = [
      `- Project: ${project.name} (${project.workspacePath})`,
      `- Health: ${project.health}; Status: ${project.status}`,
      `- Stage: ${ctx.currentStage ? ctx.currentStage.name : 'unknown'}`,
      `- Build: ${build ? `${build.status}${build.command ? ` (\`${build.command}\`)` : ''}` : 'not run'}`,
      `- Unit: ${unit ? `${unit.passed}/${unit.total} ${unit.status}` : 'not run'}`,
      `- E2E: ${e2e ? `${e2e.passed}/${e2e.total} ${e2e.status}` : 'not run'}`,
      `- Integration: ${integration ? `${integration.passed}/${integration.total} ${integration.status}` : 'not run'}`,
      git && git.isRepository ? `- Git: ${git.branch} @ ${git.commitShort || 'no-commit'} (${git.workingTreeClean ? 'clean' : `${git.changedFileCount} modified, ${(git.untracked || []).length} untracked`})` : '- Git: not a repository',
      `- Tasks: ${tasks.filter((t) => t.status === 'done').length}/${tasks.length} done`,
      `- Acceptance: ${criteria.filter((c) => c.status === 'satisfied').length}/${criteria.length} satisfied`,
      `- Open risks: ${risks.filter((r) => r.status === 'open').length}`,
    ];

    const failureLines = [];
    for (const run of [unit, e2e, integration]) {
      if (run && (run.status === RUN_STATUS.FAIL || run.status === RUN_STATUS.ERROR)) {
        failureLines.push(`- ${run.suite}: ${run.failed} of ${run.total} failing (${run.framework})`);
      }
    }
    if (build && (build.status === BUILD_STATUS.FAIL || build.status === BUILD_STATUS.TIMEOUT)) {
      failureLines.push(`- build: ${build.status} (exit ${build.exitCode})`);
    }
    for (const c of (failedCases || []).slice(0, 12)) {
      failureLines.push(`  - [${c.suite}] ${c.name}${c.file ? ` — ${c.file}` : ''}${c.errorSummary ? `\n      ${truncate(c.errorSummary, 220)}` : ''}`);
    }

    return {
      memoryText: this.memoryStore ? this.memoryStore.render(memory, { maxChars: 4000 }) : '(no memory)',
      stateText: stateLines.join('\n'),
      failureText: failureLines.length ? failureLines.join('\n') : '- none recorded',
      specText: (specs || []).map((s) => `- ${s.path} (${s.title || s.kind})`).join('\n') || '- no specification found',
      doNotBreak: DO_NOT_BREAK_DEFAULTS,
    };
  }

  /** @returns {Promise<{title, prompt, sections:{present:string[], missing:string[]}, provider, confidence, fallbackUsed}>} */
  async generate(ctx) {
    const built = this.buildContext(ctx);
    const result = await this.structured.run({
      schemaName: 'agentPrompt',
      schema: AgentPromptSchema,
      system: 'You write precise, evidence-based instructions for autonomous coding agents. Reply with JSON only.',
      prompt: [
        'Write a handoff prompt for a coding agent.',
        '',
        'Target agent: ' + (ctx.agentKey || 'generic_cli'),
        'Next recommended action (already decided deterministically — do not invent a different objective):',
        JSON.stringify(ctx.nextAction, null, 2),
        '',
        'Project memory:',
        built.memoryText,
        '',
        'Current state:',
        built.stateText,
        '',
        'Known failures:',
        built.failureText,
        '',
        `The prompt MUST contain these exact section headings, each starting with "## ": ${REQUIRED_PROMPT_SECTIONS.join(', ')}.`,
      ].join('\n'),
      context: {
        ...ctx,
        ...built,
        relevantFiles: (ctx.nextAction && ctx.nextAction.relevantFiles) || [],
        nextAction: ctx.nextAction,
      },
    });

    const finalized = this.#ensureSections(result.data, ctx, built);
    const sections = REQUIRED_PROMPT_SECTIONS.filter((s) => finalized.prompt.includes(`## ${s}`));
    const missing = REQUIRED_PROMPT_SECTIONS.filter((s) => !finalized.prompt.includes(`## ${s}`));
    log.info('generated', { provider: result.provider, fallbackUsed: result.fallbackUsed, missing });
    return {
      title: finalized.title,
      prompt: finalized.prompt,
      completionRequirements: finalized.completionRequirements || [],
      provider: result.provider,
      model: result.model,
      confidence: result.confidence || CONFIDENCE.MEDIUM,
      fallbackUsed: result.fallbackUsed,
      validationOk: result.validationOk,
      sections: { present: sections, missing },
      context: built,
    };
  }

  /** Guarantee the contract: every required heading exists. */
  #ensureSections(data, ctx, built) {
    let prompt = String(data.prompt || '');
    const a = ctx.nextAction || {};
    const fallbacks = {
      'PROJECT CONTEXT': `## PROJECT CONTEXT\n${built.memoryText}\n`,
      'CURRENT STATE': `## CURRENT STATE\n${built.stateText}\n`,
      OBJECTIVE: `## OBJECTIVE\n${a.objective || ''}\n\n${a.reason || ''}\n`,
      'RELEVANT FILES': `## RELEVANT FILES\n${(a.relevantFiles || []).map((f) => `- ${f}`).join('\n') || '- (none identified)'}\n`,
      'KNOWN FAILURES': `## KNOWN FAILURES\n${built.failureText}\n`,
      CONSTRAINTS: `## CONSTRAINTS\n${(a.constraints || DoNotBreakFallback()).map((c) => `- ${c}`).join('\n')}\n`,
      'DO NOT BREAK': `## DO NOT BREAK\n${built.doNotBreak.map((c) => `- ${c}`).join('\n')}\n`,
      'ACCEPTANCE CRITERIA': `## ACCEPTANCE CRITERIA\n${(a.acceptanceCriteria || []).map((c) => `- ${c}`).join('\n')}\n`,
      'VERIFICATION COMMANDS': `## VERIFICATION COMMANDS\n${(a.verificationCommands || []).map((c) => `- \`${c}\``).join('\n')}\n`,
      'COMPLETION REQUIREMENTS': `## COMPLETION REQUIREMENTS\n- All verification commands must pass.\n- Report the exact commands you ran and their results.\n- Do not delete or disable tests.\n`,
    };
    const missing = REQUIRED_PROMPT_SECTIONS.filter((s) => !prompt.includes(`## ${s}`));
    if (missing.length) {
      prompt = `${prompt.trim()}\n\n${missing.map((s) => fallbacks[s]).join('\n')}`;
    }
    return {
      title: data.title || `Next: ${String(a.objective || 'continue').slice(0, 90)}`,
      prompt,
      completionRequirements: data.completionRequirements || [],
    };
  }
}

function DoNotBreakFallback() {
  return ['Do not delete or weaken tests.', 'Do not change public APIs required by the acceptance criteria.'];
}
