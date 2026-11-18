'use strict';

/** CS-N9: historial de búsquedas (servidor), para repetir con un toque. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-historial-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');

const historial = require('../src/services/historial');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('la misma búsqueda escrita de otra forma es una, sube arriba y cuenta las veces', async () => {
  await historial.apuntar('Playa  Norte');
  await historial.apuntar('montaña');
  await historial.apuntar('playa norte');
  await historial.apuntar('   ');
  const { busquedas } = await historial.listar();
  assert.deepEqual(
    busquedas.map(b => [b.q, b.veces]),
    [
      ['playa norte', 2],
      ['montaña', 1],
    ]
  );
});

test('como mucho 30; se borra una o todo', async () => {
  for (let i = 0; i < 35; i += 1) await historial.apuntar(`q${i}`);
  assert.equal((await historial.listar()).busquedas.length, historial.MAX);
  await historial.borrar('Q34');
  assert.equal((await historial.listar()).busquedas[0].q, 'q33');
  await historial.borrar();
  assert.deepEqual((await historial.listar()).busquedas, []);
});
