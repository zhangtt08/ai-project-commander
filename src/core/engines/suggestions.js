/**
 * Optimization suggestions (可优化的建议).
 *
 * Every suggestion is derived from evidence the analysis pipeline already produced and
 * quotes the real number behind it. No suggestion is emitted for a condition that was not
 * observed — an unscanned project yields "先扫描", not invented advice.
 */
import { SEVERITY_RANK } from '../../domain/constants.js';

const MB = 1024 * 1024;

const SOURCE_EXT_RE = /^\.(js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|go|rs|java|kt|kts|rb|php|c|h|cpp|hpp|cc|cs|swift|scala|lua|dart|ex|exs|clj|hs|ml|zig|sql)$/i;

function countSourceFiles(extCounts) {
  let n = 0;
  for (const [ext, count] of Object.entries(extCounts || {})) {
    if (SOURCE_EXT_RE.test(ext)) n += Number(count) || 0;
  }
  return n;
}

function sug({ id, title, why, action, evidence, impact, effort, area }) {
  return { id, title, why, action, evidence: evidence || '', impact, effort, area };
}

/**
 * @param {object} ctx { project, meta, git, build, gate, health, risks, regressions,
 *                       tasks, specs, prompts, events, settings }
 */
export function buildSuggestions(ctx) {
  const out = [];
  const meta = ctx.meta && ctx.meta.ok === true ? ctx.meta : null;
  const project = ctx.project || {};

  if (!meta) {
    out.push(sug({
      id: 'scan-first',
      title: '尚未完成扫描，暂时无法给出优化建议',
      why: 'Commander 只根据真实读到的文件下结论；没有扫描记录时任何建议都会变成猜测。',
      action: '打开项目页 → 点击「立即分析」，等待扫描与测试解析完成。',
      evidence: 'metadata_json 中没有成功的扫描结果',
      impact: 'high', effort: 'low', area: '识别',
    }));
    return out;
  }

  const roles = meta.roleCounts || {};
  const testFiles = (roles.test || 0) + (roles.e2e || 0);
  const pkg = meta.packageJson || null;
  const scripts = (pkg && pkg.scripts) || {};
  const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
  const depCount = Object.keys(deps).length;
  const topLevel = meta.topLevelFiles || [];
  const git = ctx.git || null;
  const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

  // A folder holding only a manifest, a lockfile and node_modules is an `npm install`
  // scratch dir. Telling someone to add tests and CI to it is noise, not advice.
  const sourceFiles = countSourceFiles(meta.extCounts);
  if (sourceFiles === 0) {
    const extSummary = Object.entries(meta.extCounts || {}).slice(0, 4)
      .map((pair) => pair[0] + '×' + pair[1])
      .join('、') || '无';
    return [sug({
      id: 'no-source-files',
      title: '这个目录里没有任何源码，可能不是一个项目',
      why: '建议功能需要真实代码才有意义。这里只有清单与依赖文件，套用补测试、加 CI、写 README 这类建议只会产生噪音。',
      action: '确认它是否只是依赖安装目录：是的话不必纳入管理，可直接从列表中删除；如果源码在别处，请把项目路径改成真正的目录。',
      evidence: meta.fileCount + ' 个受跟踪文件中源码文件 0 个（扩展名统计：' + extSummary + '）',
      impact: 'medium', effort: 'low', area: '整理',
    })];
  }

  // ── 文档与可识别性 ────────────────────────────────────────────────────────
  const hasReadme = topLevel.some((f) => /^readme(\.|$)/i.test(String(f))) ||
    (meta.markdownDocs || []).some((d) => /(^|\/)readme/i.test(d.path || ''));
  if (!hasReadme) {
    out.push(sug({
      id: 'no-readme',
      title: '补一份 README，让项目用途能被识别',
      why: '仓库里没有 README，也没有可引用的用途描述，导致"这个项目是做什么的"只能靠目录命名推断。',
      action: '在根目录写 README.md：一句话用途 + 如何运行 + 当前进度。之后重新分析即可自动识别用途。',
      evidence: `${meta.fileCount} 个受跟踪文件中没有 README`,
      impact: 'high', effort: 'low', area: '识别',
    }));
  }

  // ── 规格 / 任务 / 验收 ────────────────────────────────────────────────────
  const taskSummary = ctx.tasks || {};
  const totalTasks = Number(taskSummary.total ?? 0);
  if (totalTasks === 0 && !(ctx.specs || []).length) {
    out.push(sug({
      id: 'no-spec',
      title: '建立任务清单与验收标准，进度才能被计算',
      why: '没有阶段、任务或验收标准时，进度只能显示"未知"，也无法判断项目是否完成。',
      action: '在项目页「规格」标签导入或手写目标清单，再在「任务」里勾选完成状态。',
      evidence: '任务 0/0，规格文档 0 份，验收门结果未知',
      impact: 'high', effort: 'medium', area: '整理',
    }));
  }

  // ── 测试 ─────────────────────────────────────────────────────────────────
  if (testFiles === 0) {
    out.push(sug({
      id: 'no-tests',
      title: '添加最小可运行测试',
      why: '仓库里没有任何测试文件，任何改动都没有回归保护。',
      action: '先给最核心的 1-2 个函数写单元测试，并把 `npm test` 指到测试命令。',
      evidence: `${meta.fileCount} 个文件中测试文件 0 个`,
      impact: 'high', effort: 'medium', area: '质量',
    }));
  }
  const runs = ctx.testRuns || {};
  const failing = Number(runs.failed ?? 0);
  const totalCases = Number(runs.total ?? 0);
  if (failing > 0) {
    out.push(sug({
      id: 'tests-failing',
      title: `修复 ${failing} 个失败的测试用例`,
      why: `最近一次测试 ${totalCases ? `${totalCases - failing}/${totalCases} 通过` : '存在失败'}，失败用例会让验收门一直无法通过。`,
      action: '在项目页「测试」标签按文件分组查看失败原因，先修断言最集中的文件。',
      evidence: runs.command ? `命令：${runs.command}` : `失败 ${failing} 个`,
      impact: 'high', effort: 'medium', area: '质量',
    }));
  }
  if (runs.status === 'error' || runs.status === 'timeout') {
    out.push(sug({
      id: 'test-runner-broken',
      title: '测试命令执行异常，结果无法解析',
      why: '测试跑起来了但没有产出可解析的用例结果，因此"通过/失败"是空白而不是真实状态。',
      action: `检查 \`${runs.command || '测试命令'}\` 是否能单独跑通，并确认输出格式被 Commander 支持。`,
      evidence: `状态：${runs.status}${runs.exitCode !== undefined ? `，退出码 ${runs.exitCode}` : ''}`,
      impact: 'medium', effort: 'medium', area: '质量',
    }));
  }
  if (pkg && !scripts.test) {
    out.push(sug({
      id: 'no-test-script',
      title: '在 package.json 里声明 test 脚本',
      why: '没有标准的 test 入口，Commander 无法自动跑回归，其他协作者也无从下手。',
      action: '添加 `"scripts": { "test": "<你的测试命令>" }`。',
      evidence: 'package.json 的 scripts 中没有 test',
      impact: 'medium', effort: 'low', area: '质量',
    }));
  }

  // ── 版本管理 ─────────────────────────────────────────────────────────────
  if (!meta.isGitRepositoryHint && !(git && git.isRepository)) {
    out.push(sug({
      id: 'no-git',
      title: '纳入 Git 版本管理',
      why: '目录不是 Git 仓库，因此没有提交历史、无法比对回归，也没有回滚手段。',
      action: '在项目根目录执行 `git init` + 首次提交，并补 .gitignore。',
      evidence: '未发现 .git 目录',
      impact: 'high', effort: 'low', area: '整理',
    }));
  } else if (git && git.workingTreeClean === false) {
    const dirty = (git.modified || []).length + (git.added || []).length + (git.untracked || []).length;
    out.push(sug({
      id: 'dirty-tree',
      title: `提交 ${dirty} 个未保存的变更`,
      why: '工作区有未提交改动，快照与回归比对会一直停留在上一次提交，问题会被掩盖。',
      action: '按功能分批提交；临时文件写进 .gitignore。',
      evidence: `修改 ${(git.modified || []).length}、新增 ${(git.added || []).length}、未跟踪 ${(git.untracked || []).length}`,
      impact: 'medium', effort: 'low', area: '整理',
    }));
  }

  const hasIgnore = topLevel.some((f) => /^\.gitignore$/i.test(String(f)));
  if (!hasIgnore && meta.packageManager !== 'unknown') {
    out.push(sug({
      id: 'no-gitignore',
      title: '添加 .gitignore，避免依赖与构建产物入库',
      why: '没有 .gitignore 时 node_modules、dist 这类目录很容易被一起提交，仓库会迅速膨胀。',
      action: '至少忽略 node_modules/、dist/、*.log、.env。',
      evidence: `根目录不存在 .gitignore（包管理器：${meta.packageManager}）`,
      impact: 'medium', effort: 'low', area: '整理',
    }));
  }

  // ── 安全 ─────────────────────────────────────────────────────────────────
  if ((meta.sensitiveCount || 0) > 0) {
    out.push(sug({
      id: 'sensitive-files',
      title: `处理 ${meta.sensitiveCount} 个疑似敏感文件`,
      why: '仓库里存在看起来含密钥/凭据的文件。Commander 不会读取或上传它们的内容，但它们留在仓库里本身就是风险。',
      action: '把密钥移到环境变量，将文件加入 .gitignore，并轮换已泄露的凭据。',
      evidence: (meta.sensitiveFiles || []).slice(0, 5).map((f) => f.path).join('、'),
      impact: 'critical', effort: 'medium', area: '安全',
    }));
  }

  // ── 结构与体积 ───────────────────────────────────────────────────────────
  const bigFiles = (meta.largestFiles || []).filter((f) => (f.sizeBytes || 0) > 5 * MB);
  if (bigFiles.length) {
    out.push(sug({
      id: 'large-files',
      title: `拆分或外置 ${bigFiles.length} 个大于 5MB 的文件`,
      why: '大体积文件会拖慢扫描、克隆和任何打包流程，通常也不该进版本库。',
      action: '二进制资源改用对象存储/Git LFS；数据文件移到仓库外目录。',
      evidence: bigFiles.slice(0, 3).map((f) => `${f.path} ${(f.sizeBytes / MB).toFixed(1)}MB`).join('；'),
      impact: 'medium', effort: 'medium', area: '整理',
    }));
  }
  if (depCount > 60) {
    out.push(sug({
      id: 'dep-bloat',
      title: `精简 ${depCount} 个依赖`,
      why: '依赖数量偏多时，安装耗时、体积和供应链面都会上升，很多通常已不再使用。',
      action: '用依赖分析逐个确认引用，删掉未使用的包，合并功能重复的库。',
      evidence: `dependencies + devDependencies 合计 ${depCount} 个`,
      impact: 'low', effort: 'medium', area: '质量',
    }));
  }
  const lockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'uv.lock', 'poetry.lock'];
  if (pkg && !lockfile.some((f) => topLevel.includes(f))) {
    out.push(sug({
      id: 'no-lockfile',
      title: '提交依赖锁文件',
      why: '没有 lockfile 时不同机器装出的依赖版本不一致，"在我这能跑"的问题很难排查。',
      action: `用 ${meta.packageManager !== 'unknown' ? meta.packageManager : '当前包管理器'} 安装一次并提交生成的锁文件。`,
      evidence: '根目录未发现任何已知锁文件',
      impact: 'medium', effort: 'low', area: '质量',
    }));
  }

  // ── 静态检查与 CI ────────────────────────────────────────────────────────
  const cfg = meta.configFiles || {};
  const hasLint = cfg.eslint === true || cfg.prettier === true ||
    Object.keys(deps).some((d) => /eslint|biome|prettier|^typescript$|ruff|mypy/.test(d));
  if (!hasLint) {
    out.push(sug({
      id: 'no-lint',
      title: '接入 lint / 类型检查',
      why: '没有静态检查时，低级错误只能在运行时被发现，AI 改动的回归成本更高。',
      action: '加最小配置（如 tsconfig.json + eslint，或 ruff），并把命令写进 scripts。',
      evidence: '未发现 eslint / prettier 配置文件，依赖中也没有 lint 工具',
      impact: 'medium', effort: 'medium', area: '质量',
    }));
  }
  if (!cfg.ci && meta.fileCount > 20) {
    out.push(sug({
      id: 'no-ci',
      title: '加一条最小 CI 流水线',
      why: '测试与构建只在本地跑，就无法保证任何一次提交真的是可用的。',
      action: '添加 push 时执行 install → typecheck → test 的工作流文件。',
      evidence: `${meta.fileCount} 个文件，未发现 .github/workflows`,
      impact: 'medium', effort: 'medium', area: '质量',
    }));
  }

  // ── 待办与技术债 ─────────────────────────────────────────────────────────
  const todoCount = (meta.todos || []).length;
  if (todoCount >= 5) {
    out.push(sug({
      id: 'todo-debt',
      title: `清理 ${todoCount} 处 TODO/FIXME`,
      why: '代码注释里的待办长期不处理会变成隐性需求，也不利于判断项目是否完成。',
      action: '把仍然成立的条目转成任务清单里的任务，其余直接删除。',
      evidence: (meta.todos || []).slice(0, 3).map((t) => `${t.path}:${t.line ?? '?'}`).join('；'),
      impact: 'low', effort: 'medium', area: '整理',
    }));
  }

  // ── 风险 / 回归 / 阻塞 ───────────────────────────────────────────────────
  const risks = (ctx.risks || []).filter((r) => !['resolved', 'closed', 'mitigated'].includes(r.status));
  const worst = risks.slice().sort((a, b) => (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1))[0];
  if (worst && (SEVERITY_RANK[worst.severity] ?? 0) >= SEVERITY_RANK.high) {
    out.push(sug({
      id: 'open-risks',
      title: `处理 ${risks.length} 条未解决风险（最高 ${worst.severity}）`,
      why: '风险条目挂着不处理，会在后续分析里反复出现并掩盖真正的新问题。',
      action: '逐条确认：已修复的标记解决，暂不处理的降级并写明原因。',
      evidence: worst.title || worst.description || worst.message || '',
      impact: 'high', effort: 'low', area: '风险',
    }));
  }
  if ((ctx.regressions || []).length) {
    out.push(sug({
      id: 'regressions',
      title: `确认 ${ctx.regressions.length} 条回归`,
      why: '与上一次快照相比出现了指标退步，不确认就会一直累积。',
      action: '在项目页「回归」标签逐条对比前后快照，修掉或标注为预期变化。',
      evidence: ctx.regressions.slice(0, 3).map((r) => r.title || r.metric || '').filter(Boolean).join('；'),
      impact: 'high', effort: 'medium', area: '风险',
    }));
  }
  const pendingPrompts = (ctx.prompts || []).filter((p) => !p.executed_at && !['done', 'executed'].includes(p.status));
  if (pendingPrompts.length) {
    out.push(sug({
      id: 'prompts-pending',
      title: `执行或归档 ${pendingPrompts.length} 条待执行提示词`,
      why: '提示词生成了却没跑，说明改进计划停在纸面上。',
      action: '把仍然需要的提示词交给编码 Agent 执行，过期的直接删除。',
      evidence: `状态为待执行的提示词 ${pendingPrompts.length} 条`,
      impact: 'low', effort: 'low', area: '推进',
    }));
  }

  // ── 时效性 ───────────────────────────────────────────────────────────────
  const idle = daysSince(project.last_analyzed_at || project.updated_at);
  if (idle !== null && idle >= 14) {
    out.push(sug({
      id: 'stale-analysis',
      title: `重新分析（已 ${idle} 天未更新）`,
      why: '面板上的结论来自过期快照，与磁盘现状可能已经不一致。',
      action: '点击「立即分析」刷新；若项目已废弃，请归档或从管理中删除。',
      evidence: `最近分析时间：${project.last_analyzed_at || project.updated_at}`,
      impact: 'medium', effort: 'low', area: '整理',
    }));
  }

  if (ctx.drift && ctx.drift.detected) {
    out.push(sug({
      id: 'drift',
      title: '同步文档与实际实现',
      why: '检测到规格描述与代码现状出现偏移，文档已经不能代表项目。',
      action: '更新规格/README 中过期的目标与接口描述，或修正实现。',
      evidence: ctx.drift.summary || ctx.drift.reason || 'drift 引擎给出偏移信号',
      impact: 'medium', effort: 'medium', area: '识别',
    }));
  }

  const order = { critical: 3, high: 2, medium: 1, low: 0 };
  const rank = (s) => (order[s.impact] ?? 0) * 10 + (s.effort === 'low' ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a));
}

/** Roll suggestions up into the handful of things worth doing next. */
export function summarizeSuggestions(suggestions, { limit = 3 } = {}) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of suggestions) counts[s.impact] = (counts[s.impact] || 0) + 1;
  return {
    total: suggestions.length,
    counts,
    top: suggestions.slice(0, limit).map((s) => s.title),
  };
}
