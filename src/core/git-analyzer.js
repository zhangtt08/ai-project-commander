/**
 * GitAnalyzer — requirement #16.
 * All facts come from deterministic git commands run through CommandRunner.
 * Degrades gracefully when: git is not installed, the path is not a repository,
 * or the repository is empty (no commits).
 */
import { logger } from './logger.js';
import { nowIso } from './util.js';

const log = logger.child('git');

function parsePorcelain(stdout) {
  const modified = [];
  const added = [];
  const deleted = [];
  const untracked = [];
  const renamed = [];
  const conflicted = [];
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    let filePart = line.slice(3);
    if (x === 'R' || y === 'R') {
      const [from, to] = filePart.split(' -> ');
      renamed.push({ from: (from || '').trim(), to: (to || '').trim() });
      continue;
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      conflicted.push(filePart.trim());
      continue;
    }
    if (x === '?' || y === '?') { untracked.push(filePart.trim()); continue; }
    if (x === 'A') { added.push(filePart.trim()); continue; }
    if (x === 'D' || y === 'D') { deleted.push(filePart.trim()); continue; }
    if (x === 'M' || y === 'M' || x === 'T' || y === 'T') { modified.push(filePart.trim()); continue; }
    modified.push(filePart.trim());
  }
  return { modified, added, deleted, untracked, renamed, conflicted };
}

function parseShortstat(stdout) {
  const text = String(stdout || '').trim();
  const files = /(\d+) files? changed/.exec(text);
  const insertions = /(\d+) insertions?\(\+\)/.exec(text);
  const deletions = /(\d+) deletions?\(-\)/.exec(text);
  return {
    raw: text,
    filesChanged: files ? Number(files[1]) : 0,
    insertions: insertions ? Number(insertions[1]) : 0,
    deletions: deletions ? Number(deletions[1]) : 0,
  };
}

function parseNumstat(stdout) {
  const rows = String(stdout || '').split(/\r?\n/).filter(Boolean);
  return rows.slice(0, 200).map((line) => {
    const [a, d, ...rest] = line.split('\t');
    return {
      path: rest.join('\t'),
      insertions: a === '-' ? null : Number(a),
      deletions: d === '-' ? null : Number(d),
      binary: a === '-',
    };
  });
}

export class GitAnalyzer {
  constructor({ runner }) { this.runner = runner; }

  async #git(cwd, args, purpose, timeoutMs = 30000) {
    return this.runner.run({ command: 'git', args, cwd, purpose, timeoutMs });
  }

  /**
   * @param {string} root
   * @returns {Promise<GitAnalysis>}
   */
  async analyze(root, { recentCommitCount = 15, includeDiff = true } = {}) {
    const ts = nowIso();
    const base = {
      ts,
      root,
      isRepository: false,
      gitAvailable: true,
      branch: '',
      commitHash: '',
      commitShort: '',
      commitSubject: '',
      commitAuthor: '',
      commitTime: '',
      workingTreeClean: true,
      modified: [], added: [], deleted: [], untracked: [], renamed: [], conflicted: [],
      changedFileCount: 0,
      diffSummary: { raw: '', filesChanged: 0, insertions: 0, deletions: 0, numstat: [] },
      recentCommits: [],
      isUnborn: false,
      error: '',
    };

    const probe = await this.#git(root, ['rev-parse', '--is-inside-work-tree'], 'detect repository');
    if (probe.executableMissing) {
      return { ...base, gitAvailable: false, error: 'git is not installed or not on PATH' };
    }
    if (probe.exitCode !== 0) {
      return { ...base, error: 'not a git repository (or not inside a work tree)' };
    }
    base.isRepository = true;

    const [branchRes, headRes, statusRes] = await Promise.all([
      this.#git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 'current branch'),
      this.#git(root, ['rev-parse', 'HEAD'], 'current commit'),
      this.#git(root, ['status', '--porcelain', '--untracked-files=normal'], 'working tree status'),
    ]);

    base.isUnborn = headRes.exitCode !== 0;
    base.branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : (base.isUnborn ? '(no commits yet)' : 'unknown');
    base.commitHash = headRes.exitCode === 0 ? headRes.stdout.trim() : '';
    base.commitShort = base.commitHash ? base.commitHash.slice(0, 7) : '';

    if (statusRes.exitCode === 0) {
      const parsed = parsePorcelain(statusRes.stdout);
      Object.assign(base, parsed);
      base.changedFileCount = parsed.modified.length + parsed.added.length + parsed.deleted.length + parsed.renamed.length + parsed.conflicted.length;
      base.workingTreeClean = base.changedFileCount === 0 && parsed.untracked.length === 0;
    }

    if (!base.isUnborn) {
      const [logRes, diffShortRes, diffNumRes] = await Promise.all([
        this.#git(root, ['log', `-n`, String(recentCommitCount), '--pretty=format:%h\x1f%an\x1f%aI\x1f%s'], 'recent commits'),
        includeDiff ? this.#git(root, ['diff', '--shortstat'], 'diff summary') : Promise.resolve({ exitCode: 0, stdout: '' }),
        includeDiff ? this.#git(root, ['diff', '--numstat'], 'diff numstat') : Promise.resolve({ exitCode: 0, stdout: '' }),
      ]);

      if (logRes.exitCode === 0) {
        base.recentCommits = logRes.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
          const [hash, author, date, subject] = line.split('\x1f');
          return { hash, author, date, subject };
        });
        const last = base.recentCommits[0];
        if (last) {
          base.commitSubject = last.subject || '';
          base.commitAuthor = last.author || '';
          base.commitTime = last.date || '';
        }
      }

      if (diffShortRes.exitCode === 0) {
        base.diffSummary = { ...parseShortstat(diffShortRes.stdout), numstat: parseNumstat(diffNumRes.stdout) };
      }
    } else {
      base.error = 'repository has no commits yet';
    }

    log.debug('analyzed', { root, branch: base.branch, dirty: !base.workingTreeClean, changed: base.changedFileCount });
    return base;
  }

  /** Deterministic list of files changed since a given commit (used by ChangeAnalyzer). */
  async changedSince(root, commitish, { maxFiles = 300 } = {}) {
    const res = await this.#git(root, ['diff', '--name-status', `${commitish}..HEAD`], 'changes since commit');
    if (res.exitCode !== 0) return { ok: false, error: res.stderrSummary || 'git diff failed', files: [] };
    const files = res.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxFiles).map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status, path: rest.join('\t') };
    });
    return { ok: true, files };
  }
}

export function gitSummaryLine(g) {
  if (!g) return 'unknown';
  if (!g.gitAvailable) return 'git unavailable';
  if (!g.isRepository) return 'not a repository';
  const dirty = g.workingTreeClean ? 'clean' : `dirty (${g.changedFileCount + g.untracked.length} files)`;
  return `${g.branch} @ ${g.commitShort || 'no-commit'} · ${dirty}`;
}
