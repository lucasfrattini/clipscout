'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const duraciones = require('../src/services/duraciones');
const cacheFichas = require('../src/services/cacheFichas');

/**
 * La duración que falta se pide después a la ficha (petición ligera, aquí simulada) y llega como
 * evento `duracion`. Sin relajar las reglas de relevancia: nada para los dudosos, y la duración
 * de la página solo si la ficha tiene un fichero.
 */

const ficha = (n, html) => ({
  url: `https://ejemplo.com/m/${n}.mp4`,
  sourceUrl: `https://ejemplo.com/v/${n}`,
  html,
});

test('rellena la que falta, no la de los dudosos ni la de página en un álbum', async () => {
  cacheFichas.vaciar();
  const paginas = new Map([
    ['https://ejemplo.com/v/1', '<meta property="video:duration" content="427">'],
    ['https://ejemplo.com/v/album', '<meta property="video:duration" content="900">'],
  ]);
  const pedidas = [];
  const eventos = [];
  const c = duraciones.crear({
    publicar: e => eventos.push(e),
    buscar: async url => {
      pedidas.push(url);
      return paginas.get(url) || '';
    },
  });
  const uno = ficha(1);
  c.anotar([
    { ...uno, durationSeconds: null },
    // dudoso: no se busca
    {
      url: 'https://ejemplo.com/m/x_preview.mp4',
      sourceUrl: 'https://ejemplo.com/v/2',
      suspect: true,
    },
    // ya tiene duración: no se busca
    {
      url: 'https://ejemplo.com/m/3.mp4',
      sourceUrl: 'https://ejemplo.com/v/3',
      durationSeconds: 60,
    },
    // álbum: dos ficheros de la misma ficha; la duración de página no vale para ninguno
    { url: 'https://ejemplo.com/m/a1.mp4', sourceUrl: 'https://ejemplo.com/v/album' },
    { url: 'https://ejemplo.com/m/a2.mp4', sourceUrl: 'https://ejemplo.com/v/album' },
  ]);
  // la misma ficha otra vez no se vuelve a pedir
  c.anotar([{ ...uno, durationSeconds: null }]);
  await c.esperar(2000);
  assert.deepEqual(pedidas.sort(), ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/album']);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0], {
    type: 'duracion',
    items: [{ url: uno.url, sourceUrl: uno.sourceUrl, durationSeconds: 427, duration: '7:07' }],
  });
});

test('con tope por búsqueda, y un fallo de la ficha no rompe nada', async t => {
  const config = require('../src/config');
  const antes = config.duraciones.maxPorBusqueda;
  config.duraciones.maxPorBusqueda = 2;
  t.after(() => {
    config.duraciones.maxPorBusqueda = antes;
  });
  const pedidas = [];
  const c = duraciones.crear({
    publicar: () => {},
    buscar: async url => {
      pedidas.push(url);
      throw new Error('caída');
    },
  });
  c.anotar([1, 2, 3, 4].map(n => ficha(n)));
  await c.esperar(2000);
  assert.equal(pedidas.length, 2);
  assert.equal(c.lanzadas, 2);
});
