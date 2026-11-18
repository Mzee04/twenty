'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFloodingDetector } = require('../src/flooding');
const { buildTrace } = require('../src/traces');
const { framingPausesPulse, VALIDATION } = require('../src/validation');

function good(tMs, pulse, extra = {}) {
  return {
    tMs,
    pulse,
    confidence: 80,
    stable: true,
    framingOk: true,
    ...extra,
  };
}

function run(det, from, to, pulse, extra) {
  let snap;
  for (let t = from; t <= to; t += 1000) {
    snap = det.push(good(t, pulse, extra));
  }
  return snap;
}

test('baseline is the median once confident samples span 60 seconds', () => {
  const det = createFloodingDetector();
  let snap = run(det, 0, 59000, 70);
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.baseline, null);

  // A high spike in the window should not drag the median off 70.
  det.push(good(59500, 110));
  snap = det.push(good(60000, 72));
  assert.equal(snap.phase, 'listening');
  assert.equal(snap.baseline, 70);
  assert.equal(snap.flooded, false);
});

test('low confidence does not advance the baseline', () => {
  const det = createFloodingDetector();
  let snap = run(det, 0, 30000, 70);
  const held = snap.baselineMs;
  for (let t = 31000; t <= 40000; t += 1000) {
    snap = det.push(good(t, 70, { confidence: 10, stable: true }));
  }
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.paused, true);
  assert.equal(snap.pauseReason, 'confidence');
  assert.equal(snap.baselineMs, held);
  assert.equal(snap.restartedBaseline, false);
});

test('confidence at the gate counts, and one point under it does not', () => {
  const det = createFloodingDetector();
  let snap = det.push(good(0, 70, { confidence: 60 }));
  assert.equal(snap.paused, false);
  snap = det.push(good(1000, 70, { confidence: 59 }));
  assert.equal(snap.paused, true);
  assert.equal(snap.pauseReason, 'confidence');
});

test('framing problems pause the calm minute and a long one restarts it', () => {
  const det = createFloodingDetector();
  run(det, 0, 30000, 68);
  let snap = run(det, 31000, 40000, 68, { framingOk: false });
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.pauseReason, 'framing');
  assert.equal(snap.restartedBaseline, false);
  assert.ok(snap.baselineMs >= 30000);

  let sawRestart = false;
  for (let t = 41000; t <= 60000; t += 1000) {
    snap = det.push(good(t, 68, { framingOk: false }));
    if (snap.restartedBaseline) sawRestart = true;
  }
  assert.equal(sawRestart, true);
  assert.equal(snap.baselineMs, 0);
  assert.equal(snap.phase, 'baselining');
});

test('a minute already near 100 is not kept as the calm reference', () => {
  const det = createFloodingDetector();
  const snap = run(det, 0, 60000, 100);
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.baseline, null);
  assert.equal(snap.flooded, false);
  assert.equal(snap.restartedBaseline, true);
  assert.equal(snap.restartReason, 'high');
  assert.equal(snap.lastRejectedMedian, 100);
});

test('well above baseline fires at 20 seconds and not at 19', () => {
  const det = createFloodingDetector();
  const locked = run(det, 0, 60000, 70);
  assert.equal(locked.baseline, 70);

  // 70 + 15 = 85. 84 is not "well above" and is not near 100.
  let snap = run(det, 61000, 90000, 84);
  assert.equal(snap.flooded, false);

  const det2 = createFloodingDetector();
  run(det2, 0, 60000, 70);
  snap = run(det2, 61000, 79000, 85);
  assert.equal(snap.flooded, false);
  assert.ok(snap.elevatedMs < 20000);
  snap = det2.push(good(80000, 85));
  assert.equal(snap.flooded, true);
  assert.ok(snap.elevatedMs >= 20000);
});

test('a confident calm sample resets the 20 second clock', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  run(det, 61000, 79000, 90);
  let snap = det.push(good(80000, 72));
  assert.equal(snap.flooded, false);
  assert.equal(snap.elevatedMs, 0);
  snap = run(det, 81000, 99000, 90);
  assert.equal(snap.flooded, false);
});

test('near 100 fires even when it is not well above a high baseline', () => {
  const det = createFloodingDetector();
  const locked = run(det, 0, 60000, 90);
  assert.equal(locked.baseline, 90);
  // 90 + 15 = 105, so 95 is neither near 100 nor well above baseline.
  let snap = run(det, 61000, 90000, 95);
  assert.equal(snap.flooded, false);

  const det2 = createFloodingDetector();
  run(det2, 0, 60000, 90);
  snap = run(det2, 61000, 80000, 96);
  assert.equal(snap.flooded, true);
});

test('readings outside 40–110 do not count as a high pulse', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  const snap = run(det, 61000, 90000, 120);
  assert.equal(snap.flooded, false);
  assert.equal(snap.pauseReason, 'range');
  assert.equal(snap.elevatedMs, 0);
});

test('a short framing or confidence gap pauses the clock instead of wiping it', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  run(det, 61000, 70000, 100);
  const mid = det.snapshot().elevatedMs;
  assert.equal(mid, 10000);

  let snap = run(det, 71000, 74000, 100, { framingOk: false });
  assert.equal(snap.elevatedMs, mid);
  assert.equal(snap.pauseReason, 'framing');

  snap = run(det, 75000, 84000, 100);
  assert.equal(snap.flooded, true);
});

test('a framing gap longer than 5 seconds drops the half-built cue', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  run(det, 61000, 70000, 100);
  const snap = run(det, 71000, 77000, 100, { framingOk: false });
  assert.equal(snap.flooded, false);
  assert.equal(snap.elevatedMs, 0);
});

test('unstable samples pause the same way low confidence does', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  run(det, 61000, 70000, 100);
  const snap = run(det, 71000, 74000, 100, { stable: false });
  assert.equal(snap.paused, true);
  assert.equal(snap.pauseReason, 'unstable');
  assert.equal(snap.elevatedMs, 10000);
  assert.equal(snap.flooded, false);
});

test('hysteresis keeps the cue through a brief dip and clears after 10 calm seconds', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  let snap = run(det, 61000, 80000, 100);
  assert.equal(snap.flooded, true);

  // Release needs under 96-5 and under 70+15-5 (=80), so under 80.
  snap = run(det, 81000, 89000, 72);
  assert.equal(snap.flooded, true);

  snap = det.push(good(90000, 72));
  assert.equal(snap.flooded, false);

  const det2 = createFloodingDetector();
  run(det2, 0, 60000, 70);
  run(det2, 61000, 80000, 100);
  run(det2, 81000, 85000, 72);
  snap = det2.push(good(86000, 100));
  assert.equal(snap.flooded, true);
  assert.equal(snap.clearMs, 0);
});

test('a multi-second hole does not count as time above the line', () => {
  const det = createFloodingDetector();
  run(det, 0, 60000, 70);
  run(det, 61000, 75000, 100);
  const snap = det.push(good(80000, 100));
  assert.equal(snap.flooded, false);
  assert.equal(snap.elevatedMs, 0);
});

test('chest not visible does not pause pulse; darkness does', () => {
  assert.equal(framingPausesPulse(VALIDATION.OK), false);
  assert.equal(framingPausesPulse(VALIDATION.CHEST_NOT_VISIBLE), false);
  assert.equal(framingPausesPulse(VALIDATION.TOO_DARK), true);
  assert.equal(framingPausesPulse(VALIDATION.NO_FACE), true);
  assert.equal(framingPausesPulse(null), true);
});

test('the heated practice trace crosses the cue and the calm one does not', () => {
  const heated = createFloodingDetector();
  let last;
  for (const sample of buildTrace('heated', { baselineMs: 60000, sustainMs: 20000, warmupMs: 0 })) {
    last = heated.push(sample);
  }
  assert.equal(last.flooded, true);
  assert.ok(last.baseline < 96);

  const calm = createFloodingDetector();
  for (const sample of buildTrace('calm', { baselineMs: 60000, sustainMs: 20000, warmupMs: 0 })) {
    last = calm.push(sample);
  }
  assert.equal(last.flooded, false);
  assert.equal(last.phase, 'listening');
  assert.ok(Math.abs(last.baseline - 71) < 0.01);
});

test('warmup samples with zero confidence do not fill the baseline', () => {
  const det = createFloodingDetector();
  const trace = buildTrace('calm', { baselineMs: 60000, sustainMs: 20000, warmupMs: 12000 });
  let last;
  for (const sample of trace) {
    if (sample.tMs >= 12000) break;
    last = det.push(sample);
  }
  assert.equal(last.phase, 'baselining');
  assert.equal(last.baselineMs, 0);
});

test('a 15 second baseline pause restarts with reason pause, not a high median', () => {
  const det = createFloodingDetector();
  run(det, 0, 30000, 70);
  let snap;
  let reason = null;
  let rejected = null;
  for (let t = 31000; t <= 50000; t += 1000) {
    snap = det.push(good(t, 70, { framingOk: false }));
    if (snap.restartedBaseline) {
      reason = snap.restartReason;
      rejected = snap.lastRejectedMedian;
    }
  }
  assert.equal(reason, 'pause');
  assert.equal(rejected, null);
  assert.equal(snap.lastRejectedMedian, null);
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.baseline, null);
});

test('a 4 second hole in the calm minute restarts with reason gap, not a high median', () => {
  const det = createFloodingDetector();
  run(det, 0, 20000, 70);
  const snap = det.push(good(25000, 70));
  assert.equal(snap.restartedBaseline, true);
  assert.equal(snap.restartReason, 'gap');
  assert.equal(snap.lastRejectedMedian, null);
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.baseline, null);
});

test('acceptBaseline keeps a rejected high minute and moves to listening', () => {
  const det = createFloodingDetector();
  const rejected = run(det, 0, 60000, 100);
  assert.equal(rejected.restartReason, 'high');
  assert.equal(rejected.lastRejectedMedian, 100);
  const snap = det.acceptBaseline();
  assert.equal(snap.phase, 'listening');
  assert.equal(snap.baseline, 100);
  assert.equal(snap.restartedBaseline, false);
  assert.equal(snap.restartReason, null);
  assert.equal(snap.lastRejectedMedian, null);
});

test('acceptBaseline without a rejected median stays in baselining', () => {
  const det = createFloodingDetector();
  run(det, 0, 20000, 70);
  const snap = det.acceptBaseline();
  assert.equal(snap.phase, 'baselining');
  assert.equal(snap.baseline, null);
});
