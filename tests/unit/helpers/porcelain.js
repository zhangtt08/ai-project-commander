/** Test-side re-implementation of the porcelain parser so the production one is verified against an independent oracle. */
export function parsePorcelainSafe(stdout) {
  const modified = [];
  const added = [];
  const deleted = [];
  const untracked = [];
  const renamed = [];
  const conflicted = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3).trim();
    if (x === 'R' || y === 'R') {
      const [from, to] = rest.split(' -> ');
      renamed.push({ from: (from || '').trim(), to: (to || '').trim() });
    } else if (x === '?' || y === '?') untracked.push(rest);
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) conflicted.push(rest);
    else if (x === 'A') added.push(rest);
    else if (x === 'D' || y === 'D') deleted.push(rest);
    else modified.push(rest);
  }
  return { modified, added, deleted, untracked, renamed, conflicted };
}
