'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { startRelay } = require('../relay/server');

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

test('the relay forwards only break state, and health answers', async () => {
  const relay = await startRelay({ host: '127.0.0.1', port: 0, breakMs: 60000 });
  try {
    const health = await fetch(`http://127.0.0.1:${relay.port}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(JSON.stringify(body).includes('ROOM'), false);

    const a = await connect(relay.url);
    const b = await connect(relay.url);
    const aState = nextMessage(a);
    a.send(JSON.stringify({ v: 1, type: 'join', room: 'ABCD', clientId: 'client-aaaa' }));
    const joined = await aState;
    assert.equal(joined.peers, 1);
    assert.equal(joined.break, false);

    const bState = nextMessage(b);
    const aPeer = nextMessage(a);
    b.send(JSON.stringify({ v: 1, type: 'join', room: 'ABCD', clientId: 'client-bbbb' }));
    const bJoined = await bState;
    const aSaw = await aPeer;
    assert.equal(bJoined.peers, 2);
    assert.equal(aSaw.peers, 2);
    assert.equal(JSON.stringify(bJoined).includes('client-aaaa'), false);

    const aBreak = nextMessage(a);
    const bBreak = nextMessage(b);
    b.send(JSON.stringify({ v: 1, type: 'break', on: true, pulse: 140 }));
    const rejected = await bBreak;
    assert.equal(rejected.type, 'error');
    assert.equal(rejected.error, 'forbidden');

    const forB = nextMessage(b);
    b.send(JSON.stringify({ v: 1, type: 'break', on: true }));
    const forA = await aBreak;
    const gotB = await forB;
    assert.equal(forA.break, true);
    assert.equal(gotB.break, true);
    assert.equal(JSON.stringify(forA).includes('client-bbbb'), false);
    assert.equal(Object.hasOwn(forA, 'pulse'), false);

    a.close();
    b.close();
  } finally {
    await relay.close();
  }
});
