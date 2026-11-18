'use strict';

/**
 * CS-09: una búsqueda cortada por un reinicio sigue cada sitio por donde iba (su lista de fichas
 * y las ya terminadas) en vez de repetir sus páginas enteras.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f4reanudar-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.DATA_DIR = dir;
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.HTTP_RETRY_BASE_DELAY_MS = '0';
process.env.SEARXNG_URL = '';

const { buscarEnTodos } = require('../src/services/busqueda');
const fondo = require('../src/services/busquedasFondo');

const pedidas = [];
const sitio = http.createServer((req, res) => {
  pedidas.push(req.url);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url.startsWith('/buscar')) {
    return res.end([1, 2, 3, 4].map(n => `<a href="/v/${n}">v${n}</a>`).join(''));
  }
  return res.end(`<video src="/m/${req.url.split('/').pop()}.mp4"></video>`);
});
let base;
let clave;

test.before(async () => {
  await new Promise(r => sitio.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${sitio.address().port}`;
  clave = `127.0.0.1:${sitio.address().port}/buscar`;
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
});
test.after(() => {
  sitio.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CS-09: se apuntan la lista de fichas y las terminadas, con la clave del sitio', async () => {
  const eventos = [];
  await buscarEnTodos({ q: 'nube', paginas: 1 }, { emit: e => eventos.push(e), contar: false });
  const lista = eventos.find(e => e.type === 'sitio_enlaces');
  assert.equal(lista.clave, clave);
  assert.equal(lista.enlaces.length, 4);
  const hechas = eventos.filter(e => e.type === 'sitio_hechas').flatMap(e => e.urls);
  assert.deepEqual([...hechas].sort(), [...lista.enlaces].sort());
});

test('CS-09: retomado, no pide el listado ni las fichas ya terminadas', async () => {
  pedidas.length = 0;
  const eventos = [];
  // Fichas que la primera prueba no abrió (la caché de fichas no las tiene).
  const pendientes = [`${base}/v/7`, `${base}/v/8`];
  await buscarEnTodos(
    { q: 'nube', paginas: 1, retomar: { [clave]: pendientes } },
    { emit: e => eventos.push(e), contar: false }
  );
  assert.deepEqual(
    pedidas.filter(u => u.startsWith('/buscar')),
    []
  );
  assert.deepEqual(pedidas.filter(u => u.startsWith('/v/')).sort(), ['/v/7', '/v/8']);
  const items = eventos.filter(e => e.type === 'resultados').flatMap(e => e.items);
  assert.equal(items.length, 2);
});

test('CS-09: entradaPendiente da a cada sitio a medias las fichas que le faltaban', () => {
  const eventos = [
    {
      type: 'sitios',
      sitios: [
        { id: 0, clave: 'a.example/s' },
        { id: 1, clave: 'b.example/s' },
        { id: 2, clave: 'c.example/s' },
      ],
    },
    { type: 'sitio_enlaces', sitio: 0, clave: 'a.example/s', enlaces: ['a1', 'a2'] },
    { type: 'sitio_enlaces', sitio: 1, clave: 'b.example/s', enlaces: ['b1', 'b2', 'b3'] },
    { type: 'sitio_hechas', sitio: 1, clave: 'b.example/s', urls: ['b1'] },
    { type: 'sitio_fin', sitio: 0 },
    // Una vuelta anterior ya retomada: sus terminadas también cuentan.
    { type: 'sitio_hechas', sitio: 1, clave: 'b.example/s', urls: ['b3'] },
  ];
  const r = fondo.entradaPendiente({ q: 'x' }, eventos);
  assert.deepEqual(r.sitios, [1, 2]);
  // «c» no llegó a tener lista: se busca entero.
  assert.deepEqual(r.retomar, { 'b.example/s': ['b2'] });
});

test('CS-09: los eventos para retomar no llegan a quien mira', async () => {
  const id = fondo.iniciar({ q: 'nube', paginas: 1 });
  const vistos = [];
  await new Promise(resolve => {
    fondo.suscribir(id, 0, e => {
      vistos.push(e.type);
      if (e.type === 'fin' || e.type === 'error') resolve();
    });
  });
  assert.ok(vistos.includes('resultados'));
  assert.ok(!vistos.includes('sitio_enlaces'));
  assert.ok(!vistos.includes('sitio_hechas'));
  // Ni al volver a mirarla desde el principio.
  const otra = [];
  fondo.suscribir(id, 0, e => otra.push(e.type));
  assert.ok(otra.includes('fin'));
  assert.ok(!otra.includes('sitio_enlaces') && !otra.includes('sitio_hechas'));
  await fondo.guardarAhora?.();
});
