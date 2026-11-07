'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-jd-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');

const { createApp } = require('../src/app');
const { limpiarSubcarpeta } = require('../src/services/jdownloader');

// JDownloader falso: la «Deprecated API» (parámetros JSON en la query, respuesta {data}).
const recibidos = [];
const jdFalso = http.createServer((req, res) => {
  const [ruta, query = ''] = req.url.split('?');
  const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
  const responder = data => res.end(JSON.stringify({ data }));
  if (ruta === '/jd/version') return responder(48637);
  if (ruta === '/config/get' && params[2] === 'DefaultDownloadFolder') return responder('/output');
  if (ruta === '/linkgrabberv2/addLinks') {
    recibidos.push(params[0]);
    return responder({ id: 99 });
  }
  res.statusCode = 404;
  return res.end('{}');
});

let servidor;
let base;
let jdUrl;

before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  jdFalso.listen(0, '127.0.0.1');
  await Promise.all([servidor, jdFalso].map(s => new Promise(r => s.once('listening', r))));
  base = `http://127.0.0.1:${servidor.address().port}`;
  jdUrl = `http://127.0.0.1:${jdFalso.address().port}`;
});

after(() => {
  servidor.close();
  jdFalso.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = async (ruta, opciones = {}) => {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: r.status, body: await r.json() };
};

test('subcarpeta: sin escaparse de la carpeta de descargas', () => {
  assert.equal(limpiarSubcarpeta('../../etc'), 'etc');
  assert.equal(limpiarSubcarpeta('/Ana Pérez/'), 'Ana Pérez');
  assert.equal(limpiarSubcarpeta('a\\..\\b'), 'a/b');
  assert.equal(limpiarSubcarpeta('x:y?'), 'xy');
});

test('sin configurar no envía; con URL mala no guarda', async () => {
  const r = await json('/api/ajustes/jdownloader/enviar', {
    method: 'POST',
    body: JSON.stringify({ links: ['https://example.com/a.mp4'] }),
  });
  assert.equal(r.status, 409);
  const mala = await json('/api/ajustes/jdownloader', {
    method: 'PUT',
    body: JSON.stringify({ url: 'http://127.0.0.1:1' }),
  });
  assert.equal(mala.status, 400);
});

test('probar, guardar y enviar a una subcarpeta', async () => {
  const p = await json('/api/ajustes/jdownloader/probar', {
    method: 'POST',
    body: JSON.stringify({ url: jdUrl }),
  });
  assert.deepEqual(p.body, { ok: true, version: 48637, carpeta: '/output' });
  const g = await json('/api/ajustes/jdownloader', {
    method: 'PUT',
    body: JSON.stringify({ url: `${jdUrl}/`, autostart: false }),
  });
  assert.equal(g.status, 200);
  assert.equal((await json('/api/ajustes/jdownloader')).body.url, jdUrl);

  const e = await json('/api/ajustes/jdownloader/enviar', {
    method: 'POST',
    body: JSON.stringify({
      links: ['https://example.com/a.mp4', 'javascript:alert(1)', 'https://example.com/b.m3u8'],
      carpeta: '../Ana',
      origen: 'https://example.com/ficha',
    }),
  });
  assert.equal(e.status, 200);
  assert.equal(e.body.enviados, 2);
  assert.equal(e.body.carpeta, '/output/Ana');
  const q = recibidos.at(-1);
  assert.equal(q.links, 'https://example.com/a.mp4\nhttps://example.com/b.m3u8');
  assert.equal(q.destinationFolder, '/output/Ana');
  assert.equal(q.autostart, false);
  assert.equal(q.sourceUrl, 'https://example.com/ficha');

  // Sin subcarpeta: no se toca el destino (manda la regla de JDownloader).
  await json('/api/ajustes/jdownloader/enviar', {
    method: 'POST',
    body: JSON.stringify({ links: ['https://example.com/c.mp4'] }),
  });
  assert.equal(recibidos.at(-1).destinationFolder, undefined);
});
