'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-cola-'));
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_FONDO_MAX_ACTIVAS = '1';

const fondo = require('../src/services/busquedasFondo');
const { createApp } = require('../src/app');

/**
 * Con el máximo de búsquedas en marcha, la siguiente ya no da 409: espera en cola y arranca sola
 * cuando se libera el hueco. Se puede sacar de la cola antes de que empiece.
 */

function crearSitio() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/buscar') {
      res.end([1, 2].map(n => `<a href="/v/${n}">v${n}</a>`).join(''));
    } else {
      setTimeout(
        () => res.end(`<video src="/m/${url.pathname.split('/').pop()}.mp4"></video>`),
        120
      );
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const esperarFin = async id => {
  for (let i = 0; i < 200; i++) {
    const b = fondo.lista().find(x => x.id === id);
    if (b?.estado === 'fin') return b;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('no terminó');
};

test('la cola: espera, arranca sola al liberarse hueco y se puede quitar', async t => {
  const server = await crearSitio();
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => {
    server.close();
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
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

  const a = fondo.iniciar({ q: 'uno', paginas: 1 });
  const b = fondo.iniciar({ q: 'dos', paginas: 1 }, { carpeta: 'Viajes/Playa' });
  const c = fondo.iniciar({ q: 'tres', paginas: 1 });
  const estados = Object.fromEntries(fondo.lista().map(x => [x.q, x]));
  assert.equal(estados.uno.estado, 'curso');
  assert.equal(estados.dos.estado, 'cola');
  assert.equal(estados.dos.posicion, 1);
  assert.equal(estados.dos.carpeta, 'Viajes/Playa');
  assert.equal(estados.tres.posicion, 2);

  // Quitar la tercera antes de que empiece: termina como cancelada y no llega a buscar.
  const api = `http://127.0.0.1:${app.address().port}`;
  const quitada = await fetch(`${api}/api/buscar/cola/${c}`, { method: 'DELETE' });
  assert.deepEqual(await quitada.json(), { ok: true });
  const eventosC = [];
  fondo.suscribir(c, 0, e => eventosC.push(e.type));
  assert.deepEqual(eventosC, ['en_cola', 'fin']);

  const finA = await esperarFin(a);
  const finB = await esperarFin(b);
  assert.equal(finA.total, 2);
  assert.equal(finB.total, 2);
  const eventosB = [];
  fondo.suscribir(b, 0, e => eventosB.push(e));
  assert.equal(eventosB[0].type, 'en_cola');
  assert.equal(eventosB[1].type, 'inicio', 'arrancó sola, sin que nadie la relanzara');
  assert.ok(finB.terminadaEn >= finA.terminadaEn);

  // Varias de golpe (pegadas una por línea): una sola petición, todas a la cola.
  const r = await fetch(`${api}/api/buscar/varias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paginas: 1,
      busquedas: [{ q: 'cuatro', carpeta: 'A' }, { q: '' }, { q: 'cinco' }],
    }),
  });
  const cuerpo = await r.json();
  assert.equal(cuerpo.ids.length, 2);
  assert.equal(cuerpo.errores.length, 1, 'la línea vacía se rechaza y se dice');
  const cola = await (await fetch(`${api}/api/buscar/cola`)).json();
  assert.ok(cola.busquedas.some(x => x.q === 'cuatro' && x.carpeta === 'A'));
  for (const id of cuerpo.ids) await esperarFin(id);
});
