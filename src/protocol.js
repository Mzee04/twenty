'use strict';

// Room protocol. The only things that cross the network are a room code,
// a random client id (so the relay can tell two sockets apart), and two
// booleans: break, and ready. Pulse, breathing, names, and "who" are rejected.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BREAK_MS = 20 * 60 * 1000;

const PUBLIC_STATE_KEYS = Object.freeze([
  'v',
  'type',
  'room',
  'break',
  'youReady',
  'otherReady',
  'peers',
  'breakEndsAt',
]);

const FORBIDDEN = /pulse|bpm|breath|vital|heart|baseline|confidence|video|frame|who|hrv|ecg|emotion|stress|diagnos/i;

function generateRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return code;
}

function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  if (code.length !== 4) return null;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return code;
}

function forbiddenKey(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) return key;
    const found = forbiddenKey(inner);
    if (found) return found;
  }
  return null;
}

function exactKeys(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length) return false;
  return allowed.every((key) => keys.includes(key));
}

function parseClientMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'bad_message' };
  }
  if (forbiddenKey(input)) return { ok: false, error: 'forbidden' };
  if (input.v !== 1 || typeof input.type !== 'string') {
    return { ok: false, error: 'bad_message' };
  }

  if (input.type === 'join') {
    if (!exactKeys(input, ['v', 'type', 'room', 'clientId'])) {
      return { ok: false, error: 'bad_message' };
    }
    const room = normalizeRoomCode(input.room);
    if (!room) return { ok: false, error: 'bad_room' };
    if (typeof input.clientId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(input.clientId)) {
      return { ok: false, error: 'bad_client' };
    }
    return { ok: true, message: { type: 'join', room, clientId: input.clientId } };
  }

  if (input.type === 'break' || input.type === 'ready') {
    if (!exactKeys(input, ['v', 'type', 'on'])) return { ok: false, error: 'bad_message' };
    if (typeof input.on !== 'boolean') return { ok: false, error: 'bad_message' };
    return { ok: true, message: { type: input.type, on: input.on } };
  }

  return { ok: false, error: 'bad_message' };
}

class RoomHub {
  constructor(options = {}) {
    this.breakMs = options.breakMs ?? BREAK_MS;
    this.now = options.now ?? Date.now;
    this.rooms = new Map();
    this.clientRoom = new Map();
    this.listener = null;
  }

  onState(fn) {
    this.listener = fn;
  }

  join(clientId, roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return { ok: false, error: 'bad_room' };

    const current = this.clientRoom.get(clientId);
    if (current && current !== code) this.leave(clientId);

    let room = this.rooms.get(code);
    if (!room) {
      room = {
        code,
        breakOn: false,
        breakEndsAt: null,
        members: new Map(),
      };
      this.rooms.set(code, room);
    }

    if (!room.members.has(clientId)) {
      if (room.members.size >= 2) return { ok: false, error: 'room_full' };
      room.members.set(clientId, { ready: false });
    }
    this.clientRoom.set(clientId, code);
    this._emit(room);
    return { ok: true };
  }

  leave(clientId) {
    const code = this.clientRoom.get(clientId);
    if (!code) return;
    this.clientRoom.delete(clientId);
    const room = this.rooms.get(code);
    if (!room) return;
    room.members.delete(clientId);
    if (room.members.size === 0) {
      this.rooms.delete(code);
      return;
    }
    this._emit(room);
  }

  break(clientId, on) {
    const room = this._room(clientId);
    if (!room) return { ok: false, error: 'not_joined' };
    // A client cannot cancel the other person's pause.
    if (on !== true) return { ok: true };
    if (!room.breakOn) {
      room.breakOn = true;
      room.breakEndsAt = this.now() + this.breakMs;
      for (const member of room.members.values()) member.ready = false;
    }
    this._emit(room);
    return { ok: true };
  }

  ready(clientId, on) {
    const room = this._room(clientId);
    if (!room) return { ok: false, error: 'not_joined' };
    if (!room.breakOn) return { ok: true };
    room.members.get(clientId).ready = on === true;
    this._maybeClear(room);
    this._emit(room);
    return { ok: true };
  }

  evaluate() {
    let changed = false;
    for (const room of this.rooms.values()) {
      if (this._maybeClear(room)) changed = true;
    }
    if (changed) {
      for (const room of this.rooms.values()) this._emit(room);
    }
    return changed;
  }

  stateFor(clientId) {
    const room = this._room(clientId);
    if (!room) return null;
    let otherReady = false;
    for (const [id, member] of room.members) {
      if (id !== clientId && member.ready) otherReady = true;
    }
    return {
      v: 1,
      type: 'state',
      room: room.code,
      break: room.breakOn,
      youReady: room.members.get(clientId).ready,
      otherReady,
      peers: room.members.size,
      breakEndsAt: room.breakEndsAt,
    };
  }

  _maybeClear(room) {
    if (!room.breakOn || room.breakEndsAt == null) return false;
    if (this.now() < room.breakEndsAt) return false;
    if (room.members.size === 0) return false;
    for (const member of room.members.values()) {
      if (!member.ready) return false;
    }
    // One person alone can finish their own pause once the time is up.
    // Two people both have to be ready. The message still does not say who.
    room.breakOn = false;
    room.breakEndsAt = null;
    for (const member of room.members.values()) member.ready = false;
    return true;
  }

  _room(clientId) {
    const code = this.clientRoom.get(clientId);
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  _emit(room) {
    if (!this.listener) return;
    for (const id of room.members.keys()) {
      this.listener(id, this.stateFor(id));
    }
  }
}

module.exports = {
  ALPHABET,
  BREAK_MS,
  PUBLIC_STATE_KEYS,
  generateRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  RoomHub,
};
