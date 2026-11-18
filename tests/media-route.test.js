'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const config = require('../src/config');
const { createApp } = require('../src/app');

/** Levanta un servidor en un puerto libre y devuelve {url, cerrar}. */
function levantar(manejador) {
  return new Promise(resolve => {
    const servidor = http.createServer(manejador).listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${servidor.address().port}`,
        cerrar: () => new Promise(r => servidor.close(r)),
      });
    });
  });
}

const VIDEO = Buffer.alloc(1000, 7);

/** Un «sitio» que sirve un vídeo con Range y exige la ficha como Referer, y una página HTML. */
function sitio(req, res) {
  if (req.url.startsWith('/pagina')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<html></html>');
  }
  if (req.headers.referer !== 'http://ficha.example/v/1') {
    res.writeHead(403);
    return res.end();
  }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (!m) {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': VIDEO.length });
    return res.end(VIDEO);
  }
  const ini = Number(m[1]);
  const fin = m[2] ? Number(m[2]) : VIDEO.length - 1;
  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': fin - ini + 1,
    'Content-Range': `bytes ${ini}-${fin}/${VIDEO.length}`,
    'Accept-Ranges': 'bytes',
  });
  res.end(VIDEO.subarray(ini, fin + 1));
}

test('/api/media no sirve de puerta a la red interna', async t => {
  const app = await levantar(createApp());
  const origen = await levantar(sitio);
  t.after(() => Promise.all([app.cerrar(), origen.cerrar()]));
  const r = await fetch(`${app.url}/api/media?url=${encodeURIComponent(`${origen.url}/v.mp4`)}`);
  assert.ok(r.status >= 400 && r.status < 500, `esperaba un rechazo y dio ${r.status}`);
});

test('/api/media pasa el vídeo con Range y Referer, y rechaza lo que no es vídeo', async t => {
  const antes = config.security.blockPrivateAddresses;
  config.security.blockPrivateAddresses = false; // el «sitio» de la prueba está en 127.0.0.1
  const app = await levantar(createApp());
  const origen = await levantar(sitio);
  t.after(async () => {
    config.security.blockPrivateAddresses = antes;
    await Promise.all([app.cerrar(), origen.cerrar()]);
  });
  // CS-S8: con la firma que el servidor puso al entregar la dirección.
  const { firmar } = require('../src/lib/firmaProxy');
  const pedir = (ruta, ref, headers = {}) =>
    fetch(
      `${app.url}/api/media?url=${encodeURIComponent(origen.url + ruta)}` +
        (ref ? `&ref=${encodeURIComponent(ref)}` : '') +
        `&s=${firmar(origen.url + ruta)}`,
      { headers }
    );
  const sinFirma = await fetch(`${app.url}/api/media?url=${encodeURIComponent(origen.url)}/v.mp4`);
  assert.equal(sinFirma.status, 403, 'sin firma ni sitio configurado, no');

  const parcial = await pedir('/v.mp4', 'http://ficha.example/v/1', { Range: 'bytes=100-199' });
  assert.equal(parcial.status, 206);
  assert.equal(parcial.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(parcial.headers.get('content-type'), 'video/mp4');
  assert.equal((await parcial.arrayBuffer()).byteLength, 100);

  // Sin la ficha como Referer el sitio lo niega: se informa, no se cuelga
  assert.equal((await pedir('/v.mp4')).status, 502);
  // Una página no se reenvía como si fuera vídeo
  assert.equal((await pedir('/pagina', 'http://ficha.example/v/1')).status, 415);
});
