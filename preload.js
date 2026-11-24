'use strict';
const {contextBridge, ipcRenderer} = require('electron');

const call = ch => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('planningApi', {
  load: call('db:load'),
  save: call('db:save'),
  info: call('db:info'),
  backup: call('db:backup'),
  backupAs: call('db:backupAs'),
  restore: call('db:restore'),
  changeDir: call('db:changeDir'),
  reveal: call('db:reveal'),
  revealBackups: call('db:revealBackups'),
  setBackupOptions: call('db:setBackupOptions'),
  exportJson: call('db:exportJson'),
  importJson: call('db:importJson'),
  onChanged: fn => ipcRenderer.on('db:changed', () => fn()),
});
