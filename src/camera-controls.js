'use strict';

// The renderer SDK locks exposure, white balance, and focus to manual once
// processing is Running, and it does not put them back.
// https://github.com/Presage-Security/SmartSpectra/issues/19
// On a Mac, applyConstraints for exposureMode can reject. That must not abort
// the measurement. Each control is attempted on its own, and nothing here throws.

const CONTINUOUS_KEYS = ['exposureMode', 'whiteBalanceMode', 'focusMode'];

async function restoreContinuousCamera(track) {
  try {
    if (!track || track.readyState !== 'live' || typeof track.applyConstraints !== 'function') {
      return false;
    }
    let caps = {};
    try {
      if (typeof track.getCapabilities === 'function') caps = track.getCapabilities() || {};
    } catch {
      caps = {};
    }
    let applied = false;
    for (const key of CONTINUOUS_KEYS) {
      const modes = caps[key];
      if (!Array.isArray(modes) || !modes.includes('continuous')) continue;
      try {
        await track.applyConstraints({ advanced: [{ [key]: 'continuous' }] });
        applied = true;
      } catch (err) {
        console.warn('[twenty] camera control skipped:', key, err && err.message ? err.message : '');
      }
    }
    return applied;
  } catch (err) {
    console.warn('[twenty] could not restore automatic camera controls:', err && err.message ? err.message : '');
    return false;
  }
}

module.exports = { restoreContinuousCamera, CONTINUOUS_KEYS };
