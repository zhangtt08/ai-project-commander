/**
 * IgnoreEngine — requirement #12.
 * Layer order (later layers can re-include by negation, first layer wins for hard ignores):
 *   1. default ignore list (never overridable)
 *   2. .gitignore (project root + nested, best-effort)
 *   3. user-defined patterns from Settings / project record
 *
 * Also enforces hard scan limits so a huge workspace can never hang the app.
 */
import path from 'node:path';
import { DEFAULT_IGNORE, DEFAULT_SCAN_LIMITS } from '../domain/constants.js';
import { createMatcher } from './glob.js';
import { readWorkspaceText } from './fs-safe.js';
import { toPosix } from './util.js';

const HARD_IGNORE = ['.git/**', '.git', 'node_modules/**', 'node_modules'];

export async function loadGitignore(projectRoot, dirRel = '') {
  const rel = dirRel ? `${dirRel}/.gitignore` : '.gitignore';
  const res = await readWorkspaceText(projectRoot, rel, { maxBytes: 256 * 1024 });
  if (!res.ok) return [];
  return res.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((pattern) => {
      const negated = pattern.startsWith('!');
      const body = negated ? pattern.slice(1) : pattern;
      const absolute = body.startsWith('/');
      const cleaned = body.replace(/^\//, '').replace(/\/$/, '');
      if (absolute) return `${negated ? '!' : ''}${cleaned}`;
      if (cleaned.includes('/')) return `${negated ? '!' : ''}${dirRel ? `${dirRel}/` : ''}${cleaned}`;
      return `${negated ? '!' : ''}${cleaned}`;
    });
}

export class IgnoreEngine {
  constructor({ root, userPatterns = [], gitignorePatterns = [], limits = {} } = {}) {
    this.root = root;
    this.limits = { ...DEFAULT_SCAN_LIMITS, ...limits };
    this.hardMatcher = createMatcher(HARD_IGNORE);
    this.defaultMatcher = createMatcher(DEFAULT_IGNORE);
    this.gitMatcher = createMatcher(gitignorePatterns);
    this.userMatcher = createMatcher(userPatterns);
    this.stats = { ignoredHard: 0, ignoredDefault: 0, ignoredGitignore: 0, ignoredUser: 0, visited: 0 };
  }

  static async fromProject({ root, userPatterns = [], limits = {} }) {
    const gitignorePatterns = await loadGitignore(root);
    return new IgnoreEngine({ root, userPatterns, gitignorePatterns, limits });
  }

  /** @returns {{ignored:boolean, reason?:string}} */
  check(relPath, { isDir = false } = {}) {
    const p = toPosix(relPath).replace(/^\.\//, '');
    if (!p || p === '.') return { ignored: false };
    this.stats.visited += 1;
    if (this.hardMatcher.matches(p)) { this.stats.ignoredHard += 1; return { ignored: true, reason: 'default-hard' }; }
    if (this.defaultMatcher.matches(p) || (isDir && this.defaultMatcher.matchesDir(p))) {
      this.stats.ignoredDefault += 1;
      return { ignored: true, reason: 'default' };
    }
    if (this.userMatcher.matches(p)) { this.stats.ignoredUser += 1; return { ignored: true, reason: 'user' }; }
    if (this.gitMatcher.matches(p) || (isDir && this.gitMatcher.matchesDir(p))) {
      this.stats.ignoredGitignore += 1;
      return { ignored: true, reason: 'gitignore' };
    }
    return { ignored: false };
  }

  exceedsDepth(relPath) {
    const depth = toPosix(relPath).split('/').length;
    return depth > this.limits.maxDepth;
  }

  describe() {
    return {
      root: this.root,
      defaults: DEFAULT_IGNORE.length,
      gitignore: this.gitMatcher.patterns.length,
      user: this.userMatcher.patterns.length,
      limits: this.limits,
    };
  }
}

export function defaultIgnoreList() { return [...DEFAULT_IGNORE]; }

export function resolveRel(root, abs) { return toPosix(path.relative(root, abs)); }
