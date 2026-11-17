'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALPHABET,
  PUBLIC_STATE_KEYS,
  generateRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  RoomHub,
} = require('../src/protocol');

function keysOf(state) {
  return Object.keys(state).sort();
}

test('room codes are four unambiguous characters', () => {
  assert.equal(normalizeRoomCode('k7mq'), 'K7MQ');
  assert.equal(normalizeRoomCode(' K7MQ '), 'K7MQ');
  assert.equal(normalizeRoomCode('K7M0'), null);
  assert.equal(normalizeRoomCode('K7M'), null);
  assert.equal(normalizeRoomCode('K7MQE'), null);
  const code = generateRoomCode(() => 0);
  assert.equal(code, ALPHABET[0].repeat(4));
  for (const ch of generateRoomCode()) assert.ok(ALPHABET.includes(ch));
});

test('messages that carry vitals or extra fields are rejected', () => {
  const bad = parseClientMessage({
    v: 1,
    type: 'break',
    on: true,
    pulse: 120,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'forbidden');

  const nested = parseClientMessage({
    v: 1,
    type: 'join',
    room: 'ABCD',
    clientId: 'client-aaaa',
    meta: { breathing: 12 },
  });
  assert.equal(nested.ok, false);

  const who = parseClientMessage({ v: 1, type: 'break', on: true, who: 'a' });
  assert.equal(who.ok, false);

  const ok = parseClientMessage({ v: 1, type: 'break', on: true });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.message, { type: 'break', on: true });
});

test('join requires a room code and a client id, and nothing else', () => {
  const missing = parseClientMessage({ v: 1, type: 'join', room: 'ABCD' });
  assert.equal(missing.ok, false);
  const joined = parseClientMessage({
    v: 1,
    type: 'join',
    room: 'ab2k',
    clientId: 'person-1234',
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.message.room, 'AB2K');
});

test('a room holds two people and does not say who asked for a break', () => {
  const hub = new RoomHub({ breakMs: 1000, now: () => 1_000_000 });
  const seen = [];
  hub.onState((id, state) => seen.push({ id, state }));

  assert.equal(hub.join('aaaaaaaa', 'ABCD').ok, true);
  assert.equal(hub.join('bbbbbbbb', 'abcd').ok, true);
  assert.equal(hub.join('cccccccc', 'ABCD').error, 'room_full');

  seen.length = 0;
  hub.break('aaaaaaaa', true);
  assert.ok(seen.length >= 2);
  for (const { state } of seen) {
    assert.equal(state.break, true);
    assert.deepEqual(keysOf(state), [...PUBLIC_STATE_KEYS].sort());
    assert.equal(JSON.stringify(state).includes('aaaaaaaa'), false);
    assert.equal(JSON.stringify(state).includes('pulse'), false);
    assert.equal(state.breakEndsAt, 1_000_000 + 1000);
  }

  // Cancelling is ignored. The other person stays in the pause.
  hub.break('bbbbbbbb', false);
  assert.equal(hub.stateFor('bbbbbbbb').break, true);
});

test('the same client can rejoin without taking the second seat', () => {
  const hub = new RoomHub({ now: () => 0 });
  hub.join('aaaaaaaa', 'ABCD');
  hub.join('bbbbbbbb', 'ABCD');
  assert.equal(hub.join('aaaaaaaa', 'ABCD').ok, true);
  assert.equal(hub.stateFor('aaaaaaaa').peers, 2);
  assert.equal(hub.join('cccccccc', 'ABCD').error, 'room_full');
});

test('both ready before the twenty minutes does not open the room', () => {
  let now = 0;
  const hub = new RoomHub({ breakMs: 1000, now: () => now });
  hub.join('aaaaaaaa', 'ABCD');
  hub.join('bbbbbbbb', 'ABCD');
  hub.break('bbbbbbbb', true);
  hub.ready('aaaaaaaa', true);
  hub.ready('bbbbbbbb', true);
  assert.equal(hub.stateFor('aaaaaaaa').break, true);
  assert.equal(hub.stateFor('aaaaaaaa').youReady, true);
  assert.equal(hub.stateFor('aaaaaaaa').otherReady, true);

  now = 1000;
  assert.equal(hub.evaluate(), true);
  const state = hub.stateFor('aaaaaaaa');
  assert.equal(state.break, false);
  assert.equal(state.youReady, false);
  assert.equal(state.otherReady, false);
  assert.equal(state.breakEndsAt, null);
});

test('one ready person does not end a two-person pause when the time is up', () => {
  let now = 0;
  const hub = new RoomHub({ breakMs: 500, now: () => now });
  hub.join('aaaaaaaa', 'ABCD');
  hub.join('bbbbbbbb', 'ABCD');
  hub.break('aaaaaaaa', true);
  hub.ready('aaaaaaaa', true);
  now = 500;
  hub.evaluate();
  assert.equal(hub.stateFor('bbbbbbbb').break, true);
  assert.equal(hub.stateFor('bbbbbbbb').otherReady, true);
  assert.equal(hub.stateFor('bbbbbbbb').youReady, false);
});

test('a person alone can finish once the time is up and they are ready', () => {
  let now = 0;
  const hub = new RoomHub({ breakMs: 500, now: () => now });
  hub.join('aaaaaaaa', 'ABCD');
  hub.break('aaaaaaaa', true);
  hub.ready('aaaaaaaa', true);
  now = 500;
  hub.evaluate();
  assert.equal(hub.stateFor('aaaaaaaa').break, false);
});

test('unready is allowed, and an empty room is dropped', () => {
  const hub = new RoomHub({ now: () => 0 });
  hub.join('aaaaaaaa', 'ABCD');
  hub.join('bbbbbbbb', 'ABCD');
  hub.break('aaaaaaaa', true);
  hub.ready('aaaaaaaa', true);
  hub.ready('aaaaaaaa', false);
  assert.equal(hub.stateFor('aaaaaaaa').youReady, false);
  hub.leave('aaaaaaaa');
  hub.leave('bbbbbbbb');
  assert.equal(hub.stateFor('aaaaaaaa'), null);
  assert.equal(hub.rooms.size, 0);
});

test('a break message before join is not a room', () => {
  const hub = new RoomHub();
  assert.equal(hub.break('aaaaaaaa', true).error, 'not_joined');
});
