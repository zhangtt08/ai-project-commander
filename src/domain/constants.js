/**
 * Domain constants & enums.
 * Pure data, no dependencies. This module must never import anything.
 */

export const PROJECT_STATUS = Object.freeze({
  PLANNING: 'planning',
  DEVELOPING: 'developing',
  TESTING: 'testing',
  REVIEW: 'review',
  BLOCKED: 'blocked',
  READY: 'ready',
  RELEASED: 'released',
  ARCHIVED: 'archived',
});
export const PROJECT_STATUS_VALUES = Object.freeze(Object.values(PROJECT_STATUS));

export const PROJECT_HEALTH = Object.freeze({
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown',
});
export const PROJECT_HEALTH_VALUES = Object.freeze(Object.values(PROJECT_HEALTH));

export const TASK_STATUS = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELLED: 'cancelled',
});
export const TASK_STATUS_VALUES = Object.freeze(Object.values(TASK_STATUS));

export const TASK_PRIORITY = Object.freeze({
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
  P3: 'p3',
});
export const TASK_PRIORITY_VALUES = Object.freeze(Object.values(TASK_PRIORITY));

export const TASK_SOURCE = Object.freeze({
  SPEC: 'spec',
  CHECKBOX: 'markdown_checkbox',
  TODO_COMMENT: 'todo_comment',
  AGENT_LOG: 'agent_log',
  MANUAL: 'manual',
  AI_EXTRACTION: 'ai_extraction',
});
export const TASK_SOURCE_VALUES = Object.freeze(Object.values(TASK_SOURCE));

export const STAGE_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
});
export const STAGE_STATUS_VALUES = Object.freeze(Object.values(STAGE_STATUS));

export const GATE_RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
});
export const GATE_RESULT_VALUES = Object.freeze(Object.values(GATE_RESULT));

export const SEVERITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});
export const SEVERITY_VALUES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const SEVERITY_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

export const CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown',
});
export const CONFIDENCE_VALUES = Object.freeze(['high', 'medium', 'low', 'unknown']);

export const BUILD_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  TIMEOUT: 'timeout',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown',
});

export const RUN_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  TIMEOUT: 'timeout',
  ERROR: 'error',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown',
});

export const COMMAND_CLASS = Object.freeze({
  READ_ONLY: 'read_only',
  VALIDATION: 'validation',
  POTENTIALLY_MUTATING: 'potentially_mutating',
  DANGEROUS: 'dangerous',
});

export const JOB_TYPE = Object.freeze({
  QUICK_SCAN: 'quick_scan',
  FULL_SCAN: 'full_scan',
  GIT: 'git',
  BUILD: 'build',
  TEST: 'test',
  RISK: 'risk',
  AI_ANALYSIS: 'ai_analysis',
});
export const JOB_TYPE_VALUES = Object.freeze(Object.values(JOB_TYPE));

export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});
export const JOB_STATUS_VALUES = Object.freeze(Object.values(JOB_STATUS));

export const EVENT_TYPE = Object.freeze({
  PROJECT_ADDED: 'project_added',
  PROJECT_ARCHIVED: 'project_archived',
  SCAN_STARTED: 'scan_started',
  SCAN_COMPLETED: 'scan_completed',
  SCAN_FAILED: 'scan_failed',
  BUILD_FAILED: 'build_failed',
  BUILD_RECOVERED: 'build_recovered',
  TEST_REGRESSION: 'test_regression',
  REGRESSION_DETECTED: 'regression_detected',
  SNAPSHOT_CREATED: 'snapshot_created',
  AGENT_SESSION_IMPORTED: 'agent_session_imported',
  PROMPT_GENERATED: 'prompt_generated',
  RISK_DETECTED: 'risk_detected',
  STAGE_COMPLETED: 'stage_completed',
  WORKSPACE_CHANGED: 'workspace_changed',
  DRIFT_DETECTED: 'drift_detected',
  GATE_EVALUATED: 'gate_evaluated',
  NOTE: 'note',
  ERROR: 'error',
});

export const EVIDENCE_TYPE = Object.freeze({
  FILE: 'file',
  TEST: 'test',
  COMMIT: 'commit',
  SPEC: 'spec',
  COMMAND: 'command',
  DIFF: 'diff',
  SNAPSHOT: 'snapshot',
  TASK: 'task',
  RISK: 'risk',
  SESSION: 'session',
});

export const CHANGE_KIND = Object.freeze({
  FEATURE: 'feature',
  FIX: 'fix',
  REFACTOR: 'refactor',
  TEST: 'test',
  DOCS: 'docs',
  CONFIG: 'config',
  UNKNOWN: 'unknown',
});

export const REGRESSION_TYPE = Object.freeze({
  BUILD_PASS_TO_FAIL: 'build_pass_to_fail',
  TESTS_PASS_TO_FAIL: 'tests_pass_to_fail',
  PASSED_COUNT_DROP: 'passed_count_drop',
  TEST_COUNT_DROP: 'test_count_drop',
  STAGE_REGRESSED: 'stage_regressed',
  CRITICAL_RISK_INCREASED: 'critical_risk_increased',
  KEY_FILE_DELETED: 'key_file_deleted',
  ACCEPTANCE_INVALIDATED: 'acceptance_invalidated',
});

export const AGENT_PROVIDER = Object.freeze({
  MOCK: 'mock',
  MANUAL: 'manual',
  CODEX: 'codex',
  CLAUDE_CODE: 'claude_code',
  CURSOR: 'cursor',
  GEMINI: 'gemini',
  GENERIC: 'generic_cli',
});

export const FILE_ROLE = Object.freeze({
  SPEC: 'spec',
  README: 'readme',
  CONFIG: 'config',
  SOURCE: 'source',
  TEST: 'test',
  E2E: 'e2e',
  DOCS: 'docs',
  LOCKFILE: 'lockfile',
  UNKNOWN: 'unknown',
});

export const DEFAULT_IGNORE = Object.freeze([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.parcel-cache', 'vendor', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', '.DS_Store', 'Thumbs.db', 'target', 'bin', 'obj',
  'playwright-report', 'test-results', '.pytest_cache', '.mypy_cache',
  '*.min.js', '*.map', '*.log',
]);

export const SENSITIVE_PATTERNS = Object.freeze([
  { pattern: '**/.env', rule: 'env_file' },
  { pattern: '**/.env.*', rule: 'env_file' },
  { pattern: '**/*.pem', rule: 'private_key_pem' },
  { pattern: '**/*.key', rule: 'private_key' },
  { pattern: '**/*.p12', rule: 'pkcs12' },
  { pattern: '**/*.pfx', rule: 'pkcs12' },
  { pattern: '**/id_rsa', rule: 'ssh_private_key' },
  { pattern: '**/id_ed25519', rule: 'ssh_private_key' },
  { pattern: '**/id_dsa', rule: 'ssh_private_key' },
  { pattern: '**/id_ecdsa', rule: 'ssh_private_key' },
  { pattern: '**/.ssh/**', rule: 'ssh_directory' },
  { pattern: '**/credentials*', rule: 'credentials' },
  { pattern: '**/credentials/**', rule: 'credentials' },
  { pattern: '**/secrets*', rule: 'secrets' },
  { pattern: '**/*secret*.json', rule: 'secrets' },
  { pattern: '**/tokens*', rule: 'tokens' },
  { pattern: '**/.npmrc', rule: 'npm_credentials' },
  { pattern: '**/.pypirc', rule: 'pypi_credentials' },
  { pattern: '**/.netrc', rule: 'netrc' },
  { pattern: '**/.git-credentials', rule: 'git_credentials' },
  { pattern: '**/.aws/**', rule: 'cloud_credentials' },
  { pattern: '**/.azure/**', rule: 'cloud_credentials' },
  { pattern: '**/gcloud/**', rule: 'cloud_credentials' },
  { pattern: '**/serviceAccount*.json', rule: 'cloud_credentials' },
  { pattern: '**/keyfile.json', rule: 'cloud_credentials' },
  { pattern: '**/*.jks', rule: 'java_keystore' },
  { pattern: '**/*.keystore', rule: 'java_keystore' },
  { pattern: '**/secring.gpg', rule: 'gpg_key' },
]);

export const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxFiles: 20000,
  maxDepth: 12,
  maxFileSizeBytes: 2 * 1024 * 1024,
  maxReadBytesForSnippet: 64 * 1024,
  defaultCommandTimeoutMs: 180000,
  buildTimeoutMs: 600000,
  testTimeoutMs: 900000,
});

export const PROGRESS_WEIGHTS = Object.freeze({
  stage: 0.4,
  task: 0.3,
  acceptance: 0.3,
});
