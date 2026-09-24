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
      title: 'Work is happening without a written specification',
      description: `${tasks.length} task(s) exist but no specification document was found. There is no baseline to measure drift against.`,
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
      title: 'Requirements have no satisfied evidence',
      description: `${requirements.length} requirement(s) were extracted but no acceptance criterion is marked satisfied, and no implementation evidence was linked.`,
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
        title: `Requirement ${req.requirement_ref || ''} has no linked work`.trim(),
        description: `No task or code hint references "${String(req.text).slice(0, 120)}". The requirement may be unimplemented.`,
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
        title: 'Test files were removed',
        description: `Test file count dropped from ${prevRoleCounts.test} to ${metadata.roleCounts.test}. Removing tests to make a suite pass is a drift signal.`,
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
          title: 'Large change set with no traceable link to planned work',
          description: `${unrelated.length} of ${changed.length} changed files cannot be linked to any task in the ledger. This may be scope creep.`,
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
      title: 'Tests are green while acceptance criteria remain unmet',
      description: `${unmet.length} acceptance criteria are unmet even though the test suites pass. The tests may not cover the promised behaviour.`,
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
      ? 'Possible Drift — these are heuristics based on file and task evidence. Verify before acting.'
      : (hasSpec ? 'No drift signals detected against the current specification.' : 'No specification baseline found, so drift cannot be assessed.'),
    analyzedAt: new Date().toISOString(),
  };
}

export function driftSummary(result) {
  if (!result) return { verdict: 'unknown', count: 0 };
  return { verdict: result.verdict, count: result.drifts.length, worst: result.drifts.map((d) => d.severity)[0] || null };
}
