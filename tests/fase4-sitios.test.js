'use strict';

/**
 * Fase 4: salud por sitio (CS-17) y «Reconfigurar» un sitio sin moverlo de su sitio en la lista.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f4sitios-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.DATA_DIR = dir;
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.HTTP_RETRY_BASE_DELAY_MS = '0';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_AGRUPAR_CADA_MS = '20';

const estadisticas = require('../src/services/estadisticas');
const { buscarEnTodos } = require('../src/services/busqueda');
const { createApp } = require('../src/app');

let roto = false;
const sitio = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  // «Roto»: el sitio cambió su página y el listado ya no lleva fichas.
  if (req.url.startsWith('/buscar')) return res.end(roto ? '<p>nada</p>' : '<a href="/v/1">1</a>');
  return res.end('<video src="/m/1.mp4"></video>');
});
let app;
let base;
let api;

test.before(async () => {
  await new Promise(r => sitio.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${sitio.address().port}`;
  app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  api = `http://127.0.0.1:${app.address().port}/api`;
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({
      profiles: [
        { name: 'primero', config: { searchUrl: 'http://otro.example/s?q={q}' } },
        {
          name: 'el de prueba',
          config: { searchUrl: `${base}/buscar?q={q}`, linkPattern: '/x/', fileExtensions: '.mp4' },
        },
        { name: 'tercero', config: { searchUrl: 'http://tercero.example/s?q={q}' } },
      ],
    })
  );
});
test.after(() => {
  sitio.close();
  app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const saludDe = async () => {
  const r = await (await fetch(`${api}/ajustes/sitios`)).json();
  return r.sitios.find(s => s.nombre === 'el de prueba').salud;
};

test('«Reconfigurar» cambia la configuración y conserva nombre y posición', async () => {
  const r = await fetch(`${api}/sitios/reconfigurar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sitios: [
        {
          nombre: 'otro nombre',
          config: { searchUrl: `${base}/buscar?q={q}`, linkPattern: '/v/', fileExtensions: '.mp4' },
        },
        { config: { searchUrl: 'http://nuevo.example/s?q={q}' } },
      ],
    }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, cambiados: 1, sinSitio: 1 });
  const { profiles } = JSON.parse(fs.readFileSync(process.env.PROFILES_PATH, 'utf8'));
  assert.deepEqual(
    profiles.map(p => p.name),
    ['primero', 'el de prueba', 'tercero']
  );
  assert.equal(profiles[1].config.linkPattern, '/v/');
});

test('CS-17: dos búsquedas seguidas sin nada marcan el sitio; una con resultados lo limpia', async () => {
  const sitios = [1];
  await buscarEnTodos({ q: 'playa', paginas: 1, sitios });
  assert.equal((await saludDe()).aviso, false);
  roto = true;
  await buscarEnTodos({ q: 'playa', paginas: 1, sitios });
  assert.equal((await saludDe()).cerosSeguidos, 1);
  assert.equal((await saludDe()).aviso, false, 'una sola vez puede ser que no haya nada');
  await buscarEnTodos({ q: 'playa', paginas: 1, sitios });
  const s = await saludDe();
  assert.equal(s.aviso, true);
  assert.equal(s.cerosSeguidos, 2);
  assert.ok(s.ultimaConResultados, 'recuerda cuándo dio algo por última vez');
  // Las búsquedas que no cuentan (contar: false) no cambian la salud.
  roto = false;
  await buscarEnTodos({ q: 'playa', paginas: 1, sitios }, { contar: false });
  assert.equal((await saludDe()).aviso, true);
  await buscarEnTodos({ q: 'playa', paginas: 1, sitios });
  assert.equal((await saludDe()).aviso, false);
  assert.equal((await saludDe()).cerosSeguidos, 0);
});

test('CS-17: poner las cifras a cero quita también los avisos', async () => {
  estadisticas.anotarSalud('roto.example', {});
  estadisticas.anotarSalud('roto.example', { error: 'HTTP 500' });
  assert.equal((await estadisticas.leerSalud())['roto.example'].ultimoError, 'HTTP 500');
  await estadisticas.ponerACero();
  assert.deepEqual(await estadisticas.leerSalud(), {});
});

test('CS-08: los repetidos se agrupan mientras dura la búsqueda, no solo al final', async t => {
  // Tres sitios en el mismo servidor: «a» y «b» dan el MISMO vídeo al momento; «c» tarda.
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const [, sitioNombre] = req.url.split('/');
    if (req.url.includes('/buscar')) return res.end(`<a href="/${sitioNombre}/v/1">1</a>`);
    const lento = sitioNombre === 'c';
    return setTimeout(
      () =>
        res.end(
          `<video src="https://cdn.example/m/paisaje-de-montana-largo.mp4" poster="https://cdn.example/${sitioNombre}.jpg"></video>`
        ),
      lento ? 400 : 0
    );
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const b = `http://127.0.0.1:${srv.address().port}`;
  const perfiles = JSON.parse(fs.readFileSync(process.env.PROFILES_PATH, 'utf8'));
  t.after(() => fs.writeFileSync(process.env.PROFILES_PATH, JSON.stringify(perfiles)));
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({
      profiles: ['a', 'b', 'c'].map(n => ({
        name: n,
        config: { searchUrl: `${b}/${n}/buscar?q={q}`, linkPattern: '/v/', fileExtensions: '.mp4' },
      })),
    })
  );
  const eventos = [];
  await buscarEnTodos({ q: 'montaña', paginas: 1 }, { emit: e => eventos.push(e), contar: false });
  const finC = eventos.findIndex(e => e.type === 'sitio_fin' && e.sitio === 2);
  const parcial = eventos.findIndex(e => e.type === 'duplicados' && e.parcial);
  assert.ok(parcial >= 0 && parcial < finC, 'agrupados antes de que acabe el sitio lento');
  assert.equal(eventos[parcial].grupos[0].miembros.length, 2);
  const final = eventos.at(-1);
  assert.equal(final.type, 'duplicados');
  assert.equal(final.parcial, undefined);
  assert.equal(final.grupos[0].miembros.length, 3);
});
