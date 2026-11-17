'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('the running app does not call an insight or readiness API', () => {
  const live = read('src/live-session.js');
  assert.match(live, /enableTelemetry:\s*false/);
  assert.equal(live.includes('requestInsight('), false);
  assert.equal(live.includes('checkDeviceReadiness('), false);

  const sources = [
    'main.js',
    'preload.js',
    'renderer.js',
    'index.html',
    'relay/server.js',
    'src/flooding.js',
    'src/protocol.js',
    'src/pacer.js',
    'src/mock-session.js',
    'src/sim-peer.js',
    'src/traces.js',
    'src/live-session.js',
  ].map(read).join('\n');

  assert.equal(/api\.openai\.com|anthropic\.com|generativelanguage/i.test(sources), false);
  assert.match(read('index.html'), /Cursor, an AI coding agent/);
  assert.match(read('README.md'), /## Consent and Data Handling/);
  assert.match(read('SUBMISSION.md'), /## Consent and Data Handling/);
});
