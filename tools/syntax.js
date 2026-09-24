/** Shared syntax checker. Uses async spawn — spawnSync from a running Node process returns EBUSY in this sandbox. */
import { spawn } from 'node:child_process';

export function checkSyntax(file) {
  return new Promise((resolve) => {
    let stderr = '';
    let child;
    try {
      child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ ok: false, reason: `spawn failed: ${err.message}` });
      return;
    }
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => resolve({ ok: false, reason: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, reason: code === 0 ? '' : firstMeaningfulLine(stderr) }));
  });
}

function firstMeaningfulLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const detail = lines.find((l) => /Error|error/.test(l)) || lines[0] || 'unknown syntax error';
  return detail.slice(0, 300);
}

export async function checkSyntaxAll(files, { concurrency = 4 } = {}) {
  const results = [];
  let index = 0;
  const worker = async () => {
    while (index < files.length) {
      const i = index;
      index += 1;
      const file = files[i];
      // eslint-disable-next-line no-await-in-loop
      const res = await checkSyntax(file);
      results.push({ file, ...res });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}
