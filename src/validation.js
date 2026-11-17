'use strict';

// SmartSpectra ValidationCode values. Chest-not-visible matters for breathing,
// not for pulse, so it does not pause the pause-cue clock.
// https://smartspectra.presagetech.com/docs/measurement-quality

const VALIDATION = Object.freeze({
  OK: 0,
  NO_FACE: 1,
  MULTIPLE_FACES: 2,
  FACE_NOT_CENTERED: 3,
  FACE_SIZE_OUT_OF_RANGE: 4,
  TOO_DARK: 5,
  TOO_BRIGHT: 6,
  CHEST_NOT_VISIBLE: 7,
  CAMERA_TUNING: 10,
  FRAME_RATE_TOO_LOW: 11,
  EXCESSIVE_MOTION: 12,
  FACE_TOO_CLOSE: 13,
  FACE_TOO_FAR: 14,
  FACE_TOO_HIGH: 15,
  FACE_TOO_LOW: 16,
  FACE_NOT_FORWARD: 17,
});

const PULSE_PAUSE = new Set([
  VALIDATION.NO_FACE,
  VALIDATION.MULTIPLE_FACES,
  VALIDATION.FACE_NOT_CENTERED,
  VALIDATION.FACE_SIZE_OUT_OF_RANGE,
  VALIDATION.TOO_DARK,
  VALIDATION.TOO_BRIGHT,
  VALIDATION.CAMERA_TUNING,
  VALIDATION.FRAME_RATE_TOO_LOW,
  VALIDATION.EXCESSIVE_MOTION,
  VALIDATION.FACE_TOO_CLOSE,
  VALIDATION.FACE_TOO_FAR,
  VALIDATION.FACE_TOO_HIGH,
  VALIDATION.FACE_TOO_LOW,
  VALIDATION.FACE_NOT_FORWARD,
]);

function framingPausesPulse(code) {
  if (code == null) return true;
  return PULSE_PAUSE.has(code);
}

function chestOk(code) {
  return code !== VALIDATION.CHEST_NOT_VISIBLE;
}

module.exports = {
  VALIDATION,
  framingPausesPulse,
  chestOk,
};
