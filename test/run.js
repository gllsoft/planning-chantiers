'use strict';
// Tests exécutés avec le Node intégré à Electron (npm test) : base SQLite et mises à jour.
// Lancé avec le Node du système, le script se relance lui-même sous Electron (ELECTRON_RUN_AS_NODE),
// ce qui fonctionne aussi sous Windows (pas de syntaxe VAR=valeur dans le script npm).
if (!process.versions.electron) {
  const {spawnSync} = require('node:child_process');
  const r = spawnSync(require('electron'), [__filename], {stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
  process.exit(r.status ?? 1);
}
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-test-'));
try {
  const s = new Store(path.join(dir, 'a.sqlite'));
  assert.equal(s.load(), null, 'une base neuve est vide');
  s.save({settings: {hoursPerDay: 7}, teams: [], chantiers: [], entries: []});
  assert.ok(!s.isEmpty() && !s.hasChantiers(), 'une base avec seulement des paramètres reste vierge');
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
  assert.ok(s.hasChantiers(), 'la base contient des chantiers');
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

// Le module updater requiert electron : on n'en extrait que les fonctions pures.
const src = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
const pick = re => src.match(re)[0];
const {compareVersions, assetFor} = new Function(`${pick(/function compareVersions[\s\S]*?\n}\n/)}
  ${pick(/const ARCH_NAMES = .*\n/)}
  ${pick(/function assetFor[\s\S]*?\n}\n/)}
  return {compareVersions, assetFor};`)();
assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
assert.ok(compareVersions('v1.2.0', '1.1.9') > 0);
assert.equal(compareVersions('1.0.0', '1.0'), 0);
assert.ok(compareVersions('1.0.0', '1.0.1') < 0);


// Choix du fichier de la release selon la plateforme et l'architecture
const rel = {assets: ['planning-chantiers-1.1.0-arm64.dmg', 'planning-chantiers-1.1.0-arm64.zip', 'planning-chantiers-1.1.0-x64.exe',
  'planning-chantiers-1.1.0-x64.exe.blockmap', 'planning-chantiers-1.1.0-x86_64.AppImage'].map(name => ({name}))};
assert.equal(assetFor(rel, 'zip', 'arm64')?.name, 'planning-chantiers-1.1.0-arm64.zip');
assert.equal(assetFor(rel, 'zip', 'x64'), null, 'pas de zip Intel');
assert.equal(assetFor(rel, 'exe', 'x64')?.name, 'planning-chantiers-1.1.0-x64.exe');
assert.equal(assetFor(rel, 'AppImage', 'x64')?.name, 'planning-chantiers-1.1.0-x86_64.AppImage');
assert.equal(assetFor(rel, undefined, 'x64'), null);

console.log('Tous les tests passent.');
