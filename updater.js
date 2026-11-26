'use strict';
// Mises à jour depuis les Releases GitHub, pour macOS, Windows et Linux.
// - macOS : l'application n'est signée qu'en ad hoc (pas de certificat Apple Developer), le mécanisme
//   standard Squirrel.Mac / electron-updater refuse ce cas. On remplace donc nous-mêmes le bundle .app :
//   téléchargement du .zip, vérification de la signature, puis un petit script attend la fermeture de
//   l'application, échange les bundles et relance.
// - Windows : téléchargement de l'installateur NSIS (.exe) et exécution silencieuse ; il remplace
//   l'installation existante puis relance l'application.
// - Linux : version AppImage uniquement — le fichier .AppImage est remplacé puis relancé.
const {app} = require('electron');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const REPO = 'gllsoft/planning-chantiers';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

// Compare deux versions « 1.2.3 » : > 0 si a est plus récente que b.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Fichiers de la release par plateforme : « auto » pour l'installation automatique, « manual » à télécharger
// soi-même. Noms : planning-chantiers-<version>-<arch>.<ext> (voir artifactName dans package.json).
const KINDS = {darwin: {auto: 'zip', manual: 'dmg'}, win32: {auto: 'exe', manual: 'exe'}, linux: {auto: 'AppImage', manual: 'AppImage'}};
// electron-builder nomme l'architecture différemment selon le format (x64, x86_64, amd64…).
const ARCH_NAMES = {x64: ['x64', 'x86_64', 'amd64'], arm64: ['arm64', 'aarch64'], ia32: ['ia32', 'i386']};

function assetFor(release, ext, arch = process.arch) {
  if (!ext) return null;
  const names = ARCH_NAMES[arch] || [arch];
  return release.assets.find(a => names.some(n => a.name.endsWith(`-${n}.${ext}`))) || null;
}

// Renvoie {version, current, notes, url, file, download} si une version plus récente existe, sinon null.
async function check() {
  // PLANNING_UPDATE_FEED : uniquement pour tester les mises à jour avec un serveur local.
  const feed = process.env.PLANNING_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(feed, {
    headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'planning-chantiers-updater'},
  });
  if (res.status === 404) return null; // aucune release publiée
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const rel = await res.json();
  const version = rel.tag_name.replace(/^v/, '');
  if (compareVersions(version, app.getVersion()) <= 0) return null;
  const kind = KINDS[process.platform] || {};
  return {
    version, current: app.getVersion(), notes: rel.body || '', url: rel.html_url,
    file: assetFor(rel, kind.auto)?.browser_download_url || null,
    download: assetFor(rel, kind.manual)?.browser_download_url || null,
  };
}

// Indique si l'application en cours d'exécution peut être remplacée automatiquement.
function installTarget() {
  if (!app.isPackaged) return {ok: false, reason: "L'application ne tourne pas depuis une version installée (mode développement)."};
  const writable = dir => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };
  if (process.platform === 'darwin') {
    const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
    if (!bundle.endsWith('.app')) return {ok: false, reason: "L'application ne tourne pas depuis un bundle .app."};
    if (bundle.startsWith('/Volumes/')) return {ok: false, reason: "L'application est lancée depuis l'image disque. Copiez-la d'abord dans le dossier Applications."};
    if (!writable(path.dirname(bundle)) || !writable(bundle)) return {ok: false, reason: `Pas de droit d'écriture sur ${path.dirname(bundle)}.`};
    return {ok: true, bundle};
  }
  if (process.platform === 'win32') {
    const dir = path.dirname(process.execPath);
    if (!fs.readdirSync(dir).some(f => /^Uninstall .*\.exe$/i.test(f)))
      return {ok: false, reason: "L'application n'a pas été installée avec l'installateur : téléchargez la nouvelle version."};
    return {ok: true};
  }
  if (process.platform === 'linux') {
    const image = process.env.APPIMAGE;
    if (!image) return {ok: false, reason: 'La mise à jour automatique n\'est disponible que pour la version AppImage.'};
    if (!writable(path.dirname(image))) return {ok: false, reason: `Pas de droit d'écriture sur ${path.dirname(image)}.`};
    return {ok: true, image};
  }
  return {ok: false, reason: `Plateforme non prise en charge (${process.platform}).`};
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, {headers: {'User-Agent': 'planning-chantiers-updater'}});
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', chunk => { received += chunk.length; if (total) onProgress(received / total); });
  await pipeline(body, fs.createWriteStream(dest));
}

// Lance un script shell détaché qui attend la fin du processus courant.
function runDetachedScript(work, content, args) {
  const script = path.join(work, 'install.sh');
  fs.writeFileSync(script, content);
  spawn('/bin/sh', [script, String(process.pid), ...args], {detached: true, stdio: 'ignore'}).unref();
}

// Télécharge et prépare la nouvelle version, puis lance le remplacement (l'appelant quitte ensuite l'app).
async function downloadAndInstall(update, onProgress = () => {}) {
  const target = installTarget();
  if (!target.ok) throw new Error(target.reason);
  if (!update.file) throw new Error(`Aucun fichier pour cette plateforme (${process.platform}-${process.arch}) dans la release.`);
  if (!decodeURIComponent(update.file).includes(`-${update.version}-`))
    throw new Error(`Le fichier de la release ne correspond pas à la version ${update.version}.`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-maj-'));

  if (process.platform === 'win32') {
    const setup = path.join(work, `planning-chantiers-${update.version}-setup.exe`);
    await download(update.file, setup, onProgress);
    // Installation silencieuse par-dessus la version actuelle, puis relance de l'application.
    spawn(setup, ['--updated', '/S', '--force-run'], {detached: true, stdio: 'ignore'}).unref();
    return;
  }

  if (process.platform === 'linux') {
    // Téléchargement à côté de l'AppImage actuelle (même disque, pour un renommage atomique).
    const next = `${target.image}.maj`;
    await download(update.file, next, onProgress);
    fs.chmodSync(next, 0o755);
    runDetachedScript(work, `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; WORK="$4"; shift 4
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
mv -f "$NEW" "$OLD" || rm -f "$NEW"
rm -rf "$WORK"
nohup "$OLD" "$@" >/dev/null 2>&1 &
`, [target.image, next, work, ...process.argv.slice(1)]);
    return;
  }

  // macOS
  const zip = path.join(work, 'update.zip');
  await download(update.file, zip, onProgress);
  const out = path.join(work, 'app');
  execFileSync('ditto', ['-x', '-k', zip, out]);
  const name = fs.readdirSync(out).find(f => f.endsWith('.app'));
  if (!name) throw new Error("L'archive ne contient pas d'application.");
  const newApp = path.join(out, name);
  execFileSync('codesign', ['--verify', '--deep', '--strict', newApp]);
  const got = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(newApp, 'Contents', 'Info.plist')]).toString().trim();
  if (got !== update.version) throw new Error(`Version inattendue dans l'archive (${got} au lieu de ${update.version}).`);

  // Attend la fin du processus, échange les bundles (avec retour arrière en cas d'échec), relance.
  runDetachedScript(work, `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; WORK="$4"; shift 4
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
rm -rf "$OLD.ancien"
if mv "$OLD" "$OLD.ancien"; then
  if mv "$NEW" "$OLD"; then rm -rf "$OLD.ancien"; else mv "$OLD.ancien" "$OLD"; fi
fi
open "$OLD" --args "$@"
rm -rf "$WORK"
`, [target.bundle, newApp, work, ...process.argv.slice(1)]);
}

module.exports = {check, downloadAndInstall, installTarget, compareVersions, assetFor, RELEASES_URL};
