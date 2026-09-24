/**
 * AgentAdapter — requirement #35 (and prompts → execution → evidence → acceptance, #36).
 *
 * The interface is frozen here. What ships in the MVP is:
 *   - ManualImportAdapter : REAL — parses a transcript the user pastes, extracting
 *                           commands, exit codes, file edits and a summary.
 *   - MockAgentAdapter    : explicitly labelled mock, used by the Demo Mode.
 *
 * No adapter pretends to have read a real Codex/Claude/Cursor session. Those local
 * transcript formats are not verified in this environment (KNOWN_ISSUES MOCK-002).
 */
import { AGENT_PROVIDER } from '../domain/constants.js';
import { newId, nowIso, sha1, truncate } from './util.js';

export class AgentAdapter {
  constructor(meta = {}) {
    this.name = meta.name || 'adapter';
    this.provider = meta.provider || AGENT_PROVIDER.GENERIC;
    this.isMock = false;
  }
  /** @returns {Promise<{provider:string, externalId:string, status:string, startedAt:string|null, endedAt:string|null, summary:string}>} */
  async getSessionInfo() { throw new Error('getSessionInfo() not implemented'); }
  /** @returns {Promise<{text:string, format:string}>} */
  async getTranscript() { throw new Error('getTranscript() not implemented'); }
  async getStatus() { throw new Error('getStatus() not implemented'); }
  /** @returns {Promise<string[]>} */
  async getChangedFiles() { throw new Error('getChangedFiles() not implemented'); }
  /** @returns {Promise<{commands:Array, exitCodes:number[], notes:string[]}>} */
  async getExecutionResult() { throw new Error('getExecutionResult() not implemented'); }
  capabilities() { return { transcript: true, changedFiles: true, executionResult: true, live: false, mock: this.isMock }; }
}

const CMD_RE = /^\s*[$>]\s+(.+)$/gm;
const EXIT_RE = /\b(exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*(\d+)/gi;
const EDIT_RE = /(?:^|\s)(?:wrote|written|edited?|edits?|created?|creates?|updated?|updates?|modified|modifies|apply_patch|applied|str_replace|patched|patching)\s+(?:to\s+)?(?:file\s*[:]?\s*)?([\w./\\-]+\.[\w]+)/gi;
const FILE_RE = /((?:[\w.-]+\/)+[\w.-]+\.[a-z]{1,6})/g;

export function parseTranscript(text) {
  const source = String(text || '');
  const commands = [];
  let m;
  CMD_RE.lastIndex = 0;
  while ((m = CMD_RE.exec(source)) !== null) {
    commands.push({ command: m[1].trim().slice(0, 300), line: source.slice(0, m.index).split('\n').length });
  }
  const exitCodes = [];
  EXIT_RE.lastIndex = 0;
  while ((m = EXIT_RE.exec(source)) !== null) exitCodes.push(Number(m[2]));

  const editedFiles = new Set();
  EDIT_RE.lastIndex = 0;
  while ((m = EDIT_RE.exec(source)) !== null) editedFiles.add(m[1].replace(/\\/g, '/'));

  const mentionedFiles = new Set();
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(source)) !== null) mentionedFiles.add(m[1].replace(/\\/g, '/'));

  const notes = [];
  if (/\b(done|complete|finished|all tests pass(ed)?)\b/i.test(source)) notes.push('transcript claims completion');
  if (/\b(failed|error|cannot|unable)\b/i.test(source)) notes.push('transcript contains failure language');
  if (/\b(todo|not implemented)\b/i.test(source)) notes.push('transcript contains incomplete markers');

  const changedFiles = [...(editedFiles.size ? editedFiles : mentionedFiles)].slice(0, 100);
  return {
    commands,
    exitCodes,
    editedFiles: [...editedFiles].slice(0, 100),
    mentionedFiles: [...mentionedFiles].slice(0, 100),
    changedFiles,
    notes,
    lineCount: source.split(/\r?\n/).length,
    hash: sha1(source).slice(0, 16),
  };
}

export class ManualImportAdapter extends AgentAdapter {
  constructor({ transcript, provider = AGENT_PROVIDER.MANUAL, label = 'Manual import', externalId = '', startedAt = null, endedAt = null } = {}) {
    super({ name: 'manual_import', provider });
    this.transcript = transcript || '';
    this.label = label;
    this.externalId = externalId;
    this.startedAt = startedAt;
    this.endedAt = endedAt;
    this.parsed = parseTranscript(this.transcript);
  }

  async getSessionInfo() {
    return {
      provider: this.provider,
      externalId: this.externalId || `manual-${this.parsed.hash}`,
      status: inferStatus(this.parsed),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      summary: summarize(this.parsed),
    };
  }
  async getTranscript() { return { text: this.transcript, format: 'text' }; }
  async getStatus() { return inferStatus(this.parsed); }
  async getChangedFiles() { return this.parsed.changedFiles; }
  async getExecutionResult() { return { commands: this.parsed.commands, exitCodes: this.parsed.exitCodes, notes: this.parsed.notes }; }
}

export class MockAgentAdapter extends AgentAdapter {
  constructor({ projectName = 'project', scenario = 'improvement', transcript = null } = {}) {
    super({ name: 'mock_agent', provider: AGENT_PROVIDER.MOCK });
    this.isMock = true;
    this.projectName = projectName;
    this.scenario = scenario;
    this.transcript = transcript || [
      `# MOCK TRANSCRIPT — not produced by a real coding agent`,
      `Agent: MockAgent (${AGENT_PROVIDER.MOCK})`,
      `Objective: ${scenario}`,
      ``,
      `$ npm test`,
      `Test Files  2 passed (2)`,
      `     Tests  6 passed (6)`,
      `exit code 0`,
      ``,
      `$ npm run test:e2e`,
      `  22 passed (18.4s)`,
      `  3 failed`,
      `exit code 1`,
      ``,
      `Edited file: src/planner/weekly.js`,
      `Status: partial`,
    ].join('\n');
  }
  async getSessionInfo() {
    return { provider: AGENT_PROVIDER.MOCK, externalId: `mock-${Date.now()}`, status: 'mock', startedAt: nowIso(), endedAt: nowIso(), summary: `MOCK session for ${this.projectName} (${this.scenario}) — not a real agent run` };
  }
  async getTranscript() { return { text: this.transcript, format: 'text' }; }
  async getStatus() { return 'mock'; }
  async getChangedFiles() { return parseTranscript(this.transcript).changedFiles; }
  async getExecutionResult() { return parseTranscript(this.transcript); }
}

function inferStatus(parsed) {
  if (parsed.exitCodes.some((c) => c !== 0)) return 'failed';
  if (parsed.exitCodes.length && parsed.exitCodes.every((c) => c === 0)) return 'success';
  return 'unknown';
}

function summarize(parsed) {
  return `${parsed.lineCount} line transcript, ${parsed.commands.length} command(s), ${parsed.changedFiles.length} file(s) referenced, exit codes [${parsed.exitCodes.join(', ')}]${parsed.notes.length ? `, notes: ${parsed.notes.join('; ')}` : ''}`;
}

export class AgentSessionService {
  constructor({ repo, events, eventType }) {
    this.repo = repo;
    this.events = events;
    this.eventType = eventType;
  }

  async importSession(projectId, { adapter }) {
    const [info, transcript, files, execution] = await Promise.all([
      adapter.getSessionInfo(), adapter.getTranscript(), adapter.getChangedFiles(), adapter.getExecutionResult(),
    ]);
    const row = this.repo.insert('agent_sessions', {
      id: newId('ags'),
      project_id: projectId,
      provider: info.provider,
      adapter: adapter.name,
      external_id: info.externalId || '',
      is_mock: !!adapter.isMock,
      status: info.status || 'unknown',
      summary: truncate(info.summary || '', 1000),
      transcript_excerpt: truncate(transcript.text || '', 4000),
      changed_files: files || [],
      execution_result: execution || {},
      started_at: info.startedAt,
      ended_at: info.endedAt,
    });
    if (this.events) {
      this.events.record(projectId, this.eventType, `${adapter.isMock ? 'MOCK ' : ''}Agent session imported (${info.provider})`, {
        sessionId: row.id, isMock: !!adapter.isMock, status: info.status,
      });
    }
    return row;
  }

  list(projectId) { return this.repo.list('agent_sessions', { project_id: projectId }, { orderBy: 'created_at DESC' }); }
  get(id) { return this.repo.get('agent_sessions', id); }

  linkPromptExecution(projectId, promptId, sessionId, { status = 'unknown', summary = '' } = {}) {
    const execution = this.repo.insert('executions', {
      id: newId('exe'),
      prompt_id: promptId,
      project_id: projectId,
      agent_session_id: sessionId,
      status,
      started_at: nowIso(),
      finished_at: nowIso(),
      result_summary: truncate(summary, 1000),
      evidence: [{ type: 'session', ref: sessionId, note: 'agent session that executed this prompt' }],
    });
    if (promptId) this.repo.update('prompts', promptId, { status: 'executed', actual_result: truncate(summary, 500) });
    return execution;
  }

  executionsFor(projectId) {
    return this.repo.list('executions', { project_id: projectId }, { orderBy: 'created_at DESC', limit: 100 });
  }
}

export const ADAPTER_CATALOGUE = [
  { key: 'manual_import', label: 'Manual transcript import', real: true, providers: ['manual', 'codex', 'claude_code', 'cursor', 'gemini', 'generic_cli'], note: 'Paste a transcript; Commander parses commands, exit codes and touched files.' },
  { key: 'mock_agent', label: 'Mock agent (Demo Mode)', real: false, providers: ['mock'], note: 'Explicitly labelled mock session. Never presented as a real agent run.' },
];
