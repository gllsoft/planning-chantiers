'use strict';
// Tests exécutés avec le Node intégré à Electron (npm test) : base SQLite et comparaison de versions.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-test-'));
try {
  const s = new Store(path.join(dir, 'a.sqlite'));
  assert.equal(s.load(), null, 'une base neuve est vide');
  const state = {
    settings: {hoursPerDay: 7, workDays: [1, 2, 3, 4, 5], frHolidays: true, holidays: ['2026-12-24']},
    teams: [{id: 'tA', name: 'Équipe A', capacity: 2}],
    chantiers: [{id: 'c1', name: 'Réno', client: 'X', color: '#2f6fde', startDate: '2026-11-02', phases: [
      {id: 'p1', name: 'Démolition', hours: 42, people: 2, teamId: 'tA', startMode: 'after', startDate: ''},
      {id: 'p2', name: 'Finitions', hours: 14, people: 1, teamId: '', startMode: 'date', startDate: '2026-12-01'}]}],
    entries: [{id: 'e1', phaseId: 'p1', date: '2026-11-03', spent: 14, raf: 28, comment: 'ok', ts: Date.now()}],
  };
  s.save(state);
  assert.deepStrictEqual(s.load(), state, 'aller-retour des données');
  s.backupTo(path.join(dir, 'b.sqlite'));
  assert.ok(Store.validate(path.join(dir, 'b.sqlite')), 'la sauvegarde est une base valide');
  fs.writeFileSync(path.join(dir, 'bad.sqlite'), 'pas une base');
  assert.ok(!Store.validate(path.join(dir, 'bad.sqlite')), 'un fichier quelconque est refusé');
  s.close();
  const s2 = new Store(path.join(dir, 'b.sqlite'));
  assert.deepStrictEqual(s2.load(), state, 'la sauvegarde contient les données');
  s2.close();
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}

// compareVersions (le module updater requiert electron : on n'en extrait que la fonction pure)
const src = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
const compareVersions = new Function(`${src.match(/function compareVersions[\s\S]*?\n}\n/)[0]}; return compareVersions;`)();
assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
assert.ok(compareVersions('v1.2.0', '1.1.9') > 0);
assert.equal(compareVersions('1.0.0', '1.0'), 0);
assert.ok(compareVersions('1.0.0', '1.0.1') < 0);

console.log('Tous les tests passent.');
