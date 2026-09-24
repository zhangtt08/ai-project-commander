/**
 * Database bootstrap: opens SQLite (node:sqlite, built into Node >= 22.5),
 * probes optional FTS5 support, and applies versioned migrations.
 *
 * Infrastructure layer. Knows about SQL, nothing about business rules.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { allMigrations } from './migrations.js';
import { logger } from '../core/logger.js';

function probeFts5() {
  try {
    const mem = new DatabaseSync(':memory:');
    mem.exec("CREATE VIRTUAL TABLE __probe USING fts5(x);");
    mem.close();
    return true;
  } catch {
    return false;
  }
}

export function coerceValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

export class Database {
  /** @param {{file?:string}} opts */
  constructor({ file = ':memory:' } = {}) {
    this.file = file;
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.ftsAvailable = probeFts5();
  }

  migrate() {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
    const applied = new Set(
      this.raw.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)),
    );
    const pending = allMigrations({ ftsAvailable: this.ftsAvailable }).filter((m) => !applied.has(m.version));
    const done = [];
    for (const m of pending) {
      try {
        this.raw.exec('BEGIN');
        for (const stmt of m.up) this.raw.exec(stmt);
        this.raw
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(m.version, m.name, new Date().toISOString());
        this.raw.exec('COMMIT');
        done.push(m.version);
      } catch (err) {
        try { this.raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
        if (m.version === 2) {
          logger.warn('db.migration.fts_skipped', { error: err.message });
          this.ftsAvailable = false;
          continue;
        }
        throw err;
      }
    }
    if (done.length) logger.info('db.migrated', { versions: done, fts: this.ftsAvailable });
    return { applied: done, ftsAvailable: this.ftsAvailable };
  }

  exec(sql) { return this.raw.exec(sql); }
  prepare(sql) { return this.raw.prepare(sql); }

  run(sql, params = []) {
    return this.raw.prepare(sql).run(...params.map(coerceValue));
  }
  get(sql, params = []) {
    return this.raw.prepare(sql).get(...params.map(coerceValue));
  }
  all(sql, params = []) {
    return this.raw.prepare(sql).all(...params.map(coerceValue));
  }

  transaction(fn) {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      try { this.raw.exec('ROLLBACK'); } catch { /* noop */ }
      throw err;
    }
  }

  close() { try { this.raw.close(); } catch { /* noop */ } }
}

let singleton = null;

export function openDatabase(file) {
  const db = new Database({ file });
  db.migrate();
  return db;
}

export function getDb(file) {
  if (!singleton) singleton = openDatabase(file);
  return singleton;
}

export function resetDbSingleton() { singleton = null; }
