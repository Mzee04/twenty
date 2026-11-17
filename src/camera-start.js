'use strict';

// Camera open settings and error text. Kept free of the SDK so tests can run
// without a camera. Nothing here prints an API key.

const PREFERRED_CONSTRAINTS = Object.freeze({
  audio: false,
  video: Object.freeze({
    facingMode: 'user',
    width: Object.freeze({ ideal: 1280 }),
    height: Object.freeze({ ideal: 720 }),
    frameRate: Object.freeze({ ideal: 30 }),
  }),
});

const FALLBACK_CONSTRAINTS = Object.freeze({
  audio: false,
  video: true,
});

function preferredVideoConstraints() {
  return PREFERRED_CONSTRAINTS;
}

function fallbackVideoConstraints() {
  return FALLBACK_CONSTRAINTS;
}

function isOverconstrained(err) {
  const name = err && err.name;
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError';
}

function redact(text, secret) {
  let out = text == null ? '' : String(text);
  const key = secret == null ? '' : String(secret);
  if (key.length >= 6) out = out.split(key).join('[redacted]');
  return out;
}

async function openCamera(getUserMedia) {
  try {
    return await getUserMedia(preferredVideoConstraints());
  } catch (err) {
    if (!isOverconstrained(err)) throw err;
    return await getUserMedia(fallbackVideoConstraints());
  }
}

function cameraFailureView(err) {
  const name = err && err.name ? String(err.name) : 'Error';
  const raw = err && err.message ? String(err.message) : 'No further detail';
  const message = raw.replace(/\s+/g, ' ').slice(0, 240);
  let lead = 'The camera did not start. You can still call a timeout.';
  if (err && err.explained && err.explained.text) {
    lead = err.explained.text;
  } else if (name === 'NotAllowedError' || name === 'SecurityError') {
    lead = 'The camera is blocked. Twenty cannot see a pulse. You can still call a timeout.';
  } else if (name === 'NotFoundError') {
    lead = 'No camera was found. You can still call a timeout.';
  } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    lead = 'This camera rejected the picture settings. You can still call a timeout.';
  } else if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    lead = 'The camera turned on and then stopped. Close other apps using it, then try again. You can still call a timeout.';
  }
  return { lead, detail: `${name}: ${message}` };
}

function formatCameraFailureLog(err, secret) {
  const name = redact(err && err.name, secret);
  const code = redact(err && err.code, secret);
  const message = redact(err && err.message, secret);
  const stack = redact(err && err.stack, secret);
  return `[twenty] camera start failed name=${name} code=${code} message=${message} stack=${stack}`;
}

function formatConsoleMessage(eventOrLevel, message, line, sourceId) {
  if (eventOrLevel && typeof eventOrLevel === 'object' && typeof eventOrLevel.message === 'string') {
    const level = eventOrLevel.level == null ? 'log' : eventOrLevel.level;
    const where = eventOrLevel.sourceId
      ? `${eventOrLevel.sourceId}:${eventOrLevel.lineNumber == null ? '' : eventOrLevel.lineNumber}`
      : '';
    return `[renderer ${level}] ${eventOrLevel.message}${where ? ` (${where})` : ''}`;
  }
  const labels = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' };
  const label = labels[eventOrLevel] || String(eventOrLevel == null ? 'log' : eventOrLevel);
  const where = sourceId ? `${sourceId}:${line == null ? '' : line}` : '';
  return `[renderer ${label}] ${message == null ? '' : message}${where ? ` (${where})` : ''}`;
}

module.exports = {
  preferredVideoConstraints,
  fallbackVideoConstraints,
  isOverconstrained,
  redact,
  openCamera,
  cameraFailureView,
  formatCameraFailureLog,
  formatConsoleMessage,
};
