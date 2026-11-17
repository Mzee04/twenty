'use strict';

// A breathing guide for the quiet pause.
// Breathing rate from the SDK is a 30-second average, valid from 5 to 40
// breaths/min, and is not trustworthy while someone is talking. Callers
// should only pass a reading taken during the pause.
// When a confident rate is present, the guide sits a little slower than that
// rate, clamped to a gentle band. Otherwise it uses six breaths a minute.

const DEFAULT_BPM = 6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function guideFromBreathing(rate, confidence, options = {}) {
  const minConfidence = options.minConfidence ?? 60;
  const minRate = options.minRate ?? 5;
  const maxRate = options.maxRate ?? 40;
  const usable = typeof rate === 'number'
    && Number.isFinite(rate)
    && rate >= minRate
    && rate <= maxRate
    && typeof confidence === 'number'
    && confidence >= minConfidence;

  const bpm = usable ? clamp(rate * 0.9, 6, 12) : DEFAULT_BPM;
  const cycleMs = 60000 / bpm;
  const inhaleMs = cycleMs * 0.4;
  const exhaleMs = cycleMs - inhaleMs;
  return {
    bpm,
    source: usable ? 'breathing' : 'default',
    cycleMs,
    inhaleMs,
    exhaleMs,
  };
}

module.exports = {
  DEFAULT_BPM,
  guideFromBreathing,
};
