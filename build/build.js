// Construit l'application pour la plateforme courante (ou celle passée en argument : --mac, --win, --linux)
// hors du dossier du projet, puis copie les fichiers à distribuer dans ./dist :
//   macOS → .dmg + .zip   Windows → .exe (installateur)   Linux → .AppImage
// Sur Mac, le projet est dans Documents, synchronisé par iCloud : il y ajoute des attributs Finder
// incompatibles avec la signature, d'où la construction dans un dossier temporaire.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(os.tmpdir(), 'planning-chantiers-build');
const dist = path.join(root, 'dist');
const args = process.argv.slice(2);
const platforms = ['--mac', '--win', '--linux'];
if (!args.some(a => platforms.includes(a))) args.unshift({darwin: '--mac', win32: '--win'}[process.platform] || '--linux');

fs.rmSync(out, {recursive: true, force: true});
const cli = require.resolve('electron-builder/cli.js', {paths: [root]});
execFileSync(process.execPath, [cli, '--publish', 'never', ...args, `-c.directories.output=${out}`], {cwd: root, stdio: 'inherit'});
fs.mkdirSync(dist, {recursive: true});
for (const f of fs.readdirSync(out).filter(f => /\.(dmg|zip|exe|AppImage)$/.test(f))) {
  fs.copyFileSync(path.join(out, f), path.join(dist, f));
  console.log('→', path.join('dist', f));
}
