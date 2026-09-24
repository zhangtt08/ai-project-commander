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
    const workspace = project.workspace_path || project.workspacePath || '';
    const ZH_STATE = {
      build: '构建', unit: '单元测试', integration: '集成测试', e2e: '端到端测试',
      planning: '规划中', developing: '开发中', testing: '测试中', review: '评审中', blocked: '已阻塞', ready: '就绪', released: '已发布', archived: '已归档',
      healthy: '健康', warning: '警告', critical: '危急', unknown: '未知',
      pass: '通过', fail: '失败', error: '错误', timeout: '超时', unsupported: '不适用',
      done: '已完成', todo: '待办', in_progress: '进行中', cancelled: '已取消',
    };
    const st = (v) => ZH_STATE[v] || v;
    const stateLines = [
      `- 项目名称：${project.name}`,
      `- 工作目录（执行任何命令前，必须先 cd 到该目录）：${workspace}`,
      `- 项目描述：${project.description || '（未填写）'}`,
      `- 健康：${st(project.health)}；状态：${st(project.status)}`,
      `- 阶段：${ctx.currentStage ? ctx.currentStage.name : '未知'}`,
      `- 构建：${build ? `${st(build.status)}${build.command ? `（\`${build.command}\`）` : ''}` : '未运行'}`,
      `- 单元测试：${unit ? `${unit.passed}/${unit.total} ${st(unit.status)}` : '未运行'}`,
      `- 端到端测试：${e2e ? `${e2e.passed}/${e2e.total} ${st(e2e.status)}` : '未运行'}`,
      `- 集成测试：${integration ? `${integration.passed}/${integration.total} ${st(integration.status)}` : '未运行'}`,
      git && git.isRepository ? `- Git：${git.branch} @ ${git.commitShort || '无提交'}（${git.workingTreeClean ? '干净' : `${git.changedFileCount} 个修改，${(git.untracked || []).length} 个未跟踪`}）` : '- Git：不是仓库',
      `- 任务：${tasks.filter((t) => t.status === 'done').length}/${tasks.length} 已完成`,
      `- 验收标准：${criteria.filter((c) => c.status === 'satisfied').length}/${criteria.length} 已满足`,
      `- 未解决风险：${risks.filter((r) => r.status === 'open').length} 个`,
    ];

    const ZH_SUITE = { unit: '单元测试', integration: '集成测试', e2e: '端到端测试' };
    const failureLines = [];
    for (const [key, run] of [['unit', unit], ['integration', integration], ['e2e', e2e]]) {
      if (run && (run.status === RUN_STATUS.FAIL || run.status === RUN_STATUS.ERROR)) {
        failureLines.push(`- ${ZH_SUITE[key]}：${run.total ? `${run.failed}/${run.total} 失败` : '无法解析结果'}（${run.framework}）`);
      }
    }
    if (build && (build.status === BUILD_STATUS.FAIL || build.status === BUILD_STATUS.TIMEOUT)) {
      failureLines.push(`- build: ${build.status} (exit ${build.exitCode})`);
    }
    const ZH_SUITE2 = { unit: '单元', integration: '集成', e2e: '端到端' };
    for (const c of (failedCases || []).slice(0, 12)) {
      failureLines.push(`  - [${ZH_SUITE2[c.suite] || c.suite}] ${c.name}${c.file ? ` —— ${c.file}` : ''}${c.errorSummary ? `\n      ${truncate(c.errorSummary, 220)}` : ''}`);
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
