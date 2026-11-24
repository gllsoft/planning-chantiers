// Signature ad hoc (sans certificat Apple Developer) : nécessaire pour lancer l'app sur Mac Apple Silicon.
// La signature est faite dans un dossier temporaire : dans un dossier synchronisé par iCloud (Documents),
// macOS ajoute des attributs Finder que codesign refuse.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

exports.default = async ctx => {
  if (ctx.electronPlatformName !== 'darwin') return;
  const name = `${ctx.packager.appInfo.productFilename}.app`;
  const app = path.join(ctx.appOutDir, name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-sign-'));
  const copy = path.join(tmp, name);
  try {
    execFileSync('ditto', ['--noextattr', '--noqtn', app, copy]);
    execFileSync('xattr', ['-cr', copy]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', copy], {stdio: 'inherit'});
    fs.rmSync(app, {recursive: true, force: true});
    execFileSync('ditto', [copy, app]);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
};
