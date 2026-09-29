/**
 * Safe filesystem facade — the ONLY sanctioned way to read files from a managed workspace.
 *
 * Guarantees:
 *  - sensitive paths are never read (ADR-004)
 *  - size limits enforced
 *  - binary files detected and skipped
 *  - READ ONLY: this module exposes no write/delete/rename operation (ADR-009)
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { assertNotSensitive, isSensitive } from './sensitive.js';
import { DEFAULT_SCAN_LIMITS } from '../domain/constants.js';
import { toPosix } from './util.js';

export const FILE_READ_AUDIT = { reads: 0, skippedSensitive: 0, skippedBinary: 0, skippedLarge: 0, skippedMissing: 0 };

export function resetReadAudit() {
  FILE_READ_AUDIT.reads = 0;
  FILE_READ_AUDIT.skippedSensitive = 0;
  FILE_READ_AUDIT.skippedBinary = 0;
  FILE_READ_AUDIT.skippedLarge = 0;
  FILE_READ_AUDIT.skippedMissing = 0;
}

/** Called when a path is rejected before any read attempt (e.g. by the scanner walker). */
export function noteSensitiveSkip() { FILE_READ_AUDIT.skippedSensitive += 1; }

export async function pathExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

export async function statSafe(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

export async function lstatSafe(p) {
  try { return await fsp.lstat(p); } catch { return null; }
}

export async function readDirSafe(p) {
  try {
    return await fsp.readdir(p, { withFileTypes: true });
  } catch { return []; }
}

export function looksBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  if (len === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < len; i += 1) {
    const b = buffer[i];
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32)) suspicious += 1;
  }
  return suspicious / len > 0.15;
}

/**
 * Read a text file from a managed workspace with all guards applied.
 * @returns {Promise<{ok:true, text:string, bytes:number}|{ok:false, reason:string}>}
 */
export async function readWorkspaceText(projectRoot, relPath, { maxBytes = DEFAULT_SCAN_LIMITS.maxReadBytesForSnippet } = {}) {
  const rel = toPosix(relPath);
  if (isSensitive(rel)) {
    FILE_READ_AUDIT.skippedSensitive += 1;
    return { ok: false, reason: 'sensitive_file_protected' };
  }
  assertNotSensitive(rel);
  const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  if (!isInside(projectRoot, abs)) return { ok: false, reason: 'outside_workspace' };
  let stat;
  try { stat = await fsp.stat(abs); } catch {
    FILE_READ_AUDIT.skippedMissing += 1;
    return { ok: false, reason: 'not_found' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not_a_file' };
  if (stat.size > maxBytes) {
    FILE_READ_AUDIT.skippedLarge += 1;
    return { ok: false, reason: 'too_large', bytes: stat.size };
  }
  let buffer;
  try { buffer = await fsp.readFile(abs); } catch (err) {
    return { ok: false, reason: `read_error:${err.code || 'unknown'}` };
  }
  if (looksBinary(buffer)) {
    FILE_READ_AUDIT.skippedBinary += 1;
    return { ok: false, reason: 'binary', bytes: stat.size };
  }
  FILE_READ_AUDIT.reads += 1;
  return { ok: true, text: buffer.toString('utf8'), bytes: stat.size };
}

export function readWorkspaceTextSync(projectRoot, relPath, { maxBytes = DEFAULT_SCAN_LIMITS.maxReadBytesForSnippet } = {}) {
  const rel = toPosix(relPath);
  const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  const relForCheck = toPosix(path.relative(projectRoot, abs));
  if (isSensitive(relForCheck)) {
    FILE_READ_AUDIT.skippedSensitive += 1;
    return { ok: false, reason: 'sensitive_file_protected' };
  }
  assertNotSensitive(relForCheck);
  if (!isInside(projectRoot, abs)) return { ok: false, reason: 'outside_workspace' };
  let stat;
  try { stat = fs.statSync(abs); } catch {
    FILE_READ_AUDIT.skippedMissing += 1;
    return { ok: false, reason: 'not_found' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not_a_file' };
  if (stat.size > maxBytes) {
    FILE_READ_AUDIT.skippedLarge += 1;
    return { ok: false, reason: 'too_large', bytes: stat.size };
  }
  let buffer;
  try { buffer = fs.readFileSync(abs); } catch (err) {
    return { ok: false, reason: `read_error:${err.code || 'unknown'}` };
  }
  if (looksBinary(buffer)) {
    FILE_READ_AUDIT.skippedBinary += 1;
    return { ok: false, reason: 'binary', bytes: stat.size };
  }
  FILE_READ_AUDIT.reads += 1;
  return { ok: true, text: buffer.toString('utf8'), bytes: stat.size };
}

export function isInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Expand a Windows 8.3 short path (C:\Users\ADMINI~1\...) to its long form.
 *
 * libuv asserts that a directory-change notification's filename begins with the
 * watched path, but Windows reports notifications using long names. Watching a
 * short-form path therefore aborts the entire Node process on the first event —
 * no JS exception, so no try/catch can contain it. Accounts with names longer
 * than 8 characters (e.g. "Administrator") get short forms from os.tmpdir() and
 * from some shell integrations, so every path that reaches fs.watch goes through
 * here first.
 */
export function expandShortPath(p) {
  if (process.platform !== 'win32' || typeof p !== 'string' || !p) return p;
  if (!/[~]\d/.test(p)) return p;
  try { return fs.realpathSync.native(p) || p; } catch { return p; }
}
