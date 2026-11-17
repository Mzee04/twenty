'use strict';
// CI-only smoke test: boots the real Twenty main process, waits for the
// window, and checks the preload bridges and the key box. No API key is used.
const { app } = require('electron');
const result = { preloadErrors: [], consoleErrors: [] };
let done = false;
function finish(ok, extra) {
  if (done) return; done = true;
  Object.assign(result, extra || {}, { ok });
  console.log('TWENTY_SMOKE_RESULT ' + JSON.stringify(result));
  app.exit(ok ? 0 : 1);
}
setTimeout(() => finish(false, { reason: 'timeout' }), 60000);
app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.on('preload-error', (_ev, p, err) => result.preloadErrors.push(String(err && err.message)));
  wc.on('console-message', (...args) => {
    const msg = typeof args[0] === 'object' && args[0] && args[0].message ? args[0].message : args[2];
    const level = typeof args[0] === 'object' && args[0] && args[0].level ? args[0].level : args[1];
    if (level === 'error' || level === 3) result.consoleErrors.push(String(msg));
  });
  wc.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const page = await wc.executeJavaScript(`({
          twentyBridge: !!window.twenty,
          smartspectraBridge: !!window.__smartspectraBridge,
          keyBoxPresent: !!document.getElementById('key-box'),
          title: document.title
        })`);
        const ok = page.twentyBridge && page.smartspectraBridge && result.preloadErrors.length === 0;
        finish(ok, { page });
      } catch (err) { finish(false, { reason: String(err && err.message) }); }
    }, 4000);
  });
});
require('../main.js');
