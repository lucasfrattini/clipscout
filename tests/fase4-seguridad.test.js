'use strict';

/**
 * Fase 4, seguridad: CS-S7 (cada redirección se valida, también con proxy de salida) y CS-S8
 * (el intermediario de vídeo e imágenes solo para lo que entregó el propio servidor).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f4seg-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.DATA_DIR = dir;
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.HTTP_RETRY_BASE_DELAY_MS = '0';

const ssrf = require('../src/lib/ssrf');
const { fetchHtml, fetchContentLength } = require('../src/lib/http');
const { obtenerMiniatura } = require('../src/services/thumbnails');

let base;
const sitio = http.createServer((req, res) => {
  const saltos = { '/a': '/b', '/b': '/privado', '/img': '/privado.png', '/bucle': '/bucle' };
  if (saltos[req.url]) {
    res.writeHead(302, { Location: saltos[req.url] });
    return res.end();
  }
  if (req.url === '/ok') {
    res.writeHead(301, { Location: `${base}/fin` });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': '5' });
  return res.end('hola!');
});

test.before(async () => {
  await new Promise(r => sitio.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${sitio.address().port}`;
});
test.after(() => {
  sitio.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Se simula lo que haría la validación con un destino «privado»: con proxy de salida, el proxy
 * resuelve los nombres y la única barrera es esta comprobación en cada salto.
 */
function vigilar(t) {
  const vistos = [];
  const original = ssrf.assertUrlIsSafe;
  ssrf.assertUrlIsSafe = async url => {
    vistos.push(new URL(url).pathname);
    if (url.includes('/privado')) {
      const { AppError } = require('../src/lib/errors');
      throw new AppError('dirección privada', 403, 'PRIVATE_ADDRESS_BLOCKED');
    }
    return original(url);
  };
  t.after(() => {
    ssrf.assertUrlIsSafe = original;
  });
  return vistos;
}

test('CS-S7: páginas: cada salto se valida y el que va a la red local se corta', async t => {
  const vistos = vigilar(t);
  await assert.rejects(fetchHtml(`${base}/a`), /privada/);
  assert.deepEqual(vistos, ['/a', '/a', '/b', '/privado']);
  assert.equal(await fetchHtml(`${base}/ok`), 'hola!', 'las redirecciones buenas se siguen');
});

test('CS-S7: tamaño (HEAD) y miniaturas pasan por la misma validación', async t => {
  const vistos = vigilar(t);
  assert.equal(await fetchContentLength(`${base}/a`), null);
  assert.ok(vistos.includes('/privado'));
  await assert.rejects(obtenerMiniatura(`${base}/img`));
  assert.ok(vistos.includes('/privado.png'));
});

test('CS-S7: un bucle de redirecciones se corta', async () => {
  await assert.rejects(fetchHtml(`${base}/bucle`), /redirecciones/);
});
