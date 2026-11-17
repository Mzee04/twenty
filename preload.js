'use strict';

// Our preload plus the SmartSpectra bridge. The SDK's renderer talks to the
// main process through window.__smartspectraBridge. Twenty's own config goes
// through window.twenty and never includes a pulse.
//
// Expose Twenty's bridge first. If the SDK preload throws, the key box can
// still save a key. The key itself is not logged.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twenty', {
  getConfig: () => ipcRenderer.invoke('twenty:getConfig'),
  saveKey: (apiKey) => ipcRenderer.invoke('twenty:saveKey', apiKey),
  clearSavedKey: () => ipcRenderer.invoke('twenty:clearSavedKey'),
});

try {
  require('@smartspectra/node-sdk/preload');
} catch (err) {
  console.error('[twenty] SmartSpectra preload did not load:', err && err.message);
}
