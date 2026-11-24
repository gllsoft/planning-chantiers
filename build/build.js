// Construit l'application hors du dossier du projet (Documents est synchronisé par iCloud,
// ce qui ajoute des attributs Finder incompatibles avec la signature), puis copie
// le .dmg et le .zip dans ./dist
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(os.tmpdir(), 'planning-chantiers-build');
const dist = path.join(root, 'dist');
fs.rmSync(out, {recursive: true, force: true});
const args = ['electron-builder', '--mac', '--publish', 'never', ...process.argv.slice(2), `-c.directories.output=${out}`];
execFileSync('npx', args, {cwd: root, stdio: 'inherit'});
fs.mkdirSync(dist, {recursive: true});
for (const f of fs.readdirSync(out).filter(f => /\.(dmg|zip)$/.test(f))) {
  fs.copyFileSync(path.join(out, f), path.join(dist, f));
  console.log('→', path.join('dist', f));
}
