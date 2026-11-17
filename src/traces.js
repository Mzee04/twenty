'use strict';

// Recorded practice traces for the simulated peer. These are generated
// numbers, not a recording of a person. The heated trace stays calm long
// enough for a baseline, then rises to about 104 and holds.

function buildTrace(kind, options = {}) {
  const baselineMs = options.baselineMs ?? 60_000;
  const sustainMs = options.sustainMs ?? 20_000;
  const warmupMs = options.warmupMs ?? 0;
  const step = 1000;
  const calmEnd = warmupMs + baselineMs + 2000;
  const riseMs = 8000;
  const holdMs = sustainMs + 5000;
  const total = kind === 'heated' ? calmEnd + riseMs + holdMs : calmEnd + sustainMs;
  const samples = [];

  for (let t = 0; t <= total; t += step) {
    let pulse = 71;
    if (kind === 'heated' && t > calmEnd) {
      const u = Math.min(1, (t - calmEnd) / riseMs);
      pulse = 71 + (104 - 71) * u;
    }
    const warmed = t >= warmupMs;
    samples.push({
      tMs: t,
      pulse: Math.round(pulse * 10) / 10,
      confidence: warmed ? 90 : 0,
      stable: warmed,
      framingOk: true,
    });
  }
  return samples;
}

module.exports = { buildTrace };
