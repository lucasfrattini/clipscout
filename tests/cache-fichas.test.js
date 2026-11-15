'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-cachefichas-'));
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';

const config = require('../src/config');
const cacheFichas = require('../src/services/cacheFichas');
const { buscarEnTodos } = require('../src/services/busqueda');
const { crawl, normalizeCrawlParams } = require('../src/services/scraper');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('LRU con caducidad y clave por opciones', t => {
  cacheFichas.vaciar();
  const antes = { ...config.cacheFichas };
  t.after(() => {
    Object.assign(config.cacheFichas, antes);
    cacheFichas.vaciar();
  });
  config.cacheFichas.maxEntradas = 2;
  const op = { extensions: ['.mp4'], withThumbnails: true };
  cacheFichas.set('a', op, { detalles: [{ url: 'a.mp4' }] });
  cacheFichas.set('b', op, { detalles: [] });
  assert.ok(cacheFichas.get('a', op), 'usar «a» la sube al final');
  cacheFichas.set('c', op, { detalles: [] });
  assert.equal(cacheFichas.get('b', op), null, 'se desaloja la menos usada');
  assert.ok(cacheFichas.get('a', op));
  assert.equal(cacheFichas.get('a', { extensions: ['.webm'] }), null, 'otras opciones, otra clave');
  config.cacheFichas.ttlMs = -1;
  assert.equal(cacheFichas.get('a', op), null, 'caducada');
});

test('una búsqueda parecida no vuelve a abrir las mismas fichas; el Explorador sí', async t => {
  cacheFichas.vaciar();
  const pedidas = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    pedidas.set(url.pathname, (pedidas.get(url.pathname) || 0) + 1);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/buscar') {
      return res.end('<a href="/v/1">uno</a><a href="/v/2">dos</a>');
    }
    // /v/2 trae además el clip de vista previa de otro vídeo: dudoso, sin duración
    return res.end(
      `<title>Ficha ${url.pathname}</title><video src="${url.pathname.replace('/v/', '/m/')}.mp4"></video>` +
        '<span class="duration">10:00</span>' +
        (url.pathname === '/v/2' ? '<video src="/m/otro_preview.mp4"></video>' : '')
    );
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    cacheFichas.vaciar();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({
      profiles: [
        {
          name: 'prueba',
          config: { searchUrl: `${base}/buscar?q={q}`, linkPattern: '/v/', fileExtensions: '.mp4' },
        },
      ],
    })
  );

  const buscar = async q => {
    const items = [];
    await buscarEnTodos(
      { q, paginas: 1 },
      { emit: e => e.type === 'resultados' && items.push(...e.items) }
    );
    return items;
  };
  const primera = await buscar('playa');
  const segunda = await buscar('playa grande');
  assert.equal(pedidas.get('/v/1'), 1, 'la segunda búsqueda no volvió a abrir la ficha');
  assert.equal(pedidas.get('/v/2'), 1);
  assert.equal(pedidas.get('/buscar'), 2, 'el listado sí se vuelve a pedir');
  assert.deepEqual(
    segunda.map(i => [i.url, i.durationSeconds]).sort(),
    primera.map(i => [i.url, i.durationSeconds]).sort()
  );
  assert.equal(primera.find(i => i.url.endsWith('/m/1.mp4')).durationSeconds, 600);

  const params = normalizeCrawlParams({ searchUrl: `${base}/buscar`, linkPattern: '/v/' });
  await crawl({ ...params, extensions: ['.mp4'] });
  assert.equal(pedidas.get('/v/1'), 2, 'el Explorador va siempre fresco');
});
