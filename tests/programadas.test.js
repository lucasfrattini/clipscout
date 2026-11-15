'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filtrar, toca } = require('../src/services/programadas');

const item = (title, link, durationSeconds) => ({ title, sourceUrl: link, durationSeconds });

test('filtrar: duración mínima, y los que no dicen cuánto duran solo si se pide', () => {
  const items = [
    item('Viaje largo', 'https://ejemplo.com/v/1', 900),
    item('Viaje corto', 'https://ejemplo.com/v/2', 60),
    item('Viaje sin dato', 'https://ejemplo.com/v/3', null),
  ];
  const base = { minutosMinimo: 3 };
  assert.deepEqual(
    filtrar(items, base).elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
  assert.deepEqual(
    filtrar(items, { ...base, sinDuracion: true }).elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/3']
  );
  // Sin mínimo no se descarta nada por duración
  assert.equal(filtrar(items, {}).elegidos.length, 3);
});

test('filtrar: debe contener alguna, descarta con una, sin tildes ni guiones', () => {
  const items = [
    item('Día de playa', 'https://ejemplo.com/v/1', 600),
    item('Otra cosa', 'https://ejemplo.com/v/montana-nevada', 600),
    item('Playa — tráiler', 'https://ejemplo.com/v/3', 600),
    item('Ciudad', 'https://ejemplo.com/v/4', 600),
  ];
  const r = filtrar(items, { contener: 'playa, montaña', excluir: 'trailer' });
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/montana-nevada']
  );
  assert.equal(r.descartes.excluir, 1);
  assert.equal(r.descartes.contener, 1);
});

test('filtrar: una ficha una vez, y lo ya enviado no se repite', () => {
  const items = [
    item('A', 'https://ejemplo.com/v/1', 600),
    item('A (otro fichero de la misma ficha)', 'https://ejemplo.com/v/1', 600),
    item('B', 'https://ejemplo.com/v/2', 600),
  ];
  const r = filtrar(items, {}, new Set(['https://ejemplo.com/v/2']));
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
  assert.equal(r.descartes.repetido, 1);
  assert.equal(r.descartes.enviado, 1);
});

test('toca: nunca ejecutada, a los N días, y nunca si está pausada', () => {
  const ahora = Date.parse('2026-01-10T12:00:00Z');
  assert.equal(toca({ activa: true, ultimaVez: null, cadaDias: 7 }, ahora), true);
  assert.equal(
    toca({ activa: true, ultimaVez: '2026-01-05T12:00:00Z', cadaDias: 7 }, ahora),
    false
  );
  assert.equal(toca({ activa: true, ultimaVez: '2026-01-03T12:00:00Z', cadaDias: 7 }, ahora), true);
  assert.equal(toca({ activa: false, ultimaVez: null, cadaDias: 7 }, ahora), false);
});

test('la web abierta queda desactivada salvo que se marque (también en las ya guardadas)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-prog-abierta-'));
  const config = require('../src/config');
  const antes = config.crew.path;
  config.crew.path = path.join(dir, 'crew.json');
  try {
    const { guardar } = require('../src/services/programadas');
    const nueva = await guardar({ termino: 'Playa' });
    assert.equal(nueva.abierta, false);
    const marcada = await guardar({ termino: 'Montaña', abierta: true });
    assert.equal(marcada.abierta, true);
    // Editar otra cosa no la desmarca
    assert.equal((await guardar({ id: marcada.id, cadaDias: 3 })).abierta, true);
  } finally {
    config.crew.path = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
