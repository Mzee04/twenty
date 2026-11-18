'use strict';

const { framingPausesPulse, chestOk } = require('./validation');
const { explainSdkError } = require('./sdk-errors');
const { restoreContinuousCamera } = require('./camera-controls');
const { openCamera } = require('./camera-start');
const { createPulseHold } = require('./pulse-hold');

function asNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function last(list) {
  if (!list || typeof list.length !== 'number' || list.length === 0) return null;
  return list[list.length - 1];
}

function looksDecoded(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(value)) {
    return false;
  }
  if (value instanceof Uint8Array && value.cardio == null && value.breathing == null) return false;
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrapSdkError(err, fallback) {
  const message = err && err.message ? String(err.message) : fallback;
  const wrapped = new Error(message);
  wrapped.name = err && err.name ? String(err.name) : 'Error';
  if (err && err.code !== undefined && err.code !== null) wrapped.code = err.code;
  if (err && err.stack) wrapped.stack = err.stack;
  wrapped.explained = explainSdkError(
    err && err.code !== undefined && err.code !== null ? err.code : undefined,
    message,
    err && err.retryable,
  );
  return wrapped;
}

function createLiveSession(options) {
  const { SmartSpectraSDK, breathingMetrics, cardioMetrics } = require('@smartspectra/node-sdk/renderer');
  const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

  let sdk = null;
  let stream = null;
  let stopped = false;
  let cardioRetried = false;
  let validation = { code: null, hint: '' };
  const holdPulse = createPulseHold();

  function emit(decoded) {
    const pulse = last(decoded && decoded.cardio && decoded.cardio.pulseRate);
    const breath = last(decoded && decoded.breathing && decoded.breathing.rate);
    options.onReading(holdPulse({
      tMs: Date.now(),
      pulse: asNumber(pulse && pulse.value),
      confidence: asNumber(pulse && pulse.confidence) ?? 0,
      stable: pulse ? pulse.stable === true : false,
      framingOk: !framingPausesPulse(validation.code),
      breathing: asNumber(breath && breath.value),
      breathingConfidence: asNumber(breath && breath.confidence) ?? 0,
      breathingStable: breath ? breath.stable === true : false,
      chestOk: chestOk(validation.code),
      hint: validation.hint || '',
      validationCode: validation.code,
      practice: false,
    }));
  }

  function build(breathingOnly) {
    // Telemetry stays off. Twenty never calls requestInsight, so no prompt
    // and no measured values are sent to an AI service. The SDK still contacts
    // Presage to check the API key. That check is not a vitals upload.
    sdk = new SmartSpectraSDK({
      apiKey: options.apiKey,
      requestedMetrics: breathingOnly
        ? [...breathingMetrics]
        : [...breathingMetrics, ...cardioMetrics],
      enableTelemetry: false,
      enableAccumulatedOutput: false,
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
      validation = { code, hint: hint || '' };
      if (options.onHint) options.onHint(validation);
    });
    sdk.on('metrics', (buf) => {
      try {
        const decoded = decodeMetrics(buf);
        if (looksDecoded(decoded)) emit(decoded);
      } catch (err) {
        options.onError(explainSdkError('decode', err && err.message, false));
      }
    });
    sdk.on('error', (code, message, retryable) => {
      options.onError(explainSdkError(code, message, retryable));
    });
  }

  async function release() {
    const track = stream && stream.getVideoTracks()[0];
    if (track) await restoreContinuousCamera(track);
    if (sdk) {
      try { await sdk.stop(); } catch { /* already stopped */ }
      try { sdk.destroy(); } catch { /* already destroyed */ }
      sdk = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (options.onCamera) options.onCamera(false);
    if (options.onStream) options.onStream(null);
  }

  async function start() {
    stopped = false;
    validation = { code: null, hint: '' };
    const getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
    stream = await openCamera(getUserMedia);
    if (options.onStream) options.onStream(stream);
    if (options.onCamera) options.onCamera(true);
    const track = stream.getVideoTracks()[0];
    // Undo a previous manual exposure lock before this session, then give
    // the camera a moment to settle. See SmartSpectra issue 19.
    // A Mac may reject exposureMode. That must not stop the session.
    await restoreContinuousCamera(track);
    await wait(400);
    if (stopped) {
      await release();
      return;
    }
    build(false);
    try {
      sdk.useMediaStream(stream);
    } catch (err) {
      await release();
      throw wrapSdkError(err, 'The measurement library rejected the camera.');
    }
    try {
      await sdk.start();
    } catch (err) {
      const explained = explainSdkError(
        err && err.code !== undefined && err.code !== null ? err.code : undefined,
        err && err.message,
        err && err.retryable,
      );
      if (!cardioRetried && explained.kind === 'cardio') {
        cardioRetried = true;
        try { sdk.destroy(); } catch { /* ignore */ }
        sdk = null;
        build(true);
        try {
          sdk.useMediaStream(stream);
          await sdk.start();
        } catch (err2) {
          await release();
          throw wrapSdkError(err2, 'start failed');
        }
        if (options.onNotice) options.onNotice('pulse-unavailable');
        return;
      }
      await release();
      throw wrapSdkError(err, 'start failed');
    }
  }

  async function stop() {
    stopped = true;
    await release();
  }

  return { start, stop };
}

module.exports = { createLiveSession };
