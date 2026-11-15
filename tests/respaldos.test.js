'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-respaldos-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.RESPALDOS_DIAS = '2';

const respaldos = require('../src/services/respaldos');
const { createApp } = require('../src/app');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const escribir = (nombre, datos) =>
  fs.writeFileSync(path.join(dir, nombre), JSON.stringify(datos), 'utf8');

test('copia diaria: una por día, se poda, y no entra busquedas.json', async () => {
  escribir('crew.json', { instancia: 'Casa' });
  escribir('profiles.json', { profiles: [{ name: 'Viajes', config: {} }] });
  escribir('busquedas.json', { busquedas: [] });
  const r = await respaldos.asegurarDiario();
  assert.equal(r.hecha, true);
  assert.deepEqual(r.ficheros.sort(), ['crew.json', 'profiles.json']);
  assert.equal((await respaldos.asegurarDiario()).hecha, false, 'la de hoy ya estaba');
  // Copias viejas: con RESPALDOS_DIAS=2 solo quedan las dos más recientes
  for (const d of ['2026-01-01', '2026-01-02']) {
    fs.mkdirSync(path.join(dir, 'respaldos', d), { recursive: true });
  }
  await respaldos.asegurarDiario({ forzar: true });
  const ids = (await respaldos.listar()).map(c => c.id);
  assert.equal(ids.length, 2);
  assert.ok(!ids.includes('2026-01-01'));
});

test('descargar y restaurar desde Ajustes (y restaurar se puede deshacer)', async t => {
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => app.close());
  const api = `http://127.0.0.1:${app.address().port}/api/ajustes/respaldos`;
  const [copia] = (await (await fetch(api)).json()).copias;

  const d = await fetch(`${api}/${copia.id}/descargar`);
  assert.match(d.headers.get('content-disposition'), /attachment/);
  const paquete = await d.json();
  assert.equal(paquete.ficheros['profiles.json'].profiles[0].name, 'Viajes');

  escribir('profiles.json', { profiles: [] });
  const r = await (await fetch(`${api}/${copia.id}/restaurar`, { method: 'POST' })).json();
  assert.ok(r.restaurados.includes('profiles.json'));
  const ahora = JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'));
  assert.equal(ahora.profiles[0].name, 'Viajes');
  const previa = (await respaldos.listar()).find(c => c.previa);
  assert.ok(previa, 'lo de antes de restaurar quedó guardado');

  // Nada de rutas construidas con lo que llega
  const malo = await fetch(`${api}/..%2F..%2Fetc/restaurar`, { method: 'POST' });
  assert.equal(malo.status, 404);
});
