'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const express = require('express');
const { estaticosComprimidos } = require('../src/lib/estaticosComprimidos');

// fetch añade «Cache-Control: no-cache» si se pone If-None-Match a mano (el navegador, al revalidar,
// no): para el 304, una petición tal cual.
const estado = (url, headers) =>
  new Promise((ok, mal) =>
    http.get(url, { headers }, r => (r.resume(), ok(r.statusCode))).on('error', mal)
  );

function servidor(raiz) {
  const app = express();
  app.use(estaticosComprimidos(raiz));
  app.use(express.static(raiz));
  return new Promise(r => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
}

test('estáticos: gzip con ETag y 304; lo pequeño, lo oculto y sin gzip, a express.static', async t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-gz-'));
  const grande = 'const x = 1;\n'.repeat(400);
  fs.writeFileSync(path.join(raiz, 'app.js'), grande);
  fs.writeFileSync(path.join(raiz, 'poco.css'), 'a{}');
  fs.writeFileSync(path.join(raiz, '.secreto.js'), grande);
  const s = await servidor(raiz);
  t.after(() => {
    s.close();
    fs.rmSync(raiz, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${s.address().port}`;
  const gz = { 'Accept-Encoding': 'gzip' };

  const r = await fetch(`${base}/app.js`, { headers: gz });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(await r.text(), grande); // fetch descomprime
  const etag = r.headers.get('etag');
  assert.equal(await estado(`${base}/app.js`, { ...gz, 'If-None-Match': etag }), 304);

  // Cambia el fichero: otra versión comprimida y otra ETag.
  fs.writeFileSync(path.join(raiz, 'app.js'), grande + '// v2\n'.repeat(10));
  assert.equal(await estado(`${base}/app.js`, { ...gz, 'If-None-Match': etag }), 200);
  const r2 = await fetch(`${base}/app.js`, { headers: gz });
  assert.ok((await r2.text()).endsWith('// v2\n'));

  const poco = await fetch(`${base}/poco.css`, { headers: gz });
  assert.equal(poco.headers.get('content-encoding'), null);
  assert.notEqual((await fetch(`${base}/.secreto.js`, { headers: gz })).status, 200);
  const sin = await fetch(`${base}/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(sin.headers.get('content-encoding'), null);
  assert.ok(zlib.gzipSync(grande).length < grande.length / 4);
});
