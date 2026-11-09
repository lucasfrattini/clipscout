'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fondo-'));
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';

const fondo = require('../src/services/busquedasFondo');

/**
 * La búsqueda sigue en el servidor aunque nadie la mire (antes, cerrar la página la abortaba), y
 * quien vuelve recibe TODO lo ocurrido, numerado, desde donde se quedó.
 */

function crearSitio() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/buscar') {
      res.end([1, 2, 3].map(n => `<a href="/v/${n}">v${n}</a>`).join(''));
    } else {
      // Fichas lentas: la búsqueda dura lo suficiente para mirarla a medias.
      setTimeout(
        () => res.end(`<video src="/m/${url.pathname.split('/').pop()}.mp4"></video>`),
        150
      );
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('sigue sin nadie mirando y se reengancha desde el último evento visto', async t => {
  const server = await crearSitio();
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({
      profiles: [
        {
          name: 'prueba — búsqueda',
          config: { searchUrl: `${base}/buscar?q={q}`, linkPattern: '/v/', fileExtensions: '.mp4' },
        },
      ],
    })
  );

  const id = fondo.iniciar({ q: 'algo', paginas: 1 });
  // Alguien mira los primeros eventos y se va.
  const vistos = [];
  const baja = fondo.suscribir(id, 0, e => vistos.push(e));
  await new Promise(r => setTimeout(r, 50));
  baja();
  const hasta = vistos.length;
  assert.ok(hasta > 0);

  // Vuelve cuando ya terminó: recibe el resto, sin repetir lo que vio.
  for (let i = 0; i < 100 && !fondo.actual().terminada; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(fondo.actual().terminada, true, 'terminó sola, sin nadie suscrito');
  const resto = [];
  fondo.suscribir(id, hasta, e => resto.push(e));
  assert.equal(resto[0].seq, hasta);
  assert.equal(resto.at(-1).type, 'fin');
  const ficheros = [...vistos, ...resto]
    .filter(e => e.type === 'resultados')
    .flatMap(e => e.items.map(i => i.url));
  assert.equal(new Set(ficheros).size, 3, 'están los tres vídeos');
  assert.equal(
    fondo.suscribir('no-existe', 0, () => {}),
    null
  );
});
