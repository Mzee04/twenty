'use strict';

const { createFloodingDetector } = require('./src/flooding');
const { generateRoomCode, normalizeRoomCode } = require('./src/protocol');
const { guideFromBreathing } = require('./src/pacer');
const { createMockSession } = require('./src/mock-session');
const { startSimulatedPeer } = require('./src/sim-peer');
const { availabilityFromConfig, homeKeyVisibility } = require('./src/home-key');
const { cameraFailureView, formatCameraFailureLog } = require('./src/camera-start');

const { createLiveSession } = process.env.TWENTY_PREVIEW
  ? require('./src/live-session-preview')
  : require('./src/live-session');

const $ = (id) => document.getElementById(id);

const state = {
  screen: 'consent',
  config: null,
  relayUrl: '',
  liveAvailable: false,
  practice: false,
  solo: false,
  partnerCalm: false,
  roomCode: '',
  clientId: '',
  peers: 0,
  youReady: false,
  otherReady: false,
  breakOn: false,
  breakEndsAt: null,
  cameraOn: false,
  reading: null,
  snap: null,
  note: '',
  banner: '',
  bannerDetail: '',
  bannerRetry: false,
  relayDown: false,
  pulseAvailable: true,
  timings: { baselineMs: 30000, sustainMs: 20000, shortened: false },
  detector: null,
  session: null,
  peer: null,
  ws: null,
  breakSent: false,
  editingKey: false,
  pacerStart: 0,
  guide: guideFromBreathing(null, 0),
  lastTitle: '',
};

function clientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `client-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(0, 32);
}

function readTimings(practice) {
  const params = new URLSearchParams(window.location.search);
  const baseline = Number(params.get('baseline'));
  const sustain = Number(params.get('sustain'));
  const shortened = practice
    && baseline >= 5 && baseline <= 30
    && sustain >= 3 && sustain <= 20;
  return {
    baselineMs: shortened ? baseline * 1000 : 30000,
    sustainMs: shortened ? sustain * 1000 : 20000,
    shortened,
  };
}

function relayLabel(url) {
  if (!url) return 'The room relay is not running.';
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (local) {
      return 'Rooms opened here stay on this computer. For two laptops, run a shared relay and set TWENTY_RELAY_URL. See the README.';
    }
    return `Rooms meet at ${parsed.host}. Only the room code and break or ready cross that connection.`;
  } catch {
    return 'The relay address could not be read.';
  }
}

function pulseVisible(reading) {
  if (!reading || state.breakOn) return false;
  if (reading.framingOk !== true || reading.stable !== true) return false;
  if (typeof reading.confidence !== 'number' || reading.confidence < 60) return false;
  if (typeof reading.pulse !== 'number') return false;
  return reading.pulse >= 40 && reading.pulse <= 110;
}

function phase() {
  if (state.screen !== 'room') return 'idle';
  if (state.breakOn) return 'break';
  if (!state.practice && !state.cameraOn) return 'camera-off';
  if (!state.snap || state.snap.phase === 'baselining') return 'baseline';
  if (state.snap.paused) return 'paused';
  return 'listening';
}

function formatRemaining(endsAt) {
  if (!endsAt) return '20:00';
  const total = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function announce(text) {
  if (!text || text === state.lastTitle) return;
  state.lastTitle = text;
  $('live').textContent = text;
}

function render() {
  const screen = state.screen;
  $('screen-consent').hidden = screen !== 'consent';
  $('screen-lobby').hidden = screen !== 'lobby';
  $('screen-room').hidden = screen !== 'room';
  document.body.classList.toggle('is-break', state.breakOn);

  const pill = $('camera-pill');
  pill.classList.toggle('is-on', state.cameraOn);
  $('camera-pill-text').textContent = state.cameraOn ? 'Camera on' : 'Camera off';
  $('stop-camera').hidden = !state.cameraOn;

  const current = phase();
  const dot = $('status-dot');
  dot.className = `dot dot-${current === 'camera-off' ? 'paused' : current}`;
  const labels = {
    idle: 'Here',
    baseline: 'Settling',
    listening: 'Listening',
    paused: 'Paused',
    'camera-off': 'Camera off',
    break: 'Break',
  };
  $('status-label').textContent = labels[current] || 'Here';

  const keyUi = homeKeyVisibility({
    screen,
    liveAvailable: state.liveAvailable,
    editingKey: state.editingKey,
  });
  $('key-box').hidden = keyUi.keyBoxHidden;
  $('remove-key').hidden = keyUi.removeHidden;
  $('change-key').hidden = keyUi.changeKeyHidden;

  if (screen === 'lobby') {
    $('relay-note').textContent = relayLabel(state.relayUrl);
    $('start-room').textContent = state.liveAvailable ? 'Start a room' : 'Start a practice room';
    $('solo').textContent = 'Solo demo';
  }

  if (screen !== 'room') return;

  $('room-code').textContent = state.roomCode || '····';
  const mode = [];
  if (state.solo) {
    mode.push(state.practice
      ? 'Solo demo. The other person is a simulated recording. Your numbers are practice signals too, because no API key is set. The camera is off.'
      : 'Solo demo. The other person is a simulated recording. Your camera is live, and your pulse stays on this computer.');
  } else if (state.practice) {
    mode.push('Practice room. These numbers are not a camera measurement, and the camera is off.');
  }
  if (state.timings.shortened) {
    mode.push('Practice timings are shortened on this page. The app itself uses a 30 second baseline, a 20 second cue, and a 20 minute pause.');
  }
  if (!state.pulseAvailable) {
    mode.push('This API key cannot read pulse. A manual timeout and the breathing guide still work.');
  }
  $('mode-banner').textContent = mode.join(' ');
  $('mode-banner').hidden = mode.length === 0;

  const peers = state.peers || 1;
  $('peer-line').textContent = peers < 2
    ? 'Just you in this room so far.'
    : 'Two people in this room.';

  const preview = $('preview');
  $('preview-fallback').hidden = state.cameraOn;
  preview.hidden = !state.cameraOn;

  const nowPhase = phase();
  let kicker = '';
  let title = '';
  let body = '';
  const snap = state.snap;

  if (nowPhase === 'break') {
    kicker = 'Twenty minutes';
    title = 'Someone needs a break';
    const both = state.youReady && state.otherReady;
    const left = state.breakEndsAt ? Math.max(0, state.breakEndsAt - Date.now()) : 1;
    if (both && left > 0) {
      body = 'You are both ready. This screen stays up until the twenty minutes have passed.';
    } else if (state.youReady && !state.otherReady) {
      body = peers < 2
        ? 'You are ready. The pause stays open until the time is up.'
        : 'You are ready. This screen stays up until the other person is ready too, and the twenty minutes have passed.';
    } else if (!state.youReady && state.otherReady && peers >= 2) {
      body = 'The other person is ready. Take the time you need, then say when you are.';
    } else {
      body = 'Take twenty minutes. You do not have to say who.';
    }
  } else if (nowPhase === 'camera-off') {
    kicker = 'Camera off';
    title = 'The camera is stopped';
    body = 'Nothing is being read. You can start it again, or call a timeout without it.';
  } else if (nowPhase === 'baseline') {
    kicker = 'A calm reference';
    title = 'A quiet moment, for you';
    const target = Math.round(state.timings.baselineMs / 1000);
    const seconds = snap ? Math.min(target, Math.round(snap.baselineMs / 1000)) : 0;
    body = state.timings.shortened
      ? `Practice baseline, ${seconds} of ${target} seconds. Talking is fine.`
      : 'Twenty is taking a calm pulse for you alone. Talking is fine. About 30 seconds. If the picture is unclear, it waits.';
    $('baseline-progress').hidden = false;
    $('baseline-progress').max = state.timings.baselineMs;
    $('baseline-progress').value = snap ? snap.baselineMs : 0;
  } else if (nowPhase === 'paused') {
    kicker = 'Waiting';
    title = 'The reading paused';
    body = (state.reading && state.reading.hint)
      || 'The camera needs a clearer view, or the pulse is not confident yet. The clock waits.';
    $('baseline-progress').hidden = !snap || snap.phase !== 'baselining';
  } else {
    kicker = 'In the room';
    title = 'You can talk';
    body = 'If a pulse stays high for about twenty seconds, both screens ask for a break, without saying whose. Or call one yourself.';
    $('baseline-progress').hidden = true;
  }

  if (nowPhase !== 'baseline') {
    if (nowPhase !== 'paused' || !snap || snap.phase !== 'baselining') {
      if (nowPhase !== 'baseline') $('baseline-progress').hidden = nowPhase !== 'paused' || !snap || snap.phase !== 'baselining';
    }
  }
  if (nowPhase !== 'baseline' && nowPhase !== 'paused') $('baseline-progress').hidden = true;
  if (nowPhase === 'baseline') $('baseline-progress').hidden = false;

  $('phase-kicker').textContent = kicker;
  $('phase-title').textContent = title;
  $('phase-body').textContent = body;
  $('note').textContent = state.note || '';
  $('note').hidden = !state.note;

  const showNumber = pulseVisible(state.reading);
  $('pulse-readout').hidden = nowPhase === 'break';
  $('pulse-value').textContent = showNumber ? String(Math.round(state.reading.pulse)) : '—';
  $('pulse-caption').textContent = state.practice
    ? 'Practice beats per minute. Stays on this computer. Not a measurement.'
    : 'Your estimate, beats per minute. Stays on this computer.';

  const hint = state.reading && state.reading.hint && nowPhase !== 'break' ? state.reading.hint : '';
  $('hint').textContent = hint;
  $('hint').hidden = !hint;

  $('pacer').hidden = nowPhase !== 'break';
  $('timer').textContent = formatRemaining(state.breakEndsAt);
  $('pacer-caption').textContent = state.guide.source === 'breathing'
    ? 'Following your breathing, a little slower.'
    : 'A steady pace, about six breaths a minute.';

  $('timeout').hidden = nowPhase === 'break';
  const offerAccept = nowPhase === 'baseline' && snap && snap.lastRejectedMedian != null;
  $('accept-baseline').hidden = !offerAccept;
  $('start-again').hidden = nowPhase !== 'baseline' && nowPhase !== 'paused';
  $('ready').hidden = nowPhase !== 'break';
  $('ready').textContent = state.youReady ? 'Not yet' : "I'm ready";
  $('ready').setAttribute('aria-pressed', state.youReady ? 'true' : 'false');
  $('partner-ready').hidden = !(state.solo && nowPhase === 'break');
  $('start-camera').hidden = state.practice || state.cameraOn || nowPhase === 'break';

  $('banner').hidden = !state.banner;
  $('banner').textContent = state.banner || '';
  $('banner-detail').hidden = !state.bannerDetail;
  $('banner-detail').textContent = state.bannerDetail ? `Details: ${state.bannerDetail}` : '';
  $('retry').hidden = !state.bannerRetry;

  announce(title);
}

function send(message) {
  if (!state.ws || state.ws.readyState !== 1) {
    state.relayDown = true;
    state.banner = 'The room relay is not connected. A timeout on this computer will not reach anyone else.';
    state.bannerDetail = '';
    render();
    return;
  }
  state.ws.send(JSON.stringify(message));
}

function connectRelay() {
  if (state.ws && state.ws.readyState === 1) return Promise.resolve(state.ws);
  if (!state.relayUrl) return Promise.reject(new Error('no relay'));
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(state.relayUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, 4000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      state.ws = ws;
      state.relayDown = false;
      resolve(ws);
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'state') applyState(msg);
      if (msg.type === 'error') applyRelayError(msg.error);
    });
    ws.addEventListener('close', () => {
      if (state.ws === ws) {
        state.ws = null;
        state.relayDown = true;
        if (state.screen === 'room') {
          state.banner = 'The room connection closed.';
          state.bannerDetail = '';
          render();
        }
      }
    });
    ws.addEventListener('error', () => {});
  });
}

function applyRelayError(error) {
  if (error === 'room_full') {
    state.banner = 'That room already has two people.';
    state.bannerDetail = '';
  } else if (error === 'bad_room') {
    state.banner = 'That code should be four letters or numbers.';
    state.bannerDetail = '';
  } else if (error === 'forbidden') {
    state.banner = 'The room refused a message it does not carry.';
    state.bannerDetail = '';
  } else {
    state.banner = 'The room could not take that message.';
    state.bannerDetail = '';
  }
  render();
}

function applyState(msg) {
  const wasBreak = state.breakOn;
  state.breakOn = msg.break === true;
  state.youReady = msg.youReady === true;
  state.otherReady = msg.otherReady === true;
  state.peers = msg.peers || 0;
  state.breakEndsAt = msg.breakEndsAt || null;
  if (msg.room) state.roomCode = msg.room;
  if (state.breakOn && !wasBreak) {
    state.pacerStart = performance.now();
    state.guide = guideFromBreathing(null, 0);
    state.breakSent = true;
  }
  if (!state.breakOn && wasBreak) {
    state.breakSent = false;
    state.note = '';
    if (state.detector) state.detector.reset();
    state.snap = state.detector ? state.detector.snapshot() : null;
  }
  render();
}

function refreshGuide() {
  const reading = state.reading;
  const canUse = state.breakOn && reading && reading.chestOk && (state.cameraOn || state.practice);
  const next = canUse
    ? guideFromBreathing(reading.breathing, reading.breathingConfidence)
    : guideFromBreathing(null, 0);
  state.guide = next;
}

function onReading(reading) {
  state.reading = reading;
  if (state.breakOn) {
    refreshGuide();
    render();
    return;
  }
  if (!state.detector) return;
  const snap = state.detector.push({
    tMs: reading.tMs,
    pulse: reading.pulse,
    confidence: reading.confidence,
    stable: reading.stable,
    framingOk: reading.framingOk,
  });
  state.snap = snap;
  if (snap.restartedBaseline) {
    if (snap.restartReason === 'high') {
      const bpm = snap.lastRejectedMedian != null ? Math.round(snap.lastRejectedMedian) : null;
      state.note = bpm
        ? `That minute sat around ${bpm} BPM, which Twenty treats as already high (96 or above), so it was not kept as a calm reference. You can use this minute anyway, start again, or call a timeout.`
        : 'That minute was already quite high, so it was not kept as a calm reference. You can use this minute anyway, start again, or call a timeout.';
    } else if (snap.restartReason === 'gap' || snap.restartReason === 'pause') {
      state.note = 'The calm minute was interrupted, so it is starting over. You can call a timeout any time.';
    }
  } else if (snap.phase === 'listening') {
    state.note = '';
  }
  if (snap.flooded && !state.breakSent) {
    state.breakSent = true;
    send({ v: 1, type: 'break', on: true });
  }
  render();
}

async function startMeasurement() {
  state.banner = '';
  state.bannerDetail = '';
  state.bannerRetry = false;
  if (state.session) await state.session.stop();
  if (state.practice || !state.liveAvailable) {
    state.practice = true;
    state.session = createMockSession({ timings: state.timings, onReading });
    state.cameraOn = false;
    await state.session.start();
    render();
    return;
  }
  state.session = createLiveSession({
    apiKey: state.config.apiKey,
    onReading,
    onCamera(on) {
      state.cameraOn = on;
      render();
    },
    onStream(stream) {
      const video = $('preview');
      video.srcObject = stream || null;
      if (stream) video.play().catch(() => {});
    },
    onError(explained) {
      state.banner = explained.text;
      state.bannerDetail = '';
      state.bannerRetry = explained.retryable === true;
      render();
    },
    onNotice(kind) {
      if (kind === 'pulse-unavailable') state.pulseAvailable = false;
      render();
    },
  });
  try {
    await state.session.start();
  } catch (err) {
    state.cameraOn = false;
    const secret = state.config && state.config.apiKey;
    console.error(formatCameraFailureLog(err, secret));
    const view = cameraFailureView(err);
    state.banner = view.lead;
    state.bannerDetail = view.detail;
    state.bannerRetry = Boolean(err && err.explained && (err.explained.retryable || err.explained.kind === 'frame-rate'));
  }
  render();
}

async function enterRoom({ solo, code }) {
  const room = code || generateRoomCode();
  state.solo = solo;
  state.practice = !state.liveAvailable;
  state.roomCode = room;
  state.clientId = clientId();
  state.screen = 'room';
  state.breakOn = false;
  state.breakSent = false;
  state.youReady = false;
  state.otherReady = false;
  state.peers = 0;
  state.note = '';
  state.banner = '';
  state.bannerDetail = '';
  state.reading = null;
  state.pulseAvailable = true;
  state.timings = readTimings(state.practice || Boolean(state.config && state.config.preview));
  state.detector = createFloodingDetector({
    baselineMs: state.timings.baselineMs,
    sustainMs: state.timings.sustainMs,
  });
  state.snap = state.detector.snapshot();
  render();

  try {
    await connectRelay();
  } catch {
    state.banner = 'Could not reach the room relay. Check that Twenty is running, or set TWENTY_RELAY_URL.';
    state.bannerDetail = '';
    render();
    return;
  }
  send({ v: 1, type: 'join', room, clientId: state.clientId });
  if (solo) {
    state.peer = startSimulatedPeer({
      url: state.relayUrl,
      room,
      kind: state.partnerCalm ? 'calm' : 'heated',
      timings: state.timings,
    });
  }
  await startMeasurement();
}

async function leaveRoom() {
  if (state.peer) state.peer.stop();
  state.peer = null;
  if (state.session) await state.session.stop();
  state.session = null;
  if (state.ws) state.ws.close();
  state.ws = null;
  state.cameraOn = false;
  $('preview').srcObject = null;
  state.screen = 'lobby';
  state.breakOn = false;
  state.reading = null;
  state.detector = null;
  state.banner = '';
  state.bannerDetail = '';
  render();
}

function tickPacer(now) {
  const orb = $('pacer-orb');
  if (state.breakOn && state.pacerStart) {
    const guide = state.guide;
    const elapsed = (now - state.pacerStart) % guide.cycleMs;
    const inhaling = elapsed < guide.inhaleMs;
    const u = inhaling
      ? elapsed / guide.inhaleMs
      : (elapsed - guide.inhaleMs) / Math.max(1, guide.exhaleMs);
    const eased = u * u * (3 - 2 * u);
    const scale = inhaling ? 0.86 + 0.22 * eased : 1.08 - 0.22 * eased;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    orb.style.transform = reduce ? 'none' : `scale(${scale.toFixed(3)})`;
    orb.style.opacity = reduce ? String(0.55 + 0.45 * (inhaling ? eased : 1 - eased)) : '1';
    $('pacer-label').textContent = inhaling ? 'In' : 'Out';
  }
  requestAnimationFrame(tickPacer);
}

function applyConfig(config) {
  state.config = config;
  state.relayUrl = config.relayUrl || '';
  state.liveAvailable = availabilityFromConfig(config).liveAvailable;
  $('key-line').textContent = state.liveAvailable
    ? 'An API key is loaded on this computer. It is not shown here.'
    : 'No API key is loaded. You can still walk the screens with practice signals, or paste a key on the next screen. The key is not shown again.';
}

async function boot() {
  let config = {
    apiKey: '',
    relayUrl: 'ws://127.0.0.1:47221',
    forceMock: true,
    telemetryDisabled: true,
    preview: true,
  };
  if (window.twenty && window.twenty.getConfig) {
    try {
      config = await window.twenty.getConfig();
    } catch {
      config.relayUrl = '';
    }
  }
  applyConfig(config);
  render();
}

$('agree').addEventListener('click', () => {
  state.screen = 'lobby';
  render();
});

$('save-key').addEventListener('click', async () => {
  const input = $('api-key');
  const value = input.value.trim();
  if (!value) return;
  if (!window.twenty || !window.twenty.saveKey) {
    $('key-save-note').textContent = 'This window cannot save a key yet. Quit Twenty and start it again.';
    return;
  }
  const result = await window.twenty.saveKey(value);
  if (!result || !result.ok) {
    $('key-save-note').textContent = 'The key was not saved.';
    return;
  }
  input.value = '';
  state.editingKey = false;
  const config = await window.twenty.getConfig();
  applyConfig(config);
  $('key-save-note').textContent = state.liveAvailable
    ? 'Key saved. Your camera will be live.'
    : 'Key saved on this computer. It is not shown here.';
  render();
});

$('change-key').addEventListener('click', () => {
  state.editingKey = true;
  $('key-save-note').textContent = 'Paste a different key. The old one stays until this save succeeds.';
  render();
});

$('remove-key').addEventListener('click', async () => {
  if (!window.twenty || !window.twenty.clearSavedKey) return;
  const result = await window.twenty.clearSavedKey();
  state.editingKey = false;
  const config = await window.twenty.getConfig();
  applyConfig(config);
  $('key-save-note').textContent = result && result.hasKey
    ? 'The key saved by the app was removed. A key is still loaded from a file on this computer. It is not shown here.'
    : 'The saved key was removed.';
  render();
});

$('start-room').addEventListener('click', () => {
  enterRoom({ solo: false });
});

$('join-room').addEventListener('click', () => {
  const code = normalizeRoomCode($('code-input').value);
  if (!code) {
    state.banner = 'Enter the four-character code from the other screen.';
    $('join-error').textContent = state.banner;
    return;
  }
  $('join-error').textContent = '';
  enterRoom({ solo: false, code });
});

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('join-room').click();
});

$('solo').addEventListener('click', () => {
  state.partnerCalm = $('partner-calm').checked;
  enterRoom({ solo: true });
});

$('copy-code').addEventListener('click', async () => {
  const text = state.roomCode;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
  } catch { /* the code is still on screen */ }
  $('copy-code').textContent = 'Copied';
  setTimeout(() => { $('copy-code').textContent = 'Copy code'; }, 1500);
});

$('leave').addEventListener('click', () => { leaveRoom(); });
$('timeout').addEventListener('click', () => {
  if (state.breakOn || state.breakSent) return;
  state.breakSent = true;
  send({ v: 1, type: 'break', on: true });
});
$('accept-baseline').addEventListener('click', () => {
  if (!state.detector) return;
  state.snap = state.detector.acceptBaseline();
  state.note = '';
  render();
});
$('start-again').addEventListener('click', () => {
  if (!state.detector) return;
  state.detector.reset();
  state.snap = state.detector.snapshot();
  state.note = '';
  render();
});
$('ready').addEventListener('click', () => {
  send({ v: 1, type: 'ready', on: !state.youReady });
});
$('partner-ready').addEventListener('click', () => {
  if (state.peer) state.peer.markReady();
});
$('stop-camera').addEventListener('click', async () => {
  if (state.session) await state.session.stop();
  state.cameraOn = false;
  $('preview').srcObject = null;
  render();
});
$('start-camera').addEventListener('click', () => { startMeasurement(); });
$('retry').addEventListener('click', () => { startMeasurement(); });

window.addEventListener('beforeunload', () => {
  if (state.session) state.session.stop();
  if (state.peer) state.peer.stop();
});

setInterval(() => {
  if (state.breakOn) render();
}, 500);

requestAnimationFrame(tickPacer);
boot();
