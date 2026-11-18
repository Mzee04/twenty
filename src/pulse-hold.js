'use strict';

// The SDK sends many metrics updates that carry only breathing data. Those
// updates have no pulse in them, which is not the same as "no pulse found".
// Hold the last real pulse for a short while so a breathing-only update does
// not pause the calm reference. Pulse is already a 12-second average, so a
// 3-second hold does not invent anything new.
const DEFAULT_HOLD_MS = 3000;

function createPulseHold(holdMs = DEFAULT_HOLD_MS) {
  let held = null;
  return function fill(reading) {
    if (typeof reading.pulse === 'number') {
      held = {
        tMs: reading.tMs,
        pulse: reading.pulse,
        confidence: reading.confidence,
        stable: reading.stable,
      };
      return reading;
    }
    if (held && reading.tMs - held.tMs <= holdMs) {
      return {
        ...reading,
        pulse: held.pulse,
        confidence: held.confidence,
        stable: held.stable,
        pulseHeld: true,
      };
    }
    return reading;
  };
}

module.exports = { createPulseHold, DEFAULT_HOLD_MS };
