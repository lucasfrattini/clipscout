'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const estadisticas = require('../src/services/estadisticas');
const config = require('../src/config');
const { sitiosSinResultados } = require('../src/services/busqueda');

test('sitios sin resultados en muchas búsquedas se saltan; los que dieron algo, no', async t => {
  t.mock.method(estadisticas, 'leer', async () => ({
    'muerto.example': { busquedas: 40 },
    'vivo.example': { busquedas: 40, resultados: 3 },
    'nuevo.example': { busquedas: 2 },
  }));
  const m = await sitiosSinResultados();
  assert.deepEqual([...m.entries()], [['muerto.example', 40]]);
});

test('con el mínimo a 0 no se salta ninguno', async t => {
  t.mock.method(estadisticas, 'leer', async () => ({ 'muerto.example': { busquedas: 99 } }));
  const antes = config.busqueda.minBusquedasMuerto;
  config.busqueda.minBusquedasMuerto = 0;
  try {
    assert.equal((await sitiosSinResultados()).size, 0);
  } finally {
    config.busqueda.minBusquedasMuerto = antes;
  }
});
