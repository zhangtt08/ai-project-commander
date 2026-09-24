/**
 * Search — requirement #47.
 * Uses SQLite FTS5 when the bundled SQLite supports it, otherwise falls back to LIKE
 * (the fallback is announced in the response so the UI never silently degrades).
 */
import { nowIso } from './util.js';
import { logger } from './logger.js';

const log = logger.child('search');

const INDEXED_TABLES = ['projects', 'tasks', 'prompts', 'risks', 'architecture_decisions', 'issues'];

/** Columns searched by the LIKE fallback, per table. */
const LIKE_COLUMNS = {
  projects: ['name', 'description'],
  tasks: ['title', 'description'],
  prompts: ['title', 'content'],
  risks: ['title', 'description'],
  architecture_decisions: ['title', 'decision'],
  issues: ['title', 'description'],
};

export class SearchService {
  constructor({ db, repo }) {
    this.db = db;
    this.repo = repo;
    this.fts = !!db.ftsAvailable;
  }

  indexEntity(table, row) {
    if (!this.fts) return;
    const title = row.name || row.title || row.objective || '';
    const body = [row.description, row.content, row.text, row.prompt, row.explanation, row.decision]
      .filter(Boolean).join(' ').slice(0, 4000);
    try {
      this.db.run('DELETE FROM search_index WHERE entity_table = ? AND entity_id = ?', [table, row.id]);
      this.db.run('INSERT INTO search_index (project_id, entity_table, entity_id, title, body) VALUES (?, ?, ?, ?, ?)', [
        row.project_id || row.id || '', table, row.id, String(title).slice(0, 500), body,
      ]);
    } catch (err) {
      log.warn('index_failed', { table, error: err.message });
    }
  }

  reindexProject(projectId) {
    if (!this.fts) return { indexed: 0, fts: false };
    let indexed = 0;
    for (const table of INDEXED_TABLES) {
      const where = table === 'projects' ? { id: projectId } : { project_id: projectId };
      let rows = [];
      try { rows = this.repo.list(table, where); } catch { rows = []; }
      for (const row of rows) { this.indexEntity(table, row); indexed += 1; }
    }
    return { indexed, fts: true };
  }

  /** @returns {{query:string, fts:boolean, results:Array}} */
  query(q, { limit = 40 } = {}) {
    const term = String(q || '').trim();
    if (!term) return { query: term, fts: this.fts, results: [], at: nowIso() };
    if (this.fts) {
      try {
        const safe = term.replace(/["*]/g, ' ').split(/\s+/).filter(Boolean).map((t) => `"${t}"*`).join(' ');
        const rows = this.db.all(
          `SELECT entity_table, entity_id, project_id, title,
                  snippet(search_index, 4, '[', ']', '…', 12) AS snippet
             FROM search_index WHERE search_index MATCH ? LIMIT ?`,
          [safe, limit],
        );
        return { query: term, fts: true, results: rows.map((r) => ({ table: r.entity_table, id: r.entity_id, projectId: r.project_id, title: r.title, snippet: r.snippet })), at: nowIso() };
      } catch (err) {
        log.warn('fts_query_failed', { error: err.message, query: term });
      }
    }
    // LIKE fallback — column lists are per table: referencing a column that does not
    // exist (even inside COALESCE) is a prepare-time error in SQLite.
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const results = [];
    for (const table of INDEXED_TABLES) {
      const cols = LIKE_COLUMNS[table];
      if (!cols) continue;
      try {
        const where = cols.map((c) => `${c} LIKE ?`).join(' OR ');
        // projects has no project_id column — it *is* the project.
        const select = table === 'projects' ? 'id, id AS project_id' : 'id, project_id';
        const rows = this.db.all(
          `SELECT ${select}, ${cols[0]} AS title FROM ${table} WHERE ${where} LIMIT ?`,
          [...cols.map(() => like), limit],
        );
        for (const r of rows) results.push({ table, id: r.id, projectId: r.project_id, title: r.title, snippet: '' });
      } catch { /* table unavailable in this schema version */ }
    }
    return { query: term, fts: false, results: results.slice(0, limit), at: nowIso(), note: 'Full-text index unavailable; using simple substring matching.' };
  }

  describe() {
    return { ftsAvailable: this.fts, indexedTables: INDEXED_TABLES };
  }
}
