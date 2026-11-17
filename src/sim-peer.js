'use strict';

const { createFloodingDetector } = require('./flooding');
const { buildTrace } = require('./traces');

// A second participant that exists only on this computer. It speaks the same
// room protocol as a person: join, then break / ready. It never sends a pulse.

function startSimulatedPeer(options) {
  const timings = options.timings;
  const detector = createFloodingDetector({
    baselineMs: timings.baselineMs,
    sustainMs: timings.sustainMs,
  });
  const warmupMs = timings.baselineMs >= 60000 ? 12000 : 0;
  const trace = buildTrace(options.kind === 'calm' ? 'calm' : 'heated', {
    baselineMs: timings.baselineMs,
    sustainMs: timings.sustainMs,
    warmupMs,
  });
  const clientId = `simpeer-${Math.random().toString(36).slice(2, 12)}`;
  let ws = null;
  let timer = null;
  let index = 0;
  let sentBreak = false;

  function send(message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  ws = new WebSocket(options.url);
  ws.addEventListener('open', () => {
    send({ v: 1, type: 'join', room: options.room, clientId });
    timer = setInterval(() => {
      if (index >= trace.length) return;
      const sample = trace[index];
      index += 1;
      const result = detector.push(sample);
      if (result.flooded && !sentBreak) {
        sentBreak = true;
        send({ v: 1, type: 'break', on: true });
      }
    }, 1000);
  });

  return {
    markReady() {
      send({ v: 1, type: 'ready', on: true });
    },
    stop() {
      clearInterval(timer);
      if (ws) ws.close();
    },
  };
}

module.exports = { startSimulatedPeer };
