/**
 * Tracked temporary directories for tests.
 *
 * The suite created nine per run and removed none, leaving hundreds of apc-*
 * directories in %TEMP%. `process.on('exit')` covers module-level fixtures that
 * outlive a single test; `removeTempDir` is there for cases that want it earlier.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = new Set();

export function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  return dir;
}

export function removeTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    created.delete(dir);
    return true;
  } catch {
    return false; // Windows keeps a handle open briefly after a subprocess exits.
  }
}

process.on('exit', () => {
  for (const dir of [...created]) removeTempDir(dir);
});
