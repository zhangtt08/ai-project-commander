/**
 * Machine-wide project discovery — answers "这台电脑上有哪些项目".
 *
 * Walks the user's project roots breadth-first, bounded by depth and result count, and
 * reports every directory that carries a recognised project marker. Read-only: discovery
 * never writes into the directories it inspects (ADR-009).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { toPosix } from './util.js';
import { expandShortPath } from './fs-safe.js';

/** marker file -> { ecosystem, kind } — presence of any of these means "this is a project". */
export const PROJECT_MARKERS = Object.freeze([
  { file: 'package.json', ecosystem: 'node', weight: 3 },
  { file: 'pyproject.toml', ecosystem: 'python', weight: 3 },
  { file: 'setup.py', ecosystem: 'python', weight: 3 },
  { file: 'requirements.txt', ecosystem: 'python', weight: 2 },
  { file: 'environment.yml', ecosystem: 'python', weight: 2 },
  { file: 'Cargo.toml', ecosystem: 'rust', weight: 3 },
  { file: 'go.mod', ecosystem: 'go', weight: 3 },
  { file: 'pom.xml', ecosystem: 'java', weight: 3 },
  { file: 'build.gradle', ecosystem: 'java', weight: 3 },
  { file: 'Gemfile', ecosystem: 'ruby', weight: 3 },
  { file: 'composer.json', ecosystem: 'php', weight: 3 },
  { file: 'pubspec.yaml', ecosystem: 'dart', weight: 3 },
  { file: 'mix.exs', ecosystem: 'elixir', weight: 3 },
  { file: 'CMakeLists.txt', ecosystem: 'cpp', weight: 2 },
  { file: 'Makefile', ecosystem: 'generic', weight: 1 },
  { file: 'docker-compose.yml', ecosystem: 'infra', weight: 1 },
  { file: 'Dockerfile', ecosystem: 'infra', weight: 1 },
]);

/** Files that alone are weak, but combined with a repo mean "real project". */
const REPO_MARKER = '.git';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'env', '.tox',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.cache', 'coverage', '.turbo',
  'vendor', '.idea', '.vscode', '.gradle', '.mvn', 'site-packages', '.pytest_cache',
  '.qoder-cn', '.qoder', '.claude', '.codex', '.ollama', 'AppData', 'Application Data',
  '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', 'Recovery', 'OneDrive', 'Pictures', 'Videos', 'Music', 'Favorites', 'Links',
  'Saved Games', 'Searches', 'Downloads', 'wsl$', 'Docker', 'node-gyp', '.pnpm-store',
]);

/** Directories that are never projects even if they contain markers. */
const CONTAINER_DIRS = new Set(['Desktop', 'Documents', 'Home', '用户', 'projects', 'source', 'repos', 'code']);

export function defaultRoots() {
  const home = os.homedir();
  const out = [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'source')];
  if (process.platform === 'win32') {
    for (const letter of ['D', 'E', 'F']) {
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) out.push(drive);
      } catch { /* unreadable drive */ }
    }
  }
  return [...new Set(out.map((p) => path.resolve(p)))];
}

function hasProjectMarker(dir) {
  const found = [];
  for (const marker of PROJECT_MARKERS) {
    try {
      if (fs.statSync(path.join(dir, marker.file)).isFile()) found.push(marker);
    } catch { /* not present */ }
  }
  let isRepo = false;
  try {
    isRepo = fs.statSync(path.join(dir, REPO_MARKER)).isDirectory();
  } catch { /* not a repo */ }
  return { found, isRepo };
}

/** A directory holding only a manifest, a lockfile and node_modules is an install scratch dir, not a project. */
const NON_SOURCE_FILES = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|readme(\.md)?|license|\.gitignore|\.npmrc)$/i;
const SOURCE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|go|rs|java|kt|rb|php|c|h|cpp|hpp|cs|swift|scala|lua|sh|dart)$/i;

function looksLikeScratchInstall(dir, entries) {
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const subDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const hasNodeModules = subDirs.includes('node_modules');
  const realFiles = files.filter((f) => !NON_SOURCE_FILES.test(f));
  const realSource = files.filter((f) => SOURCE_EXT.test(f));
  // Nothing but manifests, and no top-level source of its own.
  return hasNodeModules && realFiles.length === 0 && realSource.length === 0;
}

/** A directory is a project when markers are strong enough, or it is a repo with content. */
function judge(dir, { found, isRepo }, childDirCount, scratch = false) {
  const weight = found.reduce((a, m) => a + m.weight, 0);
  // A bare `npm install <pkg>` folder would otherwise score as a node project via package.json.
  if (scratch && weight <= 3 && !isRepo) return { accept: false, confidence: 'low', scratch: true };
  if (weight >= 3) return { accept: true, confidence: scratch ? 'low' : 'high' };
  if (isRepo && (weight >= 1 || childDirCount > 0)) return { accept: true, confidence: 'high' };
  if (weight >= 2) return { accept: true, confidence: 'medium' };
  if (isRepo) return { accept: true, confidence: 'medium' };
  return { accept: false, confidence: 'low' };
}

function peekName(dir, packageJsonPresent) {
  if (packageJsonPresent) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim();
    } catch { /* malformed package.json is not fatal to discovery */ }
  }
  return path.basename(dir);
}

/**
 * @param {string[]} roots
 * @param {(absPath:string)=>boolean} [isManaged] marks already-imported projects
 * @returns {{projects: Array, roots: string[], truncated: boolean, scannedDirs: number, elapsedMs: number}}
 */
export function discoverProjects({
  roots = defaultRoots(),
  maxDepth = 3,
  limit = 300,
  isManaged = () => false,
  timeBudgetMs = 12000,
} = {}) {
  const started = Date.now();
  const projects = [];
  const seen = new Set();
  const rootLabels = [];
  let scannedDirs = 0;
  let truncated = false;

  const queue = [];
  for (const raw of roots) {
    let abs;
    try {
      abs = path.resolve(String(raw));
    } catch {
      continue;
    }
    if (!fs.existsSync(abs)) continue;
    const label = abs.split(path.sep)[0] || abs;
    rootLabels.push(toPosix(abs));
    queue.push({ dir: abs, depth: 0, root: label });
  }

  while (queue.length) {
    const { dir, depth, root } = queue.shift();
    if (projects.length >= limit) {
      truncated = true;
      break;
    }
    if (Date.now() - started > timeBudgetMs) {
      truncated = true;
      break;
    }
    const key = norm(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    scannedDirs += 1;

    const base = path.basename(dir);
    if (depth > 0 && (SKIP_DIRS.has(base) || base.startsWith('.'))) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const markers = hasProjectMarker(dir);
    const subDirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));
    const scratch = depth > 0 && markers.found.length > 0 && looksLikeScratchInstall(dir, entries);
    const verdict = judge(dir, markers, subDirs.length, scratch);

    if (depth > 0 && verdict.accept) {
      const abs = canonical(dir);
      const pkg = markers.found.some((m) => m.file === 'package.json');
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(abs).mtimeMs;
      } catch { /* raced */ }
      projects.push({
        path: toPosix(abs),
        name: peekName(abs, pkg),
        folderName: base,
        ecosystems: [...new Set(markers.found.map((m) => m.ecosystem))],
        markers: markers.found.map((m) => m.file),
        isGitRepository: markers.isRepo,
        confidence: verdict.confidence,
        looksLikeScratchInstall: !!verdict.scratch || scratch,
        managed: isManaged(abs),
        lastModifiedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
        childDirCount: subDirs.length,
        root: toPosix(root),
      });
      // Do not descend into a project: nested packages are noise for a management view.
      continue;
    }

    if (depth >= maxDepth) continue;
    if (depth === 0 && !CONTAINER_DIRS.has(base) && subDirs.length > 25) {
      // A top-level dir that is itself a bucket of projects: keep walking one level.
    }
    for (const entry of subDirs) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1, root });
  }

  projects.sort((a, b) => {
    if (a.managed !== b.managed) return a.managed ? 1 : -1;
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return String(a.lastModifiedAt || '').localeCompare(String(b.lastModifiedAt || '')) * -1;
  });

  return { projects, roots: rootLabels, truncated, scannedDirs, elapsedMs: Date.now() - started };
}

function norm(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Windows hands back 8.3 short names (C:\Users\ADMINI~1\…) from some temp/redirected
 * paths, while the registry stores paths run through expandShortPath(). Without the same
 * expansion a discovered folder never matches the project already imported.
 */
function canonical(p) {
  let out = path.resolve(p);
  try {
    out = fs.realpathSync(out);
  } catch { /* unreadable — fall back to the resolved form */ }
  return expandShortPath(out);
}
