'use strict';

// «Personas en la ficha»: al mandar a descargar, las personas que nombra la página del vídeo
// (datos estructurados y, si hay, el selector del sitio) llegan a clipkeeper con el vídeo.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nombresDeFicha,
  limpiarSelector,
  activoPara,
  completar,
} = require('../src/services/personasFicha');

const ld = datos => `<script type="application/ld+json">${JSON.stringify(datos)}</script>`;

test('saca autora y reparto de los datos estructurados, sin repetir', () => {
  const html = `<html><head>${ld({
    '@type': 'VideoObject',
    author: { '@type': 'Person', name: 'Ana Ejemplo' },
    actor: [
      { '@type': 'Person', name: 'Bea Prueba' },
      { '@type': 'Person', name: 'ana ejemplo' },
    ],
  })}</head></html>`;
  assert.deepEqual(nombresDeFicha(html), ['Ana Ejemplo', 'Bea Prueba']);
});

test('una organización no es una persona; el JSON roto se ignora', () => {
  const html = `${ld({ '@type': 'VideoObject', author: { '@type': 'Organization', name: 'Estudio' } })}
    <script type="application/ld+json">{roto</script>`;
  assert.deepEqual(nombresDeFicha(html), []);
});

test('el selector del sitio suma los nombres de su lista (sin números ni vacíos)', () => {
  const html = `${ld({ '@type': 'VideoObject', author: { '@type': 'Person', name: 'Canal Uno' } })}
    <div class="reparto"><a>Carla Uno</a><a> </a><a>78</a><a>Dora   Dos</a></div>
    <div class="relacionados"><a>Otra Que No</a></div>`;
  assert.deepEqual(nombresDeFicha(html, '.reparto a'), ['Canal Uno', 'Carla Uno', 'Dora Dos']);
});

test('un selector inválido o demasiado largo no se acepta', () => {
  assert.equal(limpiarSelector('.reparto a'), '.reparto a');
  assert.equal(limpiarSelector('a[href'), '');
  assert.equal(limpiarSelector('a'.repeat(301)), '');
  assert.equal(limpiarSelector(''), '');
});

test('completar lee solo las fichas de sitios activados y añade sus personas', async () => {
  const opciones = {
    'uno.example.com': { personasFicha: true, selectorPersonas: '.reparto a' },
    'dos.example.com': { personasFicha: false },
  };
  const pasan = [
    { link: 'https://uno.example.com/v/1', meta: { personas: ['Ya Estaba'] } },
    { link: 'https://dos.example.com/v/2', meta: {} },
    { link: 'https://uno.example.com/v/3', meta: {} },
  ];
  const leidas = [];
  const leer = async url => {
    leidas.push(url);
    if (url.endsWith('/3')) throw new Error('403');
    return '<div class="reparto"><a>Eva Tres</a></div>';
  };
  assert.equal(activoPara(pasan[0].link, opciones), true);
  assert.equal(activoPara(pasan[1].link, opciones), false);
  const n = await completar(pasan, opciones, { leer });
  assert.equal(n, 2);
  assert.deepEqual(leidas.sort(), ['https://uno.example.com/v/1', 'https://uno.example.com/v/3']);
  assert.deepEqual(pasan[0].meta.personas, ['Ya Estaba', 'Eva Tres']);
  assert.deepEqual(pasan[1].meta, {}, 'el sitio sin la opción no se toca');
  assert.deepEqual(pasan[2].meta, {}, 'si la ficha falla, el vídeo se queda como estaba');
});
