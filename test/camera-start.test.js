'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  preferredVideoConstraints,
  fallbackVideoConstraints,
  openCamera,
  cameraFailureView,
  formatCameraFailureLog,
  formatConsoleMessage,
  redact,
} = require('../src/camera-start');
const { restoreContinuousCamera } = require('../src/camera-controls');

test('preferred camera settings ask for 30 fps and do not require a minimum', () => {
  const video = preferredVideoConstraints().video;
  assert.deepEqual(video.frameRate, { ideal: 30 });
  assert.equal(Object.hasOwn(video.frameRate, 'min'), false);
  assert.equal(preferredVideoConstraints().audio, false);
});

test('an overconstrained camera falls back to a plain video request', async () => {
  const calls = [];
  const stream = { id: 'fallback' };
  const opened = await openCamera(async (constraints) => {
    calls.push(constraints);
    if (constraints.video !== true) {
      const err = new Error('frame rate');
      err.name = 'OverconstrainedError';
      throw err;
    }
    return stream;
  });
  assert.equal(opened, stream);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].video, true);
  assert.deepEqual(calls[1], fallbackVideoConstraints());
});

test('other camera errors are not retried with looser settings', async () => {
  let calls = 0;
  await assert.rejects(
    () => openCamera(async () => {
      calls += 1;
      const err = new Error('busy');
      err.name = 'NotReadableError';
      throw err;
    }),
    (err) => err.name === 'NotReadableError',
  );
  assert.equal(calls, 1);
});

test('the banner keeps the error name and a short message', () => {
  const err = new Error('Could not start video source');
  err.name = 'NotReadableError';
  const view = cameraFailureView(err);
  assert.match(view.lead, /turned on and then stopped/);
  assert.equal(view.detail, 'NotReadableError: Could not start video source');

  const plain = new Error('__smartspectraBridge is unavailable');
  plain.name = 'Error';
  const generic = cameraFailureView(plain);
  assert.match(generic.lead, /did not start/);
  assert.equal(generic.detail, 'Error: __smartspectraBridge is unavailable');
});

test('camera logs include name, message, code, and stack, and never the API key', () => {
  const secret = 'sk-live-secret-value';
  const err = new Error(`failed for ${secret}`);
  err.name = 'TypeError';
  err.code = 'NO_CODE';
  err.stack = `TypeError: failed for ${secret}\n at start`;
  const line = formatCameraFailureLog(err, secret);
  assert.match(line, /name=TypeError/);
  assert.match(line, /code=NO_CODE/);
  assert.match(line, /message=/);
  assert.match(line, /stack=/);
  assert.equal(line.includes(secret), false);
  assert.match(line, /\[redacted\]/);
  assert.equal(redact(`key ${secret} end`, secret).includes(secret), false);
});

test('renderer console lines can be printed from the main process', () => {
  const modern = formatConsoleMessage({
    message: 'camera start failed',
    level: 'error',
    lineNumber: 12,
    sourceId: 'file:///renderer.js',
  });
  assert.equal(modern, '[renderer error] camera start failed (file:///renderer.js:12)');
  const legacy = formatConsoleMessage(3, 'boom', 4, 'app.js');
  assert.equal(legacy, '[renderer error] boom (app.js:4)');
});

test('restoring camera controls never throws when the Mac rejects them', async () => {
  const track = {
    readyState: 'live',
    getCapabilities() {
      throw new Error('capabilities unavailable');
    },
    applyConstraints() {
      throw new Error('should not be called');
    },
  };
  assert.equal(await restoreContinuousCamera(track), false);

  const rejecting = {
    readyState: 'live',
    getCapabilities() {
      return {
        exposureMode: ['manual', 'continuous'],
        whiteBalanceMode: ['continuous'],
        focusMode: ['continuous'],
      };
    },
    async applyConstraints(constraints) {
      const key = Object.keys(constraints.advanced[0])[0];
      if (key === 'exposureMode') {
        const err = new Error('exposureMode not supported');
        err.name = 'OverconstrainedError';
        throw err;
      }
    },
  };
  assert.equal(await restoreContinuousCamera(rejecting), true);
  assert.equal(await restoreContinuousCamera(null), false);
});

test('the Mac build declares camera use, including Continuity Camera', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const info = pkg.build.mac.extendInfo;
  assert.match(info.NSCameraUsageDescription, /camera/i);
  assert.equal(info.NSCameraUseContinuityCameraDeviceType, true);
});

test('SmartSpectra 3.5.0 ships native darwin-arm64 and win32-x64 runtimes', () => {
  const sdk = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../node_modules/@smartspectra/node-sdk/package.json'),
    'utf8',
  ));
  const deps = Object.assign({}, sdk.dependencies, sdk.optionalDependencies);
  assert.equal(sdk.version, '3.5.0');
  for (const name of [
    '@smartspectra/node-sdk-darwin-arm64',
    '@smartspectra/node-sdk-win32-x64',
    '@smartspectra/node-sdk-linux-x64',
    '@smartspectra/node-sdk-linux-arm64',
  ]) {
    assert.equal(deps[name], '3.5.0', name);
  }
  assert.equal(
    fs.existsSync(path.join(__dirname, '../node_modules/@smartspectra/node-sdk-darwin-arm64/package.json')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(__dirname, '../node_modules/@smartspectra/node-sdk-win32-x64/smartspectra_capi.dll')),
    true,
  );
});
