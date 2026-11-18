'use strict';

// Pause cue from a local pulse estimate.
//
// Pulse, in the SmartSpectra model card, is a 12-second average, valid from
// 40 to 110 BPM. Breathing is a separate signal and is not used here, because
// talking (the whole point of a conversation) makes breathing unreliable while
// pulse still has a usable window.
//
// This is a wellness cue for a shared pause. It is not a diagnosis.

const DEFAULTS = Object.freeze({
  baselineMs: 60_000,
  sustainMs: 20_000,
  releaseMs: 10_000,
  // "Near 100": a few beats under the figure Gottman used for flooding.
  nearBpm: 96,
  // "Well above" the person's own calm minute.
  aboveBaselineBpm: 15,
  hysteresisBpm: 5,
  // SDK confidence is 0–100 and stays 0 until the 12-second pulse window fills.
  minConfidence: 60,
  minPulse: 40,
  maxPulse: 110,
  minBaselineSamples: 10,
  // Ignore a single late sample as if it covered a long stretch.
  maxCreditMs: 2500,
  // A hole longer than this is a gap: don't count it, and drop a half-built cue.
  maxGapMs: 4000,
  // Short framing/confidence drops pause the 20s clock. A long drop resets it.
  maxSustainPauseMs: 5000,
  // The calm minute has to be one stretch. A long interruption starts it over.
  maxBaselinePauseMs: 15000,
});

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function createFloodingDetector(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let phase = 'baselining';
  let lastT = null;
  let pauseMs = 0;
  let baselineSamples = [];
  let baselineAccumMs = 0;
  let baseline = null;
  let elevatedMs = 0;
  let clearMs = 0;
  let flooded = false;
  let paused = false;
  let pauseReason = null;
  let restartedBaseline = false;
  let restartReason = null;
  let lastRejectedMedian = null;

  function clearBaselineCollection() {
    baselineSamples = [];
    baselineAccumMs = 0;
    baseline = null;
    phase = 'baselining';
    elevatedMs = 0;
    clearMs = 0;
    flooded = false;
  }

  function snapshot() {
    return {
      phase,
      flooded,
      baseline,
      paused,
      pauseReason,
      restartedBaseline,
      restartReason,
      lastRejectedMedian,
      elevatedMs,
      baselineMs: baselineAccumMs,
      clearMs,
      sustainMs: opts.sustainMs,
      baselineTargetMs: opts.baselineMs,
    };
  }

  function usable(sample) {
    const pulse = sample.pulse;
    if (typeof pulse !== 'number' || !Number.isFinite(pulse)) return 'missing';
    if (pulse < opts.minPulse || pulse > opts.maxPulse) return 'range';
    if (sample.stable !== true) return 'unstable';
    if (typeof sample.confidence !== 'number' || sample.confidence < opts.minConfidence) {
      return 'confidence';
    }
    return null;
  }

  function isAbove(bpm) {
    return bpm >= opts.nearBpm || bpm >= baseline + opts.aboveBaselineBpm;
  }

  function isBelowRelease(bpm) {
    return bpm < opts.nearBpm - opts.hysteresisBpm
      && bpm < baseline + opts.aboveBaselineBpm - opts.hysteresisBpm;
  }

  function notePause(reason, dt) {
    paused = true;
    pauseReason = reason;
    pauseMs += dt;
    if (phase === 'listening' && !flooded && pauseMs > opts.maxSustainPauseMs) {
      elevatedMs = 0;
    }
    if (phase === 'baselining' && pauseMs > opts.maxBaselinePauseMs) {
      clearBaselineCollection();
      pauseMs = 0;
      restartReason = 'pause';
      return true;
    }
    return false;
  }

  function absorb(sample, dt) {
    const framingOk = sample.framingOk === true;
    const problem = framingOk ? usable(sample) : 'framing';
    if (problem) return notePause(problem, dt);

    const credit = Math.min(dt, opts.maxCreditMs);
    pauseMs = 0;
    paused = false;
    pauseReason = null;

    if (phase === 'baselining') {
      baselineSamples.push(sample.pulse);
      baselineAccumMs += credit;
      if (baselineAccumMs >= opts.baselineMs && baselineSamples.length >= opts.minBaselineSamples) {
        const med = median(baselineSamples);
        if (med >= opts.nearBpm) {
          // A minute that was already near 100 is not a calm reference.
          lastRejectedMedian = med;
          clearBaselineCollection();
          restartReason = 'high';
          return true;
        }
        baseline = med;
        phase = 'listening';
        elevatedMs = 0;
        clearMs = 0;
        flooded = false;
        lastRejectedMedian = null;
        restartReason = null;
      }
      return false;
    }

    if (flooded) {
      if (isBelowRelease(sample.pulse)) {
        clearMs += credit;
        if (clearMs >= opts.releaseMs) {
          flooded = false;
          clearMs = 0;
          elevatedMs = 0;
        }
      } else {
        clearMs = 0;
      }
      return false;
    }

    if (isAbove(sample.pulse)) {
      elevatedMs += credit;
      if (elevatedMs >= opts.sustainMs) flooded = true;
    } else {
      elevatedMs = 0;
    }
    return false;
  }

  function push(sample) {
    if (!sample || typeof sample.tMs !== 'number' || !Number.isFinite(sample.tMs)) {
      throw new TypeError('sample.tMs is required');
    }
    let restarted = false;
    const t = sample.tMs;

    if (lastT == null) {
      lastT = t;
      restarted = absorb(sample, 0);
      restartedBaseline = restarted;
      if (!restarted) restartReason = null;
      return snapshot();
    }

    let dt = t - lastT;
    lastT = t;
    if (dt < 0) {
      restartedBaseline = false;
      return snapshot();
    }
    if (dt > opts.maxGapMs) {
      pauseMs = 0;
      if (phase === 'baselining') {
        clearBaselineCollection();
        restarted = true;
        restartReason = 'gap';
      } else if (!flooded) {
        elevatedMs = 0;
        clearMs = 0;
      } else {
        clearMs = 0;
      }
      dt = 0;
    }
    if (absorb(sample, dt)) restarted = true;
    restartedBaseline = restarted;
    if (!restarted) restartReason = null;
    return snapshot();
  }

  function acceptBaseline(bpm) {
    const value = typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : lastRejectedMedian;
    if (typeof value !== 'number' || !Number.isFinite(value)) return snapshot();
    baseline = value;
    phase = 'listening';
    elevatedMs = 0;
    clearMs = 0;
    flooded = false;
    paused = false;
    pauseReason = null;
    pauseMs = 0;
    restartedBaseline = false;
    restartReason = null;
    lastRejectedMedian = null;
    return snapshot();
  }

  function reset() {
    phase = 'baselining';
    lastT = null;
    pauseMs = 0;
    clearBaselineCollection();
    paused = false;
    pauseReason = null;
    restartedBaseline = false;
    restartReason = null;
    lastRejectedMedian = null;
  }

  return { push, snapshot, reset, acceptBaseline, options: opts };
}

module.exports = {
  DEFAULTS,
  createFloodingDetector,
  median,
};
