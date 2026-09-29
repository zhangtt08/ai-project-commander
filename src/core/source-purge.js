/**
 * User-initiated removal of a managed project's **source directory**.
 *
 * ADR-009 keeps the analysis pipeline read-only toward managed workspaces; that invariant
 * still holds — nothing here runs during a scan. This module is the single, explicitly
 * invoked exception, and it refuses any path that is not plausibly a user-owned project.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { toPosix } from './util.js';
import { ValidationError } from '../domain/errors.js';

/** Directories that must never be removed, no matter what the database says. */
function systemGuardrails() {
  const home = os.homedir();
  const out = [path.parse(home).root, home];
  for (const sub of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music']) {
    out.push(path.join(home, sub));
  }
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  out.push(programData);
  for (const env of ['SystemRoot', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    if (process.env[env]) out.push(process.env[env]);
  }
  return out.filter(Boolean).map((p) => norm(p));
}

function norm(p) {
  const resolved = path.resolve(String(p));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Count files/bytes with a bounded walk so a huge tree cannot hang the request. */
function measure(target, cap = 50000) {
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files >= cap) {
        truncated = true;
        break;
      }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        bytes += fs.statSync(full).size;
        files += 1;
      } catch { /* vanished mid-walk */ }
    }
  }
  return { files, bytes, truncated };
}

/**
 * Decide whether `workspacePath` may be wiped from disk.
 * Returns `{ ok:false, reason }` instead of throwing so the UI can show every blocker.
 */
export function assessPurgeTarget(workspacePath, { ownDataDir = null } = {}) {
  const display = toPosix(String(workspacePath || ''));
  if (!display) return { ok: false, reason: '路径为空', display };
  if (!path.isAbsolute(display)) return { ok: false, reason: '不是绝对路径', display };

  let real;
  try {
    real = fs.realpathSync(display);
  } catch {
    return { ok: false, reason: '目录不存在（可能已被移动或删除）', display };
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch (err) {
    return { ok: false, reason: `无法读取目录：${err.message}`, display };
  }
  if (!st.isDirectory()) return { ok: false, reason: '目标不是目录', display: toPosix(real) };

  const target = norm(real);
  const root = path.parse(target).root;
  if (target === root) return { ok: false, reason: '拒绝删除磁盘根目录', display: toPosix(real) };

  const depth = path.relative(root, target).split(path.sep).filter(Boolean).length;
  if (depth < 2) {
    return { ok: false, reason: `目录层级过浅（第 ${depth} 层），不像一个项目目录`, display: toPosix(real) };
  }

  for (const guard of systemGuardrails()) {
    if (target === guard) return { ok: false, reason: '目标是系统保护的常用目录，拒绝删除', display: toPosix(real) };
  }

  if (ownDataDir) {
    const own = norm(ownDataDir);
    if (target === own || own.startsWith(target + path.sep) || target.startsWith(own + path.sep)) {
      return { ok: false, reason: '目标位于 Commander 自身的数据/程序目录内，拒绝删除', display: toPosix(real) };
    }
  }

  const stats = measure(real);
  return {
    ok: true,
    display: toPosix(real),
    realPath: real,
    name: path.basename(real),
    depth,
    fileCount: stats.files,
    totalBytes: stats.bytes,
    truncatedStats: stats.truncated,
    /** UI must echo this back before we act — proves the user saw the exact path. */
    confirmToken: path.basename(real),
  };
}

/**
 * Remove the directory. Callers must pass an `assessPurgeTarget()` result that is `ok`,
 * and must supply the confirmation token the user typed/acknowledged.
 */
export function purgeDirectory(assessed, { confirmToken } = {}) {
  if (!assessed || !assessed.ok) {
    throw new ValidationError(`拒绝删除：${assessed ? assessed.reason : '目标未通过校验'}`);
  }
  if (confirmToken !== assessed.confirmToken) {
    throw new ValidationError(`确认口令不匹配：请填写「${assessed.confirmToken}」以确认删除该目录`);
  }
  const recheck = assessPurgeTarget(assessed.realPath);
  if (!recheck.ok) throw new ValidationError(`拒绝删除：${recheck.reason}`);

  fs.rmSync(assessed.realPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const gone = !fs.existsSync(assessed.realPath);
  return {
    removed: gone,
    path: assessed.display,
    fileCount: assessed.fileCount,
    freedBytes: assessed.totalBytes,
  };
}

export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}
