/**
 * Build/test command detection — requirement #14.
 * Derived from package.json scripts + detected framework/package manager.
 * Never hardcodes a single project shape; returns `unsupported` instead of guessing.
 */
import { FRAMEWORK_DETECTORS } from './scanner.js';

const RUNNERS = {
  npm: (script, isTestScript) => (isTestScript && script === 'test' ? { command: 'npm', args: ['test'] } : { command: 'npm', args: ['run', script] }),
  pnpm: (script) => ({ command: 'pnpm', args: ['run', script] }),
  yarn: (script) => ({ command: 'yarn', args: ['run', script] }),
  bun: (script) => ({ command: 'bun', args: ['run', script] }),
};

const SCRIPT_ALIASES = {
  build: ['build', 'compile', 'bundle', 'dist'],
  test: ['test', 'test:unit', 'unit', 'jest', 'vitest'],
  integrationTest: ['test:integration', 'test:int', 'integration', 'test:api'],
  e2e: ['test:e2e', 'e2e', 'test:e2e:ci', 'test:playwright'],
  lint: ['lint', 'eslint', 'check:lint'],
  typecheck: ['typecheck', 'type-check', 'tsc', 'check:types', 'types'],
};

function pick(scripts, aliases) {
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(scripts, a)) return { script: a, body: scripts[a] };
  }
  return null;
}

/**
 * @param {object} metadata ProjectScanner output
 * @returns {{kind:string, command:string, args:string[], script:string, display:string, source:string} | {kind:string, unsupported:true, reason:string}}
 */
export function detectCommand(metadata, kind) {
  const scripts = (metadata && metadata.packageJson && metadata.packageJson.scripts) || {};
  const pm = (metadata && metadata.packageManager) || 'unknown';
  const runner = RUNNERS[pm] || RUNNERS.npm;

  const aliases = SCRIPT_ALIASES[kind];
  if (!aliases) return { kind, unsupported: true, reason: `unknown command kind: ${kind}` };

  const hit = pick(scripts, aliases);
  if (hit) {
    const { command, args } = runner(hit.script, kind === 'test');
    return {
      kind,
      source: 'package.json',
      script: hit.script,
      command,
      args,
      display: `${command} ${args.join(' ')}`,
      scriptBody: hit.body,
      unsupported: false,
    };
  }

  // Framework fallbacks when the script is missing.
  const frameworks = (metadata && metadata.frameworks) || [];
  if (kind === 'e2e' && frameworks.includes('Playwright')) {
    return { kind, source: 'framework', script: null, command: 'npx', args: ['playwright', 'test'], display: 'npx playwright test', unsupported: false };
  }
  if (kind === 'test' && frameworks.includes('Vitest')) {
    return { kind, source: 'framework', script: null, command: 'npx', args: ['vitest', 'run'], display: 'npx vitest run', unsupported: false };
  }
  if (kind === 'test' && frameworks.includes('Jest')) {
    return { kind, source: 'framework', script: null, command: 'npx', args: ['jest'], display: 'npx jest', unsupported: false };
  }
  if (kind === 'typecheck' && metadata && metadata.configFiles && metadata.configFiles.tsconfig) {
    return { kind, source: 'config', script: null, command: 'npx', args: ['tsc', '--noEmit'], display: 'npx tsc --noEmit', unsupported: false };
  }
  if (kind === 'lint' && metadata && metadata.configFiles && metadata.configFiles.eslint) {
    return { kind, source: 'config', script: null, command: 'npx', args: ['eslint', '.'], display: 'npx eslint .', unsupported: false };
  }
  if (kind === 'test' && metadata && metadata.directories && metadata.directories.tests) {
    return { kind, unsupported: true, reason: 'a tests/ directory exists but no test script or recognised framework was found' };
  }
  return { kind, unsupported: true, reason: `no ${kind} command detected (no matching npm script, framework or config)` };
}

export function detectAllCommands(metadata) {
  const kinds = ['build', 'test', 'integrationTest', 'e2e', 'lint', 'typecheck'];
  const out = {};
  for (const k of kinds) out[k] = detectCommand(metadata, k);
  return out;
}

export function detectedCommandSummary(commands) {
  return Object.entries(commands).map(([k, v]) => ({
    kind: k,
    supported: !v.unsupported,
    display: v.unsupported ? null : v.display,
    reason: v.unsupported ? v.reason : null,
    source: v.source || null,
  }));
}

export function frameworksDetected(metadata) {
  return (metadata && metadata.frameworks) || [];
}

export { FRAMEWORK_DETECTORS };
