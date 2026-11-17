'use strict';

// Plain-language explanations for SmartSpectra error codes.
// Numbers match the Node API reference (stable across SDK versions).
// https://github.com/Presage-Security/SmartSpectra/issues/18 — intermittent
// usage-verification failures surface as kNetworkError (5), retryable.

const CODE = Object.freeze({
  AUTH: 2,
  CONFIG: 3,
  CREDITS: 4,
  NETWORK: 5,
  SERVER: 6,
  INPUT: 7,
  NON_MONOTONIC: 10,
  NOT_AUTHORIZED: 13,
  LOW_FRAME_RATE: 14,
});

function explainSdkError(code, message, retryable) {
  const text = String(message || '');
  const lower = text.toLowerCase();

  if (
    code === CODE.NOT_AUTHORIZED
    || lower.includes('device keys')
    || lower.includes('arterial_pressure')
    || lower.includes('not authorized')
    || lower.includes('not authorised')
  ) {
    return {
      kind: 'cardio',
      retryable: false,
      text: 'This API key cannot read pulse. Twenty can still time a breathing guide and take a manual timeout. The automatic pause needs pulse.',
    };
  }

  if (code === CODE.NETWORK || lower.includes('usage verification') || lower.includes('status code: 0')) {
    return {
      kind: 'network',
      retryable: true,
      text: 'Presage could not confirm the API key just now. This is a known intermittent network check, and nothing was measured. Check the connection and try again.',
    };
  }

  if (code === CODE.AUTH || lower.includes('authentication failed')) {
    return {
      kind: 'auth',
      retryable: false,
      text: 'The API key was rejected. Check SMARTSPECTRA_API_KEY in .env, then try again.',
    };
  }

  if (code === CODE.CREDITS || lower.includes('credit')) {
    return {
      kind: 'credits',
      retryable: false,
      text: 'The Presage trial has no measurement credits left. A manual timeout still works. Presage asks people who hit the limit to write to them on Discord.',
    };
  }

  if (code === CODE.LOW_FRAME_RATE) {
    return {
      kind: 'frame-rate',
      retryable: false,
      text: 'The camera slowed down, often because the room is dim. Brighten the face and start the camera again. Twenty will not restart it on its own.',
    };
  }

  if (code === CODE.NON_MONOTONIC) {
    return {
      kind: 'clock',
      retryable: true,
      text: 'The camera clock jumped. Stop the camera and start it again.',
    };
  }

  if (code === CODE.INPUT) {
    return {
      kind: 'camera',
      retryable: true,
      text: 'The camera is not available. Close anything else using it, then try again.',
    };
  }

  if (code === CODE.SERVER) {
    return {
      kind: 'server',
      retryable: true,
      text: 'Presage did not accept the key check. Nothing was measured. Try again in a moment.',
    };
  }

  return {
    kind: 'other',
    retryable: Boolean(retryable),
    text: text || 'The measurement stopped before it could read a pulse.',
  };
}

module.exports = {
  CODE,
  explainSdkError,
};
