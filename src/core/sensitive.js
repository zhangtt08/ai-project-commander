/**
 * SensitiveFileDetector — requirement #11 / ADR-004.
 *
 * Policy: existence may be recorded (path + rule name + size). Content may NOT be
 * read, stored, logged or sent to any AI provider.
 */
import path from 'node:path';
import { SENSITIVE_PATTERNS } from '../domain/constants.js';
import { createMatcher } from './glob.js';
import { toPosix } from './util.js';

const matcher = createMatcher(SENSITIVE_PATTERNS.map((p) => p.pattern));
const RULE_BY_PATTERN = new Map(SENSITIVE_PATTERNS.map((p) => [p.pattern, p.rule]));

/** Extra basename heuristics that are not glob-friendly. */
const BASENAME_RULES = [
  { rx: /^\.env(\.|$)/i, rule: 'env_file' },
  { rx: /\.(pem|key|p12|pfx|jks|keystore)$/i, rule: 'private_key' },
  { rx: /^id_(rsa|dsa|ecdsa|ed25519)$/i, rule: 'ssh_private_key' },
  { rx: /^credentials(\.|$)/i, rule: 'credentials' },
  { rx: /^secrets?(\.|$)/i, rule: 'secrets' },
  { rx: /^tokens?(\.|$)/i, rule: 'tokens' },
  { rx: /^\.(npmrc|pypirc|netrc|git-credentials)$/i, rule: 'credentials_file' },
  { rx: /^serviceAccount.*\.json$/i, rule: 'cloud_credentials' },
  { rx: /^secring\.gpg$/i, rule: 'gpg_key' },
];

export const SENSITIVE_POLICY_TEXT =
  'Sensitive file protection is active: contents are never read, stored, logged or sent to AI providers.';

export function detectSensitive(relPath) {
  const p = toPosix(relPath).replace(/^\//, '');
  const base = p.split('/').pop();
  for (const { rx, rule } of BASENAME_RULES) {
    if (rx.test(base)) return { sensitive: true, rule };
  }
  if (matcher.matches(p)) {
    for (const { pattern, rule } of SENSITIVE_PATTERNS) {
      const m = createMatcher([pattern]);
      if (m.matches(p)) return { sensitive: true, rule };
    }
    return { sensitive: true, rule: 'matched_pattern' };
  }
  return { sensitive: false, rule: null };
}

export function isSensitive(relPath) { return detectSensitive(relPath).sensitive; }

export function ruleForPattern(pattern) { return RULE_BY_PATTERN.get(pattern) || 'matched_pattern'; }

export class SensitivePathError extends Error {
  constructor(relPath, rule) {
    super(`refused to read sensitive file "${relPath}" (rule: ${rule}). Contents are protected and are never read.`);
    this.name = 'SensitivePathError';
    this.code = 'sensitive_file_protected';
    this.relPath = relPath;
    this.rule = rule;
  }
}

/** Audit helper: returns only metadata, never content. */
export function describeSensitive(relPath, sizeBytes) {
  const d = detectSensitive(relPath);
  if (!d.sensitive) return null;
  return { path: toPosix(relPath), rule: d.rule, sizeBytes };
}

export function assertNotSensitive(relPath) {
  const d = detectSensitive(relPath);
  if (d.sensitive) throw new SensitivePathError(toPosix(relPath), d.rule);
}

export function sensitiveRelative(projectRoot, absPath) {
  return toPosix(path.relative(projectRoot, absPath));
}
