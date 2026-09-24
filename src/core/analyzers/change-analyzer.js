/**
 * ChangeAnalyzer — requirement #17.
 * Classifies what changed between two snapshots (or the current working tree).
 * Rule + file-type first; AI classification is optional and always keeps evidence.
 */
import { CHANGE_KIND } from '../../domain/constants.js';

const RULES = [
  { kind: CHANGE_KIND.TEST, rx: /(^|\/)(tests?|__tests__|e2e|spec)\//i, why: 'path is inside a test directory' },
  { kind: CHANGE_KIND.TEST, rx: /\.(test|spec)\.[a-z]+$/i, why: 'test file naming convention' },
  { kind: CHANGE_KIND.DOCS, rx: /(^|\/)docs?\//i, why: 'path is inside a docs directory' },
  { kind: CHANGE_KIND.DOCS, rx: /\.(md|mdx|txt|rst)$/i, why: 'documentation file extension' },
  { kind: CHANGE_KIND.CONFIG, rx: /(^|\/)(package(-lock)?\.json|tsconfig.*\.json|vite\.config|next\.config|tailwind\.config|\.eslintrc|eslint\.config|prettier|docker|\.github\/workflows|\.env\.example|pnpm-lock\.yaml|yarn\.lock)$/i, why: 'configuration or lock file' },
  { kind: CHANGE_KIND.CONFIG, rx: /\.(ya?ml|toml|ini|cfg|conf)$/i, why: 'config-ish extension' },
  { kind: CHANGE_KIND.DOCS, rx: /(^|\/)CHANGELOG/i, why: 'changelog file' },
];

const FIX_HINTS = /\b(fix|fixes|fixed|bug|patch|hotfix|repair)\b/i;
const FEATURE_HINTS = /\b(feat|feature|add|adds|added|implement|support|introduce)\b/i;
const REFACTOR_HINTS = /\b(refactor|cleanup|clean up|rename|move|reorganize|simplify|extract)\b/i;

export function classifyFile(path, { commitSubject = '', insertions = 0, deletions = 0 } = {}) {
  for (const r of RULES) {
    if (r.rx.test(path)) return { kind: r.kind, confidence: 'high', rationale: r.why };
  }
  if (commitSubject) {
    if (FIX_HINTS.test(commitSubject)) return { kind: CHANGE_KIND.FIX, confidence: 'medium', rationale: `commit subject suggests a fix: "${commitSubject}"` };
    if (REFACTOR_HINTS.test(commitSubject)) return { kind: CHANGE_KIND.REFACTOR, confidence: 'medium', rationale: `commit subject suggests a refactor: "${commitSubject}"` };
    if (FEATURE_HINTS.test(commitSubject)) return { kind: CHANGE_KIND.FEATURE, confidence: 'medium', rationale: `commit subject suggests a feature: "${commitSubject}"` };
  }
  if (insertions > deletions * 3 && insertions > 20) {
    return { kind: CHANGE_KIND.FEATURE, confidence: 'low', rationale: 'mostly additive change' };
  }
  if (Math.abs(insertions - deletions) < Math.max(5, insertions * 0.3) && deletions > 10) {
    return { kind: CHANGE_KIND.REFACTOR, confidence: 'low', rationale: 'balanced insertions/deletions suggests restructuring' };
  }
  return { kind: CHANGE_KIND.UNKNOWN, confidence: 'unknown', rationale: 'no rule matched' };
}

/**
 * @param {{git?:object, previous?:object, metadata?:object}} input
 */
export function analyzeChanges({ git, previousSnapshot = null } = {}) {
  const files = [];
  if (git) {
    const push = (list, status) => {
      for (const p of list || []) files.push({ path: p, status });
    };
    push(git.modified, 'modified');
    push(git.added, 'added');
    push(git.deleted, 'deleted');
    push(git.untracked, 'untracked');
    for (const r of git.renamed || []) files.push({ path: r.to, from: r.from, status: 'renamed' });
    for (const r of (git.diffSummary && git.diffSummary.numstat) || []) {
      const target = files.find((f) => f.path === r.path);
      if (target) { target.insertions = r.insertions; target.deletions = r.deletions; target.binary = r.binary; }
    }
  }

  const commitSubject = (git && git.commitSubject) || '';
  const classified = files.map((f) => {
    const c = classifyFile(f.path, { commitSubject, insertions: f.insertions || 0, deletions: f.deletions || 0 });
    return { ...f, kind: c.kind, kindConfidence: c.confidence, rationale: c.rationale };
  });

  const byKind = {};
  for (const f of classified) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

  const isRegressionRisk = classified.some((f) => f.status === 'deleted' && !/docs?\//.test(f.path));

  return {
    changedFileCount: classified.length,
    files: classified,
    byKind,
    isRegressionRisk,
    comparedTo: previousSnapshot ? { snapshotId: previousSnapshot.id, ts: previousSnapshot.ts, seq: previousSnapshot.seq } : null,
    summary: buildSummary(classified, byKind),
  };
}

function buildSummary(files, byKind) {
  if (!files.length) return 'No changes detected in the working tree.';
  const parts = Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`);
  return `${files.length} changed file(s): ${parts.join(', ')}.`;
}

export function describeRules() {
  return RULES.map((r) => ({ kind: r.kind, pattern: String(r.rx), rationale: r.why }));
}
