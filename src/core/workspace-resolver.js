/**
 * WorkspaceResolver — powers the drag-and-drop import module (requirement: 可识别的模块).
 *
 * Browsers cannot read the absolute path of a dropped folder (security model), so the
 * drop zone only knows the folder NAME + its top-level entries. This module resolves
 * that name back to a real local directory by searching a configurable set of roots,
 * then runs the real ProjectScanner on each candidate so the UI can show what was
 * recognised (language / framework / file count) before the user confirms.
 *
 * READ-ONLY: this module only probes the filesystem, it never writes (ADR-009).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';

const log = logger.child('resolver');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache',
  '$Recycle.Bin', 'System Volume Information', 'Windows', 'Program Files',
  'Program Files (x86)', 'ProgramData', 'AppData', '.vscode', '.idea',
]);

/** Default search roots, ordered by likelihood. */
export function defaultSearchRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    home,
  ];
  for (const drive of ['C:\\', 'D:\\', 'E:\\']) {
    if (fs.existsSync(drive)) roots.push(drive);
  }
  return roots;
}

function normaliseName(name) {
  return String(name || '').trim().toLowerCase().replace(/[/\\]+$/, '');
}

/**
 * Search the roots for directories whose name matches.
 * @returns {Array<{path:string, root:string, match:'exact'|'fuzzy'}>}
 */
export function findCandidates(folderName, { roots = null, maxDepth = 2, maxResults = 12, timeBudgetMs = 4000 } = {}) {
  const want = normaliseName(folderName);
  if (!want) return [];
  const searchRoots = (roots && roots.length ? roots : defaultSearchRoots())
    .map((r) => path.resolve(r))
    .filter((r) => {
      try { return fs.existsSync(r) && fs.statSync(r).isDirectory(); } catch { return false; }
    });

  const candidates = [];
  const started = Date.now();

  const walk = (dir, depth, rootLabel) => {
    if (candidates.length >= maxResults || Date.now() - started > timeBudgetMs) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (candidates.length >= maxResults || Date.now() - started > timeBudgetMs) return;
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const name = entry.name.toLowerCase();
      if (name === want) {
        candidates.push({ path: full, root: rootLabel, match: 'exact' });
      } else if (depth === 1 && (name.includes(want) || want.includes(name)) && name.length >= 4) {
        // fuzzy matches only at the top level of each root, to keep noise down
        candidates.push({ path: full, root: rootLabel, match: 'fuzzy' });
      }
      if (depth < maxDepth && name === want) continue; // do not descend into an exact match
      if (depth < maxDepth) walk(full, depth + 1, rootLabel);
    }
  };

  for (const root of searchRoots) {
    walk(root, 1, root);
    if (candidates.length >= maxResults) break;
  }

  // Exact matches first, then shallower paths.
  const rank = (c) => (c.match === 'exact' ? 0 : 1) * 10000 + c.path.split(/[\\/]/).length;
  return candidates
    .filter((c, i, arr) => arr.findIndex((x) => x.path.toLowerCase() === c.path.toLowerCase()) === i)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, maxResults);
}

/**
 * Recognise a candidate directory with the real scanner (bounded: metadata only,
 * no command execution). Returns the fields the drop-zone UI shows as badges.
 */
export async function recogniseCandidate(root, { scanner, limits = { maxFiles: 4000 } } = {}) {
  try {
    const meta = await scanner.scan(root, { limits });
    if (!meta.ok) return { path: root, recognised: false, reason: meta.reason };
    return {
      path: meta.root,
      recognised: true,
      name: meta.name,
      language: meta.primaryLanguage,
      framework: meta.framework,
      frameworks: (meta.frameworks || []).slice(0, 4),
      packageManager: meta.packageManager,
      fileCount: meta.fileCount,
      isGit: !!meta.isGitRepositoryHint,
      hasSpec: (meta.specCandidates || []).length > 0,
      truncated: !!meta.truncated,
    };
  } catch (err) {
    log.warn('recognise_failed', { root, error: err.message });
    return { path: root, recognised: false, reason: err.message };
  }
}
