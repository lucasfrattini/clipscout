'use strict';

/**
 * Fase 7 · NU-4: con alias, cada sitio se busca también por ellos y lo encontrado llega por la
 * misma búsqueda. Un sitio local con un listado distinto por término.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f7-alias-'));
process.env.DATA_DIR = dir;
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';

const cacheFichas = require('../src/services/cacheFichas');
const { buscarEnTodos } = require('../src/services/busqueda');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('NU-4: los alias se buscan en cada sitio y sus resultados se suman', async t => {
  cacheFichas.vaciar();
  const terminos = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/buscar') {
      const q = url.searchParams.get('q');
      terminos.push(q);
      return res.end(q === 'Anita P' ? '<a href="/v/2">dos</a>' : '<a href="/v/1">uno</a>');
    }
    return res.end(
      `<title>Ficha ${url.pathname}</title><video src="${url.pathname.replace('/v/', '/m/')}.mp4"></video>`
    );
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
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
  const items = [];
  await buscarEnTodos(
    { q: 'Ana Pérez', paginas: 1, alias: ['Anita P'] },
    { contar: false, emit: e => e.type === 'resultados' && items.push(...e.items) }
  );
  assert.deepEqual(terminos, ['Ana Pérez', 'Anita P']);
  assert.deepEqual(items.map(i => new URL(i.url).pathname).sort(), ['/m/1.mp4', '/m/2.mp4']);
});
