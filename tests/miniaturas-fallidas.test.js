'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';

const { obtenerMiniatura, fallidas } = require('../src/services/thumbnails');
const { createApp } = require('../src/app');

/**
 * Una miniatura que falló no se vuelve a pedir al sitio durante unos minutos (caché negativa), y
 * el navegador recibe el error con caché para no repetirla en cada repintado.
 */
test('caché negativa: el segundo intento no llega al sitio y el error dice que se cachee', async t => {
  let pedidas = 0;
  const sitio = http.createServer((req, res) => {
    pedidas += 1;
    res.statusCode = 404;
    res.end();
  });
  await new Promise(r => sitio.listen(0, '127.0.0.1', r));
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => {
    sitio.close();
    app.close();
    fallidas.clear();
  });
  const imagen = `http://127.0.0.1:${sitio.address().port}/rota.jpg`;

  await assert.rejects(obtenerMiniatura(imagen), { code: 'THUMBNAIL_UNAVAILABLE' });
  await assert.rejects(obtenerMiniatura(imagen), { code: 'THUMBNAIL_UNAVAILABLE' });
  assert.equal(pedidas, 1, 'la segunda no salió hacia el sitio');

  const r = await fetch(
    `http://127.0.0.1:${app.address().port}/api/thumbnail?url=${encodeURIComponent(imagen)}`
  );
  assert.equal(r.status, 404);
  assert.match(r.headers.get('cache-control') || '', /max-age=300/);
  assert.equal(pedidas, 1);
});
