/**
 * Evidence system — requirement #25 / ADR-005.
 * Every important conclusion (human or AI) can be traced back to a raw artifact.
 */
import { newId, nowIso } from './util.js';
import { EVIDENCE_TYPE } from '../domain/constants.js';

export function evFile(path, note = '') { return { type: EVIDENCE_TYPE.FILE, ref: path, note }; }
export function evTest(name, note = '') { return { type: EVIDENCE_TYPE.TEST, ref: name, note }; }
export function evCommit(hash, note = '') { return { type: EVIDENCE_TYPE.COMMIT, ref: hash, note }; }
export function evSpec(requirementRef, note = '') { return { type: EVIDENCE_TYPE.SPEC, ref: requirementRef, note }; }
export function evCommand(command, note = '') { return { type: EVIDENCE_TYPE.COMMAND, ref: command, note }; }
export function evDiff(desc, note = '') { return { type: EVIDENCE_TYPE.DIFF, ref: desc, note }; }
export function evSnapshot(id, note = '') { return { type: EVIDENCE_TYPE.SNAPSHOT, ref: id, note }; }
export function evTask(id, note = '') { return { type: EVIDENCE_TYPE.TASK, ref: id, note }; }
export function evRisk(id, note = '') { return { type: EVIDENCE_TYPE.RISK, ref: id, note }; }
export function evSession(id, note = '') { return { type: EVIDENCE_TYPE.SESSION, ref: id, note }; }

export function normalizeEvidence(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === 'object' && typeof e.type === 'string' && typeof e.ref === 'string')
    .map((e) => ({ type: e.type, ref: e.ref.slice(0, 500), note: typeof e.note === 'string' ? e.note.slice(0, 500) : '' }))
    .slice(0, 50);
}

export function mergeEvidence(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of normalizeEvidence(list)) {
      const key = `${e.type}:${e.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length >= 50) return out;
    }
  }
  return out;
}

export function evidenceKey(e) { return `${e.type}:${e.ref}`; }

export function evidenceToText(list) {
  const items = normalizeEvidence(list);
  if (!items.length) return '(no evidence recorded)';
  return items.map((e) => `- [${e.type}] ${e.ref}${e.note ? ` — ${e.note}` : ''}`).join('\n');
}

export function persistEvidence(repo, { projectId, ownerTable, ownerId, evidence }) {
  const rows = normalizeEvidence(evidence).map((e) => ({
    id: newId('evd'),
    project_id: projectId,
    owner_table: ownerTable,
    owner_id: ownerId,
    type: e.type,
    ref: e.ref,
    note: e.note,
    created_at: nowIso(),
  }));
  if (rows.length) repo.insertMany('evidence_refs', rows);
  return rows.length;
}

export function loadEvidence(repo, ownerTable, ownerId) {
  return repo.list('evidence_refs', { owner_table: ownerTable, owner_id: ownerId }).map((r) => ({
    type: r.type,
    ref: r.ref,
    note: r.note,
  }));
}
