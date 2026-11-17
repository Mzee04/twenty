'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { startRelay } = require('../relay/server');

const root = path.join(__dirname, '..');
const port = Number(process.env.TWENTY_PREVIEW_PORT) || 43123;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    send(res, 403, 'no');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, 'not found');
      return;
    }
    if (pathname === '/index.html') {
      const html = data.toString('utf8').replace('dist/renderer.bundle.js', 'dist/preview.bundle.js');
      send(res, 200, html, types['.html']);
      return;
    }
    send(res, 200, data, types[path.extname(file)] || 'application/octet-stream');
  });
});

startRelay({ host: '127.0.0.1', port: 47221 })
  .then(() => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`Twenty preview http://127.0.0.1:${port}`);
    });
  })
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
