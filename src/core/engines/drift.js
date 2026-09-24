/**
 * DriftDetector — requirement #32.
 * Detects the project drifting away from its specification.
 * The verdict is deliberately hedged: "possible_drift", never a bare accusation.
 * Every drift item is tied to evidence.
 */
import { SEVERITY, CONFIDENCE } from '../../domain/constants.js';
import { evFile, evSpec, evTest, evSnapshot } from '../evidence.js';

export function detectDrift({
  specs = [], criteria = [], tasks = [], git = null, metadata = null, previous = null, unit = null, e2e = null,
} = {}) {
  const drifts = [];
  const hasSpec = specs.length > 0;

  if (!hasSpec && tasks.length > 0) {
    drifts.push({
      title: '在没有书面规范的情况下开展工作',
      description: `存在 ${tasks.length} 个任务，但未找到规范文档，缺少度量漂移的基准。`,
      severity: SEVERITY.MEDIUM,
      requirementRef: '',
      confidence: CONFIDENCE.HIGH,
      evidence: tasks.slice(0, 3).flatMap((t) => t.evidence || []),
      kind: 'no_spec_baseline',
    });
  }

  const requirements = criteria.filter((c) => c.kind === 'requirement');
  const satisfied = criteria.filter((c) => c.status === 'satisfied');
  const unmet = criteria.filter((c) => c.status === 'unmet');

  if (hasSpec && requirements.length && !satisfied.length) {
    drifts.push({
      title: '需求没有任何满足证据',
      description: `提取到 ${requirements.length} 条需求，但没有验收标准被标记为已满足，也没有关联任何实现证据。`,
      severity: SEVERITY.MEDIUM,
      requirementRef: requirements[0].requirement_ref || '',
      confidence: CONFIDENCE.MEDIUM,
      evidence: requirements.slice(0, 3).map((r) => evSpec(r.requirement_ref || r.text.slice(0, 60), r.spec_path)),
      kind: 'unimplemented_requirements',
    });
  }

  // Requirements with no corresponding source file hint in the task ledger.
  for (const req of requirements.slice(0, 20)) {
    const tokens = String(req.text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4).slice(0, 6);
    const linked = tasks.some((t) => {
      if (!t.title) return false;
      const title = t.title.toLowerCase();
      return tokens.some((tok) => title.includes(tok));
    });
    if (!linked && tokens.length >= 2) {
      drifts.push({
        title: `需求 ${req.requirement_ref || ''} 没有关联工作`.trim(),
        description: `没有任务或代码线索引用“${String(req.text).slice(0, 120)}”。该需求可能尚未实现。`,
        severity: SEVERITY.LOW,
        requirementRef: req.requirement_ref || '',
        confidence: CONFIDENCE.LOW,
        evidence: [evSpec(req.requirement_ref || req.text.slice(0, 40), req.spec_path)],
        kind: 'requirement_without_work',
      });
    }
  }

  // Test removal as a "make it pass" anti-pattern.
  if (previous && metadata) {
    const prevRoleCounts = previous.roleCounts || null;
    if (prevRoleCounts && prevRoleCounts.test != null && metadata.roleCounts && metadata.roleCounts.test < prevRoleCounts.test) {
      drifts.push({
        title: '测试文件被移除',
        description: `测试文件数从 ${prevRoleCounts.test} 降到 ${metadata.roleCounts.test}。为了让测试套件通过而删除测试，是漂移信号。`,
        severity: SEVERITY.HIGH,
        requirementRef: '',
        confidence: CONFIDENCE.HIGH,
        evidence: [evSnapshot(previous.id), evTest('suite')],
        kind: 'tests_removed',
      });
    }
  }

  // Wide unrelated change surface: lots of changed files but no spec/task linkage.
  if (git && git.isRepository) {
    const changed = [...(git.modified || []), ...(git.added || [])];
    if (changed.length > 30) {
      const unrelated = changed.filter((p) => !tasks.some((t) => t.title.toLowerCase().includes(p.split('/').pop().toLowerCase().replace(/\.[a-z]+$/, ''))));
      if (unrelated.length > changed.length * 0.8) {
        drifts.push({
          title: '大量变更与计划工作无关联',
          description: `${changed.length} 个变更文件中有 ${unrelated.length} 个无法关联到账本中的任何任务，可能存在范围蔓延。`,
          severity: SEVERITY.MEDIUM,
          requirementRef: '',
          confidence: CONFIDENCE.LOW,
          evidence: unrelated.slice(0, 5).map((p) => evFile(p)),
          kind: 'scope_creep',
        });
      }
    }
  }

  // Green tests but unmet acceptance criteria: behaviour may have been bypassed.
  const allGreen = unit && unit.status === 'pass' && (!e2e || e2e.status === 'pass' || e2e.status === 'unsupported');
  if (allGreen && unmet.length >= 2) {
    drifts.push({
      title: '测试全绿但验收标准仍未满足',
      description: `尽管测试套件通过，仍有 ${unmet.length} 条验收标准未满足。测试可能没有覆盖承诺的行为。`,
      severity: SEVERITY.MEDIUM,
      requirementRef: unmet[0].requirement_ref || '',
      confidence: CONFIDENCE.MEDIUM,
      evidence: unmet.slice(0, 3).map((c) => evSpec(c.text.slice(0, 60), c.spec_path)),
      kind: 'coverage_gap',
    });
  }

  const verdict = drifts.some((d) => d.severity === SEVERITY.HIGH || d.severity === SEVERITY.CRITICAL)
    ? 'possible_drift'
    : drifts.length ? 'possible_drift' : (hasSpec ? 'aligned' : 'unknown');

  return {
    drifts,
    verdict,
    note: drifts.length
      ? '可能存在漂移——这些是基于文件与任务证据的启发式判断，请先核实再行动。'
      : (hasSpec ? '未检测到与当前规范相悖的漂移信号。' : '未找到规范基线，无法评估漂移。'),
    analyzedAt: new Date().toISOString(),
  };
}

export function driftSummary(result) {
  if (!result) return { verdict: 'unknown', count: 0 };
  return { verdict: result.verdict, count: result.drifts.length, worst: result.drifts.map((d) => d.severity)[0] || null };
}
