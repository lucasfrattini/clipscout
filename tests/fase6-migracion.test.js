'use strict';

/**
 * Fase 6 sobre datos de la 2.23.0: las programadas de antes (sin `n`, `soloConNombre` ni `orden`)
 * siguen igual, y un crew.json sin `proxySalida` deja el proxy como estaba (el del entorno).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-migra6-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');

// Un crew.json como lo deja la 2.23.0 (programada de entonces, sin campos nuevos).
const PROG = {
  id: 'p-1',
  termino: 'playa',
  carpeta: 'Categories/Playa',
  persona: '',
  etiqueta: 'Playa',
  minutosMinimo: 5,
  sinDuracion: false,
  contener: '',
  excluir: 'trailer',
  cadaDias: 7,
  abierta: false,
  activa: true,
  ultimaVez: '2026-11-10T10:00:00.000Z',
  ultimo: { fecha: '2026-11-10T10:00:00.000Z', encontrados: 40, enviados: 3, error: null },
};
fs.writeFileSync(
  process.env.CREW_PATH,
  JSON.stringify({ api_key: 'a'.repeat(32), programadas: [PROG], busqueda: { sinProxy: [] } })
);

const programadas = require('../src/services/programadas');
const proxySalida = require('../src/services/proxySalida');
const config = require('../src/config');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('una programada de la 2.23.0 se lee y se guarda sin cambiar lo que hace', async () => {
  const { programadas: lista } = await programadas.listar();
  assert.deepEqual(lista[0], PROG, 'leer no toca nada');
  const guardada = await programadas.guardar({ id: 'p-1', activa: false });
  assert.equal(guardada.n, 0, 'sin tope: todo lo nuevo, como antes');
  assert.equal(guardada.soloConNombre, false);
  assert.equal(guardada.orden, null, 'el orden de la búsqueda, como antes');
  assert.equal(guardada.ultimaVez, PROG.ultimaVez);
  assert.deepEqual(guardada.ultimo, PROG.ultimo);
  // Y la elección es la de siempre: todo lo que pasa los filtros, en el orden de llegada.
  const items = [
    { url: 'https://ejemplo.com/v/1', title: 'otra cosa', durationSeconds: 400 },
    { url: 'https://ejemplo.com/v/2', title: 'trailer', durationSeconds: 400 },
    { url: 'https://ejemplo.com/v/3', title: 'corto', durationSeconds: 60 },
  ];
  assert.deepEqual(
    programadas.filtrar(items, guardada, new Set(), []).elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
});

test('sin proxySalida en crew.json, el proxy sigue siendo el del entorno', async () => {
  await proxySalida.cargarGuardado();
  assert.equal(config.outboundProxy, '');
  assert.equal(proxySalida.leer().origen, '');
});
