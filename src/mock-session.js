'use strict';

// Practice signals for tests and for running the UI without an API key.
// The numbers are scripted. They are not a camera measurement.

function createMockSession(options) {
  const timings = options.timings || { baselineMs: 60000 };
  const warmup = timings.baselineMs >= 60000 ? 12000 : 0;
  let timer = null;
  let t = 0;

  return {
    async start() {
      if (timer) return;
      timer = setInterval(() => {
        const ready = t >= warmup;
        const breathReady = t >= warmup + 30000;
        options.onReading({
          tMs: t,
          pulse: 72,
          confidence: ready ? 86 : 0,
          stable: ready,
          framingOk: true,
          breathing: breathReady ? 14 : null,
          breathingConfidence: breathReady ? 80 : 0,
          breathingStable: breathReady,
          chestOk: true,
          hint: ready ? '' : 'Settling',
          validationCode: ready ? 0 : null,
          practice: true,
        });
        t += 1000;
      }, 1000);
    },
    async stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createMockSession };
