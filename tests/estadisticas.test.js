'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-estad-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';

const estadisticas = require('../src/services/estadisticas');
const { buscarEnTodos } = require('../src/services/busqueda');
const { createApp } = require('../src/app');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('se acumula por dominio y se guarda en disco', async () => {
  estadisticas.sumarEnlace('https://www.ejemplo.com/v/1', { enviadosJd: 1 });
  estadisticas.sumarEnlace('https://ejemplo.com/v/2', { enviadosJd: 1, fallidosJd: 1 });
  estadisticas.sumar('ejemplo.com', { inventado: 5 });
  const s = await estadisticas.leer();
  assert.equal(s['ejemplo.com'].enviadosJd, 2);
  assert.equal(s['ejemplo.com'].fallidosJd, 1);
  assert.equal(s['ejemplo.com'].inventado, undefined, 'solo los campos conocidos');
  const enDisco = JSON.parse(fs.readFileSync(path.join(dir, 'estadisticas.json'), 'utf8'));
  assert.equal(enDisco.sitios['ejemplo.com'].enviadosJd, 2);
  await estadisticas.ponerACero();
  assert.deepEqual(await estadisticas.leer(), {});
});

test('cada búsqueda suma por sitio: resultados, con duración; Ajustes los enseña', async t => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url.startsWith('/buscar')) return res.end('<a href="/v/1">1</a><a href="/v/2">2</a>');
    const n = req.url.split('/').pop();
    return res.end(
      `<video src="/m/${n}.mp4"></video>${n === '1' ? '<span class="duration">5:00</span>' : ''}`
    );
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => {
    server.close();
    app.close();
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
  await buscarEnTodos({ q: 'playa', paginas: 1 });
  await buscarEnTodos({ q: 'fotos', paginas: 1 }, { contar: false });
  const r = await (await fetch(`http://127.0.0.1:${app.address().port}/api/ajustes/sitios`)).json();
  assert.deepEqual(
    {
      busquedas: r.sitios[0].estadisticas.busquedas,
      resultados: r.sitios[0].estadisticas.resultados,
      conDuracion: r.sitios[0].estadisticas.conDuracion,
    },
    { busquedas: 1, resultados: 2, conDuracion: 1 }
  );
});
