'use strict';

/**
 * CS-N5: avisos. Programada con resultados o con error, paquete terminado o fallido, sitio roto
 * (al cruzar el umbral, una vez) y búsqueda larga terminada; la API para leerlos y marcarlos.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-avisos-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
delete process.env.ADMIN_PASSWORD;
delete process.env.CLIPGEIST_CLAVE;

const avisos = require('../src/services/avisos');
const estadisticas = require('../src/services/estadisticas');
const { createApp } = require('../src/app');

let servidor;
let base;
before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anotar, listar después de N, sin leer y marcar leídos; tipos desconocidos no', async () => {
  assert.equal(await avisos.anotar('inventado', {}), null);
  const a = await avisos.anotar('programada', { termino: 'playa', n: 3 });
  const b = await avisos.anotar('paquete_fallido', { nombre: 'Lote', carpeta: 'X' });
  assert.equal(b.id, a.id + 1);
  let r = await (await fetch(`${base}/api/avisos`)).json();
  assert.deepEqual(
    r.avisos.map(x => x.tipo),
    ['paquete_fallido', 'programada']
  );
  assert.equal(r.sinLeer, 2);
  r = await (await fetch(`${base}/api/avisos?desde=${a.id}`)).json();
  assert.deepEqual(
    r.avisos.map(x => x.id),
    [b.id]
  );
  await fetch(`${base}/api/avisos/leidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hasta: a.id }),
  });
  assert.equal((await avisos.listar()).sinLeer, 1);
  await fetch(`${base}/api/avisos/leidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal((await avisos.listar()).sinLeer, 0);
});

test('sitio roto: un aviso al llegar a dos búsquedas seguidas sin nada, no en cada una', async () => {
  const antes = (await avisos.listar()).ultimo;
  for (let i = 0; i < 4; i += 1) {
    estadisticas.anotarSalud('roto.example', { total: 0, error: '' });
    await estadisticas.leer();
  }
  const nuevos = (await avisos.listar({ desde: antes })).avisos;
  assert.deepEqual(
    nuevos.map(x => [x.tipo, x.params.dominio]),
    [['sitio_roto', 'roto.example']]
  );
});

test('se queda con los últimos 100', async () => {
  for (let i = 0; i < 105; i += 1) {
    await avisos.anotar('busqueda_terminada', { q: `q${i}`, total: i });
  }
  const r = await avisos.listar();
  assert.equal(r.avisos.length, 100);
  assert.equal(r.avisos[0].params.q, 'q104');
});
