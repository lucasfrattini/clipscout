'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-parar-'));
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_FONDO_MAX_ACTIVAS = '1';

const fondo = require('../src/services/busquedasFondo');

/**
 * «Parar» con un sitio que no responde (como con el proxy de salida caído): la búsqueda se da por
 * parada AL INSTANTE (evento `fin` con `parada`), lo que aún llegue no se publica, y la siguiente
 * de la cola no arranca hasta que las peticiones en vuelo se han cortado.
 */
test('parar: fin inmediato aunque el sitio no responda; la cola espera al corte', async t => {
  const colgadas = new Set();
  const server = http.createServer((req, res) => {
    colgadas.add(res); // nunca responde
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    for (const res of colgadas) res.destroy();
    server.closeAllConnections?.();
    server.close();
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
  const b = fondo.iniciar({ q: 'dos', paginas: 1 });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(fondo.lista().find(x => x.id === a).estado, 'curso');

  const antes = Date.now();
  assert.equal(fondo.parar(a), true);
  const tras = fondo.lista().find(x => x.id === a);
  assert.equal(tras.estado, 'fin', 'parada en el acto');
  assert.ok(Date.now() - antes < 100);

  const eventos = [];
  fondo.suscribir(a, 0, e => eventos.push(e));
  const fin = eventos.filter(e => e.type === 'fin');
  assert.equal(fin.length, 1);
  assert.equal(fin[0].parada, true);
  assert.equal(fin[0].cancelada, true);

  // Parar dos veces no publica otro fin.
  fondo.parar(a);
  const eventos2 = [];
  fondo.suscribir(a, 0, e => eventos2.push(e));
  assert.equal(eventos2.filter(e => e.type === 'fin').length, 1);

  // La siguiente arranca en cuanto se cortan las peticiones de la parada (no 30 s después).
  for (let i = 0; i < 100 && fondo.lista().find(x => x.id === b).estado === 'cola'; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(fondo.lista().find(x => x.id === b).estado, 'curso');
  fondo.parar(b);
  assert.equal(fondo.lista().find(x => x.id === b).estado, 'fin');
});
