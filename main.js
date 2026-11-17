'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { parseEnv } = require('./src/env');
const { startRelay } = require('./relay/server');
const { formatConsoleMessage, redact } = require('./src/camera-start');

// Packaged builds keep the native SmartSpectra libraries outside app.asar
// and point the binding at them before the SDK is required. This follows
// Presage's electron-quickstart sample.
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
  const libName = {
    darwin: 'libsmartspectra_capi.dylib',
    win32: 'smartspectra_capi.dll',
    linux: 'libsmartspectra_capi.so',
  }[process.platform];
  if (libName) {
    process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', libName);
  }
}

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function userConfigPath() {
  return path.join(app.getPath('userData'), 'twenty.config.json');
}

function readConfig() {
  const fileEnv = {};
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    Object.assign(fileEnv, parseEnv(fs.readFileSync(envPath, 'utf8')));
  }
  const projectJson = fs.existsSync(path.join(__dirname, 'twenty.config.json'))
    ? readJson(path.join(__dirname, 'twenty.config.json'))
    : {};
  const savedJson = fs.existsSync(userConfigPath()) ? readJson(userConfigPath()) : {};
  const pick = (envKey, jsonKey) => {
    if (process.env[envKey]) return process.env[envKey];
    if (fileEnv[envKey]) return fileEnv[envKey];
    if (projectJson && projectJson[jsonKey]) return projectJson[jsonKey];
    if (savedJson && savedJson[jsonKey]) return savedJson[jsonKey];
    return '';
  };
  return {
    apiKey: String(pick('SMARTSPECTRA_API_KEY', 'apiKey')).trim(),
    relayUrl: String(pick('TWENTY_RELAY_URL', 'relayUrl')).trim(),
    forceMock: String(process.env.TWENTY_MOCK || fileEnv.TWENTY_MOCK || '') === '1',
  };
}

function writeSavedConfig(patch) {
  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? readJson(file) : {};
  const next = { ...current, ...patch };
  fs.writeFileSync(file, `${JSON.stringify(next)}\n`, { mode: 0o600 });
}

let relayHandle = null;

async function ensureRelay(config) {
  if (config.relayUrl) return config.relayUrl;
  relayHandle = await startRelay({ host: '127.0.0.1', port: 47221 });
  return relayHandle.url;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#f6f1ea',
    title: 'Twenty',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // sandbox must stay false. A sandboxed preload cannot require an npm
      // package. On an Apple M4 Mac, sandbox: true logged
      // "module not found: @smartspectra/node-sdk/preload" and the live
      // camera never started. sandbox: false loads that preload; the pulse
      // then works. The page still has no Node, and context isolation stays on.
      sandbox: false,
      nodeIntegration: false,
    },
  });

  bindSmartSpectraIpc(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('console-message', (event) => {
    const line = redact(formatConsoleMessage(event), publicConfig.apiKey);
    console.log(line);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error && error.message ? error.message : String(error || '');
    console.error('[twenty] preload error', preloadPath, redact(message, publicConfig.apiKey));
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

let publicConfig = {
  apiKey: '',
  relayUrl: '',
  forceMock: false,
  telemetryDisabled: true,
  preview: false,
};

app.setName('Twenty');

app.whenReady().then(async () => {
  const config = readConfig();
  let relayUrl = config.relayUrl;
  try {
    relayUrl = await ensureRelay(config);
  } catch (err) {
    console.error('[twenty] local relay did not start:', err && err.message);
  }

  publicConfig = {
    apiKey: config.apiKey,
    relayUrl: relayUrl || '',
    forceMock: config.forceMock,
    telemetryDisabled: true,
    preview: false,
  };

  ipcMain.handle('twenty:getConfig', () => publicConfig);

  ipcMain.handle('twenty:saveKey', (_event, apiKey) => {
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false };
    try {
      writeSavedConfig({ apiKey: key });
    } catch {
      return { ok: false };
    }
    publicConfig.apiKey = readConfig().apiKey;
    return { ok: true };
  });

  ipcMain.handle('twenty:clearSavedKey', () => {
    try {
      const file = userConfigPath();
      if (fs.existsSync(file)) {
        const current = readJson(file);
        delete current.apiKey;
        fs.writeFileSync(file, `${JSON.stringify(current)}\n`, { mode: 0o600 });
      }
    } catch {
      return { ok: false, hasKey: Boolean(publicConfig.apiKey) };
    }
    publicConfig.apiKey = readConfig().apiKey;
    return { ok: true, hasKey: Boolean(publicConfig.apiKey) };
  });

  // Camera only, and only for this app's own page. The OS indicator still shows.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (relayHandle) {
    relayHandle.close().catch(() => {});
    relayHandle = null;
  }
});
