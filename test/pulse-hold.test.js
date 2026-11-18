'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPulseHold } = require('../src/pulse-hold');
const { createFloodingDetector } = require('../src/flooding');

test('a breathing-only update reuses the last real pulse for up to 3 seconds', () => {
  const fill = createPulseHold();
  fill({ tMs: 0, pulse: 72, confidence: 85, stable: true, framingOk: true });
  const held = fill({ tMs: 2000, pulse: null, confidence: 0, stable: false, framingOk: true });
  assert.equal(held.pulse, 72);
  assert.equal(held.confidence, 85);
  assert.equal(held.pulseHeld, true);
  const stale = fill({ tMs: 3500, pulse: null, confidence: 0, stable: false, framingOk: true });
  assert.equal(stale.pulse, null);
});

test('framing problems still pass through while a pulse is held', () => {
  const fill = createPulseHold();
  fill({ tMs: 0, pulse: 72, confidence: 85, stable: true, framingOk: true });
  const r = fill({ tMs: 500, pulse: null, confidence: 0, stable: false, framingOk: false });
  assert.equal(r.framingOk, false);
});

test('mixed pulse and breathing-only updates fill a 30 second calm reference', () => {
  // Like the live log: about 30 updates a second, a real pulse about once a second.
  const fill = createPulseHold();
  const det = createFloodingDetector({ baselineMs: 30000 });
  let snap;
  for (let t = 0; t <= 32000; t += 33) {
    const hasPulse = t % 990 === 0;
    const r = fill({
      tMs: t,
      pulse: hasPulse ? 72 : null,
      confidence: hasPulse ? 85 : 0,
      stable: hasPulse,
      framingOk: true,
    });
    snap = det.push(r);
  }
  assert.equal(snap.phase, 'listening');
  assert.equal(snap.baseline, 72);
});
