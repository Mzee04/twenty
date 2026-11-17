'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { availabilityFromConfig, homeKeyVisibility } = require('../src/home-key');

test('the key box is on the home screen when no key is loaded', () => {
  const noKey = homeKeyVisibility({ screen: 'lobby', liveAvailable: false });
  assert.equal(noKey.keyBoxHidden, false);
  assert.equal(noKey.removeHidden, true);
  assert.equal(noKey.changeKeyHidden, true);

  const saved = availabilityFromConfig({
    apiKey: 'present',
    forceMock: false,
    preview: false,
  });
  assert.equal(saved.liveAvailable, true);
  const after = homeKeyVisibility({ screen: 'lobby', liveAvailable: saved.liveAvailable });
  assert.equal(after.keyBoxHidden, true);
  assert.equal(after.removeHidden, false);
  assert.equal(after.changeKeyHidden, false);

  const editing = homeKeyVisibility({
    screen: 'lobby',
    liveAvailable: true,
    editingKey: true,
  });
  assert.equal(editing.keyBoxHidden, false);
  assert.equal(editing.changeKeyHidden, true);
  assert.equal(editing.removeHidden, false);
});

test('an empty key, practice mode, or the browser preview does not turn the camera live', () => {
  assert.equal(availabilityFromConfig({ apiKey: '', forceMock: false, preview: false }).liveAvailable, false);
  assert.equal(availabilityFromConfig({ apiKey: 'present', forceMock: true, preview: false }).liveAvailable, false);
  assert.equal(availabilityFromConfig({ apiKey: 'present', forceMock: false, preview: true }).liveAvailable, false);
  assert.equal(availabilityFromConfig(null).liveAvailable, false);
});

test('the renderer does not hide the key box when the save bridge is missing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  assert.equal(source.includes('!canSave'), false);
  assert.match(source, /homeKeyVisibility/);
  assert.match(source, /Key saved\. Your camera will be live\./);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /paste a key on the next screen/);
  assert.match(html, /id="key-box"/);
  assert.match(html, /id="key-save-note"/);
  assert.match(html, /Use a different key/);
  assert.match(html, /Remove saved key/);
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(main, /sandbox:\s*false/);
  assert.match(main, /module not found: @smartspectra\/node-sdk\/preload/);
});
