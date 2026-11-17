'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { RoomHub, parseClientMessage } = require('../src/protocol');

function startRelay(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 0;
  const breakMs = options.breakMs
    ?? (process.env.TWENTY_BREAK_MS ? Number(process.env.TWENTY_BREAK_MS) : undefined);
  const hub = new RoomHub({ breakMs });
  const sockets = new Map();

  hub.onState((clientId, state) => {
    const ws = sockets.get(clientId);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(state));
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/health/') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      // Room count only. No codes, no membership.
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Twenty relay');
  });

  const wss = new WebSocketServer({ server, maxPayload: 512 });
  const timer = setInterval(() => hub.evaluate(), 1000);
  if (typeof timer.unref === 'function') timer.unref();

  wss.on('connection', (ws) => {
    let clientId = null;
    ws.on('message', (data) => {
      let input;
      try {
        input = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ v: 1, type: 'error', error: 'bad_message' }));
        return;
      }
      const parsed = parseClientMessage(input);
      if (!parsed.ok) {
        ws.send(JSON.stringify({ v: 1, type: 'error', error: parsed.error }));
        return;
      }
      if (parsed.message.type === 'join') {
        if (clientId && clientId !== parsed.message.clientId) {
          sockets.delete(clientId);
          hub.leave(clientId);
        }
        clientId = parsed.message.clientId;
        sockets.set(clientId, ws);
        const result = hub.join(clientId, parsed.message.room);
        if (!result.ok) {
          sockets.delete(clientId);
          hub.leave(clientId);
          clientId = null;
          ws.send(JSON.stringify({ v: 1, type: 'error', error: result.error }));
        }
        return;
      }
      if (!clientId) {
        ws.send(JSON.stringify({ v: 1, type: 'error', error: 'not_joined' }));
        return;
      }
      if (parsed.message.type === 'break') hub.break(clientId, parsed.message.on);
      if (parsed.message.type === 'ready') hub.ready(clientId, parsed.message.on);
    });

    ws.on('close', () => {
      if (!clientId) return;
      sockets.delete(clientId);
      hub.leave(clientId);
      clientId = null;
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const advertisedHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      resolve({
        host,
        port: addr.port,
        url: `ws://${advertisedHost}:${addr.port}`,
        close() {
          clearInterval(timer);
          for (const client of wss.clients) client.close();
          return new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}

module.exports = { startRelay };

if (require.main === module) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT) || 47221;
  startRelay({ host, port })
    .then((relay) => {
      console.log(`Twenty relay on ${host}:${relay.port}`);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}
