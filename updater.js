'use strict';
// Mises à jour depuis les Releases GitHub.
// L'application n'est signée qu'en ad hoc (pas de certificat Apple Developer) : le mécanisme
// standard Squirrel.Mac / electron-updater refuse ce cas. On remplace donc nous-mêmes le
// bundle .app : téléchargement du .zip de la release, vérification de la signature, puis un
// petit script attend la fermeture de l'application, échange les bundles et relance.
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

const assetFor = (release, ext) => release.assets.find(a => a.name.endsWith(`-${process.arch}.${ext}`));

// Renvoie {version, notes, url, zip, dmg} si une version plus récente existe, sinon null.
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
  return {
    version, current: app.getVersion(), notes: rel.body || '', url: rel.html_url,
    zip: assetFor(rel, 'zip')?.browser_download_url || null,
    dmg: assetFor(rel, 'dmg')?.browser_download_url || null,
  };
}

// Chemin du bundle .app en cours d'exécution, s'il peut être remplacé.
function installablePath() {
  const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
  if (!app.isPackaged || !bundle.endsWith('.app')) return {ok: false, reason: "L'application ne tourne pas depuis un bundle installé (mode développement)."};
  if (bundle.startsWith('/Volumes/')) return {ok: false, reason: "L'application est lancée depuis l'image disque. Copiez-la d'abord dans le dossier Applications."};
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); } catch {
    return {ok: false, reason: `Pas de droit d'écriture sur ${path.dirname(bundle)}.`};
  }
  return {ok: true, bundle};
}

// Télécharge et prépare la nouvelle version, puis lance le remplacement (l'appelant quitte ensuite l'app).
async function downloadAndInstall(update, onProgress = () => {}) {
  const target = installablePath();
  if (!target.ok) throw new Error(target.reason);
  if (!update.zip) throw new Error(`Aucun fichier pour cette architecture (${process.arch}) dans la release.`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-maj-'));
  const zip = path.join(work, 'update.zip');
  const res = await fetch(update.zip, {headers: {'User-Agent': 'planning-chantiers-updater'}});
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', chunk => { received += chunk.length; if (total) onProgress(received / total); });
  await pipeline(body, fs.createWriteStream(zip));

  const out = path.join(work, 'app');
  execFileSync('ditto', ['-x', '-k', zip, out]);
  const name = fs.readdirSync(out).find(f => f.endsWith('.app'));
  if (!name) throw new Error("L'archive ne contient pas d'application.");
  const newApp = path.join(out, name);
  execFileSync('codesign', ['--verify', '--deep', '--strict', newApp]);
  const got = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(newApp, 'Contents', 'Info.plist')]).toString().trim();
  if (got !== update.version) throw new Error(`Version inattendue dans l'archive (${got} au lieu de ${update.version}).`);

  // Attend la fin du processus, échange les bundles (avec retour arrière en cas d'échec), relance.
  const script = path.join(work, 'install.sh');
  fs.writeFileSync(script, `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; WORK="$4"; shift 4
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
rm -rf "$OLD.ancien"
if mv "$OLD" "$OLD.ancien"; then
  if mv "$NEW" "$OLD"; then rm -rf "$OLD.ancien"; else mv "$OLD.ancien" "$OLD"; fi
fi
open "$OLD" --args "$@"
rm -rf "$WORK"
`);
  spawn('/bin/sh', [script, String(process.pid), target.bundle, newApp, work, ...process.argv.slice(1)], {detached: true, stdio: 'ignore'}).unref();
}

module.exports = {check, downloadAndInstall, installablePath, compareVersions, RELEASES_URL};
