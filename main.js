'use strict';
const {app, BrowserWindow, Menu, dialog, ipcMain, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {Store} = require('./db');

const DB_NAME = 'planning-chantiers.sqlite';
const BACKUP_DIR = 'Sauvegardes';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_DIR = path.join(app.getPath('documents'), 'Planning Chantiers');

let config = {dataDir: DEFAULT_DIR, autoBackup: true, keepBackups: 30};
let store = null;
let win = null;

/* ---------- Configuration ---------- */
function loadConfig() {
  try { Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), {recursive: true});
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const dbFile = (dir = config.dataDir) => path.join(dir, DB_NAME);
const backupDir = () => path.join(config.dataDir, BACKUP_DIR);
const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

function checkWritable(dir) {
  fs.mkdirSync(dir, {recursive: true});
  const probe = path.join(dir, `.ecriture-${process.pid}`);
  fs.writeFileSync(probe, '');
  fs.rmSync(probe);
}

function openStore(dir) {
  checkWritable(dir);
  const s = new Store(dbFile(dir));
  store?.close();
  store = s;
  config.dataDir = dir;
  saveConfig();
}

function notifyChanged() {
  win?.webContents.send('db:changed');
  win?.setRepresentedFilename(dbFile());
}

/* ---------- Sauvegardes ---------- */
function listBackups() {
  try {
    return fs.readdirSync(backupDir()).filter(f => f.endsWith('.sqlite')).sort().reverse()
      .map(f => ({name: f, file: path.join(backupDir(), f), mtime: fs.statSync(path.join(backupDir(), f)).mtimeMs}));
  } catch { return []; }
}

function backup(kind = 'manuelle') {
  fs.mkdirSync(backupDir(), {recursive: true});
  const dest = path.join(backupDir(), `${kind}-${stamp()}.sqlite`);
  store.backupTo(dest);
  return dest;
}

// Une sauvegarde automatique par jour au démarrage, en ne gardant que les N plus récentes.
function autoBackup() {
  if (!config.autoBackup || store.isEmpty()) return;
  const today = stamp().slice(0, 10);
  const autos = listBackups().filter(b => b.name.startsWith('auto-'));
  if (!autos.some(b => b.name.startsWith(`auto-${today}`))) backup('auto');
  const keep = Math.max(1, +config.keepBackups || 30);
  listBackups().filter(b => b.name.startsWith('auto-')).slice(keep).forEach(b => fs.rmSync(b.file, {force: true}));
}

async function backupAs() {
  const r = await dialog.showSaveDialog(win, {
    title: 'Enregistrer une sauvegarde de la base',
    defaultPath: path.join(app.getPath('documents'), `planning-chantiers-${stamp()}.sqlite`),
    filters: [{name: 'Base SQLite', extensions: ['sqlite']}],
  });
  if (r.canceled || !r.filePath) return null;
  store.backupTo(r.filePath);
  return r.filePath;
}

async function restore(file) {
  if (!file) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Restaurer une sauvegarde', defaultPath: backupDir(), properties: ['openFile'],
      filters: [{name: 'Base SQLite', extensions: ['sqlite', 'db']}],
    });
    if (r.canceled || !r.filePaths[0]) return false;
    file = r.filePaths[0];
  }
  if (!Store.validate(file)) {
    dialog.showErrorBox('Restauration impossible', "Ce fichier n'est pas une base Planning Chantiers valide.");
    return false;
  }
  const {response} = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Restaurer', 'Annuler'], defaultId: 0, cancelId: 1,
    message: 'Remplacer les données actuelles par cette sauvegarde ?',
    detail: `${path.basename(file)}\n\nUne copie de sécurité de la base actuelle sera créée avant la restauration.`,
  });
  if (response !== 0) return false;
  backup('avant-restauration');
  store.close();
  fs.copyFileSync(file, dbFile());
  openStore(config.dataDir);
  notifyChanged();
  return true;
}

/* ---------- Dossier de travail ---------- */
async function changeDir() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir le dossier de travail de la base de données', defaultPath: config.dataDir,
    buttonLabel: 'Choisir ce dossier', properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return false;
  const dir = r.filePaths[0];
  if (path.resolve(dir) === path.resolve(config.dataDir)) return false;
  try { checkWritable(dir); } catch (e) {
    dialog.showErrorBox('Dossier inutilisable', `Impossible d'écrire dans ce dossier :\n${dir}\n\n${e.message}`);
    return false;
  }
  if (fs.existsSync(dbFile(dir))) {
    if (!Store.validate(dbFile(dir))) {
      dialog.showErrorBox('Base invalide', `Le fichier ${DB_NAME} présent dans ce dossier n'est pas une base valide.`);
      return false;
    }
    const {response} = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Ouvrir cette base', 'La remplacer par la base actuelle', 'Annuler'], defaultId: 0, cancelId: 2,
      message: 'Une base de données existe déjà dans ce dossier.',
      detail: 'Voulez-vous travailler sur la base existante, ou l\'écraser avec vos données actuelles ? (dans ce cas, une sauvegarde de la base existante est d\'abord créée dans son dossier « Sauvegardes »)',
    });
    if (response === 2) return false;
    if (response === 1) {
      const old = new Store(dbFile(dir));
      fs.mkdirSync(path.join(dir, BACKUP_DIR), {recursive: true});
      old.backupTo(path.join(dir, BACKUP_DIR, `avant-remplacement-${stamp()}.sqlite`));
      old.close();
      store.backupTo(dbFile(dir));
    }
  } else {
    const {response} = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Copier la base actuelle', 'Démarrer une base vide', 'Annuler'], defaultId: 0, cancelId: 2,
      message: 'Aucune base dans ce dossier.',
      detail: 'Copier vos données actuelles vers ce dossier, ou y démarrer une nouvelle base ? L\'ancien fichier reste en place dans l\'ancien dossier.',
    });
    if (response === 2) return false;
    if (response === 0) store.backupTo(dbFile(dir));
  }
  openStore(dir);
  notifyChanged();
  return true;
}

// Au démarrage : le dossier configuré peut être absent (disque externe débranché, etc.).
function ensureDataDir() {
  while (true) {
    if (config.dataDir === DEFAULT_DIR || fs.existsSync(config.dataDir)) {
      try { openStore(config.dataDir); return true; } catch (e) {
        dialog.showErrorBox('Base de données inaccessible', `${dbFile()}\n\n${e.message}`);
      }
    }
    const response = dialog.showMessageBoxSync({
      type: 'warning', buttons: ['Choisir un dossier…', 'Utiliser le dossier par défaut', 'Quitter'], defaultId: 0, cancelId: 2,
      message: 'Le dossier de travail est introuvable ou inaccessible.',
      detail: `${config.dataDir}\n\nDossier par défaut : ${DEFAULT_DIR}`,
    });
    if (response === 2) return false;
    if (response === 1) config.dataDir = DEFAULT_DIR;
    else {
      const p = dialog.showOpenDialogSync({properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Choisir ce dossier'});
      if (p?.[0]) config.dataDir = p[0];
    }
  }
}

/* ---------- Export / import JSON ---------- */
async function exportJson() {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter les données (JSON)',
    defaultPath: path.join(app.getPath('documents'), `planning-chantiers-${stamp().slice(0, 10)}.json`),
    filters: [{name: 'JSON', extensions: ['json']}],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(store.load(), null, 2));
  return r.filePath;
}

async function importJson() {
  const r = await dialog.showOpenDialog(win, {title: 'Importer des données (JSON)', properties: ['openFile'], filters: [{name: 'JSON', extensions: ['json']}]});
  if (r.canceled || !r.filePaths[0]) return false;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!data.settings || !Array.isArray(data.chantiers) || !Array.isArray(data.entries)) throw new Error('format');
    data.teams ||= [];
  } catch {
    dialog.showErrorBox('Import impossible', 'Fichier invalide.');
    return false;
  }
  const {response} = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Importer', 'Annuler'], defaultId: 0, cancelId: 1,
    message: 'Remplacer toutes les données actuelles par le contenu de ce fichier ?',
    detail: 'Une sauvegarde de la base actuelle sera créée avant l\'import.',
  });
  if (response !== 0) return false;
  if (!store.isEmpty()) backup('avant-import');
  store.save(data);
  notifyChanged();
  return true;
}

/* ---------- IPC ---------- */
const info = () => ({
  dataDir: config.dataDir, dbFile: dbFile(), backupDir: backupDir(),
  autoBackup: config.autoBackup, keepBackups: config.keepBackups,
  backups: listBackups().slice(0, 50).map(({name, file, mtime}) => ({name, file, mtime})),
});

const handlers = {
  'db:load': () => store.load(),
  'db:save': (_, state) => { store.save(state); return true; },
  'db:info': info,
  'db:backup': () => backup('manuelle'),
  'db:backupAs': backupAs,
  'db:restore': (_, file) => restore(file),
  'db:changeDir': changeDir,
  'db:reveal': () => shell.openPath(config.dataDir),
  'db:revealBackups': () => { fs.mkdirSync(backupDir(), {recursive: true}); return shell.openPath(backupDir()); },
  'db:setBackupOptions': (_, o) => {
    config.autoBackup = !!o.autoBackup;
    config.keepBackups = Math.max(1, Math.min(365, Math.round(+o.keepBackups || 30)));
    saveConfig();
    return info();
  },
  'db:exportJson': exportJson,
  'db:importJson': importJson,
};
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, fn);

/* ---------- Menu ---------- */
async function menuAction(fn, okMsg) {
  try {
    const r = await fn();
    if (r && okMsg) dialog.showMessageBox(win, {type: 'info', message: okMsg, detail: typeof r === 'string' ? r : ''});
  } catch (e) { dialog.showErrorBox('Erreur', e.message); }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {role: 'appMenu'},
    {label: 'Fichier', submenu: [
      {label: 'Sauvegarder maintenant', accelerator: 'CmdOrCtrl+S', click: () => menuAction(() => backup('manuelle'), 'Sauvegarde créée')},
      {label: 'Enregistrer une sauvegarde sous…', accelerator: 'CmdOrCtrl+Shift+S', click: () => menuAction(backupAs, 'Sauvegarde enregistrée')},
      {label: 'Restaurer une sauvegarde…', click: () => menuAction(() => restore())},
      {label: 'Afficher les sauvegardes dans le Finder', click: () => handlers['db:revealBackups']()},
      {type: 'separator'},
      {label: 'Changer le dossier de travail…', click: () => menuAction(changeDir)},
      {label: 'Afficher le dossier de travail dans le Finder', click: () => shell.openPath(config.dataDir)},
      {type: 'separator'},
      {label: 'Exporter en JSON…', click: () => menuAction(exportJson, 'Export terminé')},
      {label: 'Importer depuis un JSON…', click: () => menuAction(importJson)},
      {type: 'separator'},
      {role: 'close', label: 'Fermer la fenêtre'},
    ]},
    {role: 'editMenu'},
    {label: 'Présentation', submenu: [
      {role: 'reload', label: 'Recharger'},
      ...(app.isPackaged ? [] : [{role: 'toggleDevTools'}]),
      {type: 'separator'},
      {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'},
      {type: 'separator'},
      {role: 'togglefullscreen'},
    ]},
    {role: 'windowMenu'},
  ]));
}

/* ---------- Fenêtre ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Planning Chantiers',
    backgroundColor: '#f5f6f8', show: false,
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false},
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.setRepresentedFilename(dbFile());
  win.loadFile(path.join(__dirname, 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadConfig();
    if (!ensureDataDir()) return app.quit();
    try { autoBackup(); } catch (e) { console.error('Sauvegarde automatique impossible :', e); }
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => store?.close());
}
