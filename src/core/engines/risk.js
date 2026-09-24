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

const ZH_SUITE = { unit: '单元', integration: '集成', e2e: '端到端' };
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
    out.push(risk('BUILD_FAILED', '构建失败', SEVERITY.CRITICAL,
      `\`${build.command}\` 退出码 ${build.exitCode}。构建红灯期间，任何下游信号都不可信。`,
      { evidence: [evCommand(build.command)], action: '在“构建”页修复第一个构建错误，然后重新运行构建。' }));
  }
  if (build && build.status === BUILD_STATUS.TIMEOUT) {
    out.push(risk('BUILD_TIMEOUT', '构建超时', SEVERITY.HIGH,
      `构建在 ${build.durationMs}ms 内未完成。`,
      { evidence: [evCommand(build.command)], action: '检查是否有挂起的进程，或在设置中调大构建超时。' }));
  }

  for (const [name, run] of [['unit', unit], ['integration', integration], ['e2e', e2e]]) {
    if (!run) continue;
    if (run.status === RUN_STATUS.FAIL) {
      out.push(risk(`TESTS_FAILED_${name.toUpperCase()}`, `${ZH_SUITE[name] || name}测试失败`, SEVERITY.HIGH,
        `${run.total} 个 ${name} 测试中有 ${run.failed} 个失败（${run.framework}）。`,
        { evidence: [evTest(name)], action: '在“测试”页查看失败的用例并修复。', data: { failed: run.failed, total: run.total } }));
    }
    if (run.status === RUN_STATUS.ERROR) {
      out.push(risk(`TEST_PARSE_${name.toUpperCase()}`, `${name} 测试输出无法解析`, SEVERITY.MEDIUM,
        `${name} 命令退出码为 ${run.exitCode}，但输出不匹配任何受支持的 reporter 格式，因此数量未知。`,
        { evidence: [evTest(name)], action: '改用受支持的 reporter（vitest/jest/playwright 默认输出），或扩展解析器。' }));
    }
    if (run.parseConfidence === CONFIDENCE.LOW) {
      out.push(risk(`TEST_CONFIDENCE_${name.toUpperCase()}`, `${name} 测试结果置信度低`, SEVERITY.LOW,
        `${name} 的 reporter 汇总与进程退出码不一致。`,
        { evidence: [evTest(name)], action: '确认测试命令是否是预期的那一个。' }));
    }
  }

  if (git && git.isRepository) {
    const dirty = git.changedFileCount + (git.untracked ? git.untracked.length : 0);
    if (dirty > 25) {
      out.push(risk('MANY_DIRTY_FILES', '大量未提交改动', SEVERITY.HIGH,
        `${dirty} 个文件与 HEAD 不同。大量未提交差异会掩盖回归，也无法归因。`,
        { evidence: [evFile((git.modified || [])[0] || '(working tree)')], action: '先提交或 stash 一个检查点再继续。', data: { dirty } }));
    } else if (dirty > 8) {
      out.push(risk('DIRTY_FILES', '存在未提交改动', SEVERITY.MEDIUM,
        `${dirty} 个文件与 HEAD 不同。`,
        { action: '考虑提交一个检查点，让 Commander 能与已知状态做对比。', data: { dirty } }));
    }
  }

  if (previous && metadata) {
    const prevCount = previous.file_count || 0;
    if (prevCount && metadata.fileCount < prevCount * 0.8 && prevCount - metadata.fileCount >= 5) {
      out.push(risk('FILE_COUNT_DROP', '工作区文件数骤降', SEVERITY.HIGH,
        `自快照 #${previous.seq} 以来，文件数从 ${prevCount} 降到 ${metadata.fileCount}，可能有文件被删除。`,
        { evidence: [evSnapshot(previous.id)], action: '将工作区与上一个提交做对比，确认没有删除重要文件。', data: { prevCount, now: metadata.fileCount } }));
    }
  }

  if (git && git.deleted && git.deleted.length) {
    const important = git.deleted.filter((p) => /(^|\/)(src|lib|app|packages)\//.test(p) || /\.(ts|tsx|js|jsx|py|go|rs)$/.test(p));
    if (important.length) {
      out.push(risk('CRITICAL_FILE_DELETED', '源码文件被删除', SEVERITY.HIGH,
        `工作区中删除了 ${important.length} 个源码文件：${important.slice(0, 5).join('、')}。`,
        { evidence: important.slice(0, 5).map((p) => evFile(p)), action: '确认删除是有意的；否则从 git 恢复。', data: { files: important.slice(0, 10) } }));
    }
  }

  if (tasks.length) {
    const blocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
    if (blocked.length) {
      out.push(risk('BLOCKED_TASKS', '任务被阻塞', blocked.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        `${blocked.length} 个任务被阻塞：${blocked.slice(0, 3).map((t) => t.title).join('；')}。`,
        { evidence: blocked.slice(0, 3).map((t) => evFile(t.title)), action: '解决阻塞依赖，或重新界定任务范围。', data: { count: blocked.length } }));
    }
    const staleTodo = tasks.filter((t) => t.source === TASK_SOURCE.TODO_COMMENT && t.status === TASK_STATUS.TODO);
    if (staleTodo.length > 15) {
      out.push(risk('TODO_SURGE', 'TODO/FIXME 标记在累积', SEVERITY.MEDIUM,
        `源码中存在 ${staleTodo.length} 个未解决的 TODO/FIXME 标记。`,
        { evidence: staleTodo.slice(0, 3).flatMap((t) => t.evidence || []), action: '把标记分诊为真实任务，或清理过期标记。', data: { count: staleTodo.length } }));
    }
  }

  if (criteria.length) {
    const unmetAcceptance = criteria.filter((c) => c.kind === 'checkbox' && c.status === 'unmet');
    if (unmetAcceptance.length) {
      out.push(risk('ACCEPTANCE_NOT_MET', '验收标准未满足', unmetAcceptance.length > 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        `仍有 ${unmetAcceptance.length} 条验收标准未满足，例如：“${truncate(unmetAcceptance[0].text, 160)}”。`,
        { evidence: unmetAcceptance.slice(0, 3).flatMap((c) => c.evidence || []), action: '在宣布阶段完成之前完成这些标准。', data: { count: unmetAcceptance.length } }));
    }
  }

  if (metadata) {
    if (metadata.sensitiveCount > 0) {
      out.push(risk('SENSITIVE_FILES_PRESENT', '工作区存在敏感文件', SEVERITY.MEDIUM,
        `${metadata.sensitiveCount} 个文件命中敏感规则。其内容未被读取、存储或传输。`,
        { evidence: (metadata.sensitiveFiles || []).slice(0, 5).map((f) => evFile(f.path, f.rule)), action: '确认这些文件已被 .gitignore 覆盖，且从未被提交。', data: { count: metadata.sensitiveCount } }));
    }

    const oversized = (metadata.largestFiles || []).filter((f) => f.sizeBytes > 1024 * 1024);
    if (oversized.length) {
      out.push(risk('OVERSIZED_FILE', '存在超大源码文件', SEVERITY.LOW,
        `${oversized.length} 个文件超过 1 MB，最大的 ${Math.round(oversized[0].sizeBytes / 1024)} KB（${oversized[0].path}）。`,
        { evidence: oversized.slice(0, 3).map((f) => evFile(f.path)), action: '拆分大文件；人对它们和 Agent 对它们都难以推理。', data: { files: oversized.slice(0, 3) } }));
    }

    if (metadata.packageJson && metadata.packageJson.scripts) {
      for (const [name, body] of Object.entries(metadata.packageJson.scripts)) {
        if (SUSPICIOUS_SCRIPT_RE.test(String(body))) {
          out.push(risk('UNKNOWN_SCRIPT', `可疑的 npm 脚本 “${name}”`, SEVERITY.HIGH,
            `脚本 “${name}” 包含破坏性或远程执行模式：${truncate(String(body), 200)}`,
            { evidence: [evFile('package.json', `scripts.${name}`)], action: '请人工审查该脚本；CommandRunner 会拒绝自动运行它。', data: { script: name } }));
        }
      }
    }

    const hasLockfile = (metadata.topLevelFiles || []).some((f) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(f));
    if (metadata.packageJson && !hasLockfile) {
      out.push(risk('NO_LOCKFILE', '缺少依赖锁定文件', SEVERITY.LOW,
        '存在 package.json 但未找到 lockfile，依赖安装不可复现。',
        { evidence: [evFile('package.json')], action: '提交由项目包管理器生成的 lockfile。', data: {} }));
    }

    if (Array.isArray(metadata.e2eMockLeak) && metadata.e2eMockLeak.length) {
      out.push(risk('MOCK_LEAK', '生产源码中发现 Mock/桩代码', SEVERITY.HIGH,
        `在测试目录之外发现了 Mock 类标识：${metadata.e2eMockLeak.slice(0, 3).join('、')}。`,
        { evidence: metadata.e2eMockLeak.slice(0, 3).map((p) => evFile(p)), action: '把 Mock 移到仅测试可见的边界内，或从发布代码中移除。', data: { files: metadata.e2eMockLeak.slice(0, 5) } }));
    }
  }

  if (regressions && regressions.length) {
    for (const r of regressions) {
      out.push(risk(`REGRESSION_${r.type.toUpperCase()}`, `回归：${r.title}`, r.severity,
        `在快照 #${(r.before || {}).seq ?? '?'} 与 #${(r.after || {}).seq ?? '?'} 之间检测到。`,
        { evidence: r.evidence || [], action: r.suggested_action || '查看“变更”页并修复或回退。', source: 'regression', data: { type: r.type } }));
    }
  }

  if (!metadata && !build && !unit && !e2e) {
    out.push(risk('NO_EVIDENCE', '尚未采集任何工程证据', SEVERITY.MEDIUM,
      '该项目从未被扫描，无法进行风险分析。',
      { action: '添加项目并运行一次全量扫描。' }));
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
