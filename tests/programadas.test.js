'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('filtrar: la misma ficha escrita de otra forma es la misma (y lo enviado, también)', () => {
  const items = [
    item('A', 'https://www.ejemplo.test/v/1/?utm_source=x', 600),
    item('A otra vez', 'http://ejemplo.test/v/1#arriba', 600),
    item('B', 'https://ejemplo.test/v/2', 600),
  ];
  const r = filtrar(items, {}, new Set(['https://www.ejemplo.test/v/2/']), []);
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://www.ejemplo.test/v/1/?utm_source=x']
  );
  assert.deepEqual(r.elegidos[0].claves, ['ejemplo.test/v/1']);
  assert.equal(r.descartes.repetido, 1);
  assert.equal(r.descartes.enviado, 1);
});

test('filtrar: el mismo vídeo en varios sitios (grupo de repetidos) se manda UNA vez', () => {
  const items = [
    {
      title: 'Corto',
      url: 'https://a.test/f/1.mp4',
      sourceUrl: 'https://a.test/v/1',
      durationSeconds: 30,
    },
    {
      title: 'Viaje',
      url: 'https://b.test/f/9.mp4',
      sourceUrl: 'https://b.test/v/9',
      durationSeconds: 600,
    },
    {
      title: 'Viaje',
      url: 'https://c.test/f/5.mp4',
      sourceUrl: 'https://c.test/v/5',
      durationSeconds: 600,
    },
    {
      title: 'Otro',
      url: 'https://c.test/f/6.mp4',
      sourceUrl: 'https://c.test/v/6',
      durationSeconds: 600,
    },
  ];
  const grupos = [
    {
      representante: 'https://a.test/f/1.mp4',
      miembros: ['https://a.test/f/1.mp4', 'https://b.test/f/9.mp4', 'https://c.test/f/5.mp4'],
    },
  ];
  // El primero del grupo no pasa la duración mínima: sale el siguiente, y solo ese.
  const r = filtrar(items, { minutosMinimo: 5 }, new Set(), [], grupos);
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://b.test/v/9', 'https://c.test/v/6']
  );
  assert.equal(r.descartes.duracion, 1);
  assert.equal(r.descartes.repetido, 1);
  // Lo que se recuerda al mandarlo es TODO el grupo (fichas y ficheros)…
  const claves = new Set(r.elegidos[0].claves);
  for (const k of ['a.test/v/1', 'b.test/v/9', 'c.test/v/5', 'c.test/f/5.mp4']) {
    assert.ok(claves.has(k), k);
  }
  // …así que en la vuelta siguiente no sale por otro sitio.
  const otra = filtrar(items, {}, claves, [], grupos);
  assert.deepEqual(
    otra.elegidos.map(e => e.link),
    ['https://c.test/v/6']
  );
  assert.equal(otra.descartes.enviado, 3, 'ningún miembro del grupo ya enviado');
});

test('lo ya enviado sale de crew.json a su propio fichero, sin perder nada', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-prog-enviados-'));
  const config = require('../src/config');
  const antes = { crew: config.crew.path, datos: config.datos.dir };
  config.crew.path = path.join(dir, 'crew.json');
  config.datos.dir = dir;
  try {
    fs.writeFileSync(
      config.crew.path,
      JSON.stringify({
        api_key: 'k',
        programadas: [{ id: 'p1', termino: 'Playa' }],
        programadasEnviados: { p1: ['https://www.ejemplo.test/v/1/', 'https://ejemplo.test/v/2'] },
      })
    );
    const { migrarEnviados, enviadosDe, quitar } = require('../src/services/programadas');
    assert.equal(await migrarEnviados(), 1);
    const crewJson = JSON.parse(fs.readFileSync(config.crew.path, 'utf8'));
    assert.equal(crewJson.programadasEnviados, undefined, 'fuera del fichero de la contraseña');
    assert.equal(crewJson.programadas.length, 1, 'lo demás, intacto');
    assert.deepEqual([...(await enviadosDe('p1'))], ['ejemplo.test/v/1', 'ejemplo.test/v/2']);
    assert.equal(await migrarEnviados(), 0, 'una vez migrado no hay nada que hacer');
    await quitar('p1');
    assert.equal((await enviadosDe('p1')).size, 0, 'quitar la programada borra lo suyo');
  } finally {
    config.crew.path = antes.crew;
    config.datos.dir = antes.datos;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
