'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guideFromBreathing } = require('../src/pacer');
const { explainSdkError, CODE } = require('../src/sdk-errors');
const { parseEnv } = require('../src/env');

test('the guide follows a confident breathing rate, a little slower', () => {
  const guided = guideFromBreathing(10, 80);
  assert.equal(guided.source, 'breathing');
  assert.ok(Math.abs(guided.bpm - 9) < 0.001);
  assert.ok(Math.abs(guided.inhaleMs + guided.exhaleMs - guided.cycleMs) < 0.001);

  const fast = guideFromBreathing(30, 90);
  assert.equal(fast.bpm, 12);

  const quiet = guideFromBreathing(14, 10);
  assert.equal(quiet.source, 'default');
  assert.equal(quiet.bpm, 6);

  const out = guideFromBreathing(4, 90);
  assert.equal(out.source, 'default');
});

test('sdk errors stay in plain language, including the known network failure', () => {
  const network = explainSdkError(CODE.NETWORK, 'Usage verification failed. Status code: 0', true);
  assert.equal(network.kind, 'network');
  assert.equal(network.retryable, true);
  assert.match(network.text, /nothing was measured/i);

  const keys = explainSdkError(CODE.NOT_AUTHORIZED, 'Failed to load device keys', false);
  assert.equal(keys.kind, 'cardio');

  const auth = explainSdkError(CODE.AUTH, 'Authentication failed', false);
  assert.equal(auth.kind, 'auth');

  const rate = explainSdkError(CODE.LOW_FRAME_RATE, 'frame rate', false);
  assert.match(rate.text, /will not restart/i);
});

test('env files keep comments and quoted values', () => {
  const parsed = parseEnv(`
# comment
SMARTSPECTRA_API_KEY="abc def"
TWENTY_RELAY_URL=ws://127.0.0.1:47221
EMPTY=
`);
  assert.equal(parsed.SMARTSPECTRA_API_KEY, 'abc def');
  assert.equal(parsed.TWENTY_RELAY_URL, 'ws://127.0.0.1:47221');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed['# comment'], undefined);
});
