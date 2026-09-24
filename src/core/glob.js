/** Minimal glob -> RegExp translation + matcher. Supports ** * ? [abc] {a,b} and negation via the caller. */
import { toPosix } from './util.js';

export function globToRegExp(pattern) {
  let p = toPosix(pattern).trim();
  if (p.startsWith('./')) p = p.slice(2);
  const negated = p.startsWith('!');
  if (negated) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const prevSlash = i === 0 || p[i - 1] === '/';
        const nextSlash = p[i + 2] === '/';
        if (prevSlash && nextSlash) { re += '(?:.*/)?'; i += 2; }
        else if (prevSlash) { re += '.*'; i += 1; }
        else { re += '[^/]*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i);
      if (end === -1) re += '\\[';
      else { re += p.slice(i, end + 1); i = end; }
    } else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        const alts = p.slice(i + 1, end).split(',').map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = end;
      }
    } else if ('.+^$()|\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  const anchored = p.includes('/') || p.startsWith('**');
  return { rx: new RegExp(anchored ? `^${re}$` : `(^|/)${re}$`), negated, source: pattern };
}

export function createMatcher(patterns) {
  const compiled = patterns.filter(Boolean).map(globToRegExp);
  // A pattern without a slash follows .gitignore semantics: it matches a file OR
  // directory name at any depth (e.g. "node_modules", "dist", "*.log").
  const matchOne = (c, p, base, segments) => {
    if (c.negated) return false;
    if (c.rx.test(p)) return true;
    if (c.source.includes('/')) return false;
    if (c.rx.test(base)) return true;
    return segments.some((seg) => c.rx.test(seg));
  };
  return {
    patterns: compiled,
    matches(relPath) {
      const p = toPosix(relPath).replace(/^\//, '');
      const base = p.split('/').pop();
      const segments = p.split('/');
      return compiled.some((c) => matchOne(c, p, base, segments));
    },
    /** directory-only quick check used to prune recursion */
    matchesDir(relPath) {
      const p = toPosix(relPath).replace(/^\//, '');
      const base = p.split('/').pop();
      const segments = p.split('/');
      return compiled.some((c) => !c.negated && (c.rx.test(p) || c.rx.test(`${p}/x`) || (!c.source.includes('/') && (c.rx.test(base) || segments.some((seg) => c.rx.test(seg))))));
    },
  };
}
