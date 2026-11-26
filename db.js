'use strict';
// Couche base de données : SQLite intégré à Electron (node:sqlite), un seul fichier .sqlite.
const fs = require('node:fs');
const {DatabaseSync} = require('node:sqlite');

const SCHEMA_VERSION = 1;
const TABLES = ['settings', 'teams', 'chantiers', 'phases', 'entries'];

class Store {
  constructor(file) {
    this.file = file;
    this.db = new DatabaseSync(file);
    // Mode de journal « DELETE » : la base reste un fichier unique (compatible dossiers synchronisés).
    this.db.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    if (v >= SCHEMA_VERSION) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, capacity REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS chantiers (
        id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, client TEXT, color TEXT, start_date TEXT);
      CREATE TABLE IF NOT EXISTS phases (
        id TEXT PRIMARY KEY, chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, name TEXT NOT NULL, hours REAL NOT NULL, people INTEGER NOT NULL,
        team_id TEXT, start_mode TEXT, start_date TEXT);
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, date TEXT NOT NULL, spent REAL NOT NULL,
        raf REAL NOT NULL, comment TEXT, ts INTEGER);
      CREATE INDEX IF NOT EXISTS idx_phases_chantier ON phases(chantier_id);
      CREATE INDEX IF NOT EXISTS idx_entries_phase ON entries(phase_id);
      PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  isEmpty() {
    return !this.db.prepare('SELECT 1 FROM settings LIMIT 1').get();
  }

  // Vrai si la base contient au moins un chantier (une base qui n'a que des paramètres compte comme vierge).
  hasChantiers() {
    return !!this.db.prepare('SELECT 1 FROM chantiers LIMIT 1').get();
  }

  load() {
    if (this.isEmpty()) return null;
    const settings = {};
    for (const r of this.db.prepare('SELECT key, value FROM settings').all()) settings[r.key] = JSON.parse(r.value);
    const teams = this.db.prepare('SELECT id, name, capacity FROM teams ORDER BY position').all().map(r => ({...r}));
    const phasesBy = {};
    for (const r of this.db.prepare('SELECT * FROM phases ORDER BY position').all()) {
      (phasesBy[r.chantier_id] ??= []).push({id: r.id, name: r.name, hours: r.hours, people: r.people,
        teamId: r.team_id ?? '', startMode: r.start_mode ?? 'after', startDate: r.start_date ?? ''});
    }
    const chantiers = this.db.prepare('SELECT * FROM chantiers ORDER BY position').all().map(r => ({
      id: r.id, name: r.name, client: r.client ?? '', color: r.color, startDate: r.start_date, phases: phasesBy[r.id] || []}));
    const entries = this.db.prepare('SELECT * FROM entries').all().map(r => ({
      id: r.id, phaseId: r.phase_id, date: r.date, spent: r.spent, raf: r.raf, comment: r.comment ?? '', ts: r.ts}));
    return {settings, teams, chantiers, entries};
  }

  // Enregistre l'état complet dans une transaction (le volume de données reste faible).
  save(state) {
    const db = this.db;
    db.exec('BEGIN');
    try {
      for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
      const iS = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const [k, v] of Object.entries(state.settings || {})) iS.run(k, JSON.stringify(v));
      const iT = db.prepare('INSERT INTO teams (id, position, name, capacity) VALUES (?, ?, ?, ?)');
      (state.teams || []).forEach((t, i) => iT.run(String(t.id), i, String(t.name ?? ''), +t.capacity || 0));
      const iC = db.prepare('INSERT INTO chantiers (id, position, name, client, color, start_date) VALUES (?, ?, ?, ?, ?, ?)');
      const iP = db.prepare(`INSERT INTO phases (id, chantier_id, position, name, hours, people, team_id, start_mode, start_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      (state.chantiers || []).forEach((c, i) => {
        iC.run(String(c.id), i, String(c.name ?? ''), c.client ?? '', c.color ?? null, c.startDate ?? null);
        (c.phases || []).forEach((p, j) => iP.run(String(p.id), String(c.id), j, String(p.name ?? ''), +p.hours || 0,
          Math.max(1, Math.round(+p.people || 1)), p.teamId || null, p.startMode || 'after', p.startDate || null));
      });
      const iE = db.prepare('INSERT INTO entries (id, phase_id, date, spent, raf, comment, ts) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const e of state.entries || [])
        iE.run(String(e.id), String(e.phaseId), String(e.date), +e.spent || 0, +e.raf || 0, e.comment ?? '', Math.round(+e.ts || 0));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Copie cohérente de la base vers un autre fichier (même si elle est ouverte).
  backupTo(dest) {
    if (fs.existsSync(dest)) fs.rmSync(dest);
    this.db.prepare('VACUUM INTO ?').run(dest);
  }

  close() {
    try { this.db.close(); } catch {}
  }

  // Vérifie qu'un fichier est bien une base Planning Chantiers lisible.
  static validate(file) {
    let db;
    try {
      db = new DatabaseSync(file, {readOnly: true});
      const ok = db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
      const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
      return ok && TABLES.every(t => names.has(t));
    } catch {
      return false;
    } finally {
      try { db?.close(); } catch {}
    }
  }
}

module.exports = {Store};
