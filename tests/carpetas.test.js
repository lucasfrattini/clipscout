'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const cargar = () => import(pathToFileURL(path.join(__dirname, '../public/js/carpetas.js')).href);

const catalogo = {
  personas: [
    { nombre: 'Ana Pérez', rol: 'actriz' },
    { nombre: 'Canal Viajes', rol: 'artista' },
  ],
  etiquetas: [
    { nombre: 'Playa', grupo: 'Tipo' },
    { nombre: 'Chile', grupo: 'Etiqueta' },
  ],
};

test('una persona del catálogo sin carpeta propia también se propone', async () => {
  const { nombresCarpeta } = await cargar();
  const n = nombresCarpeta({
    tipo: 'artista',
    raiz: 'People',
    existentes: ['People/Otra'],
    catalogo,
  });
  assert.deepEqual(n, ['Canal Viajes', 'Otra']);
});

test('no repite por mayúsculas, gana la carpeta y filtra por lo escrito', async () => {
  const { nombresCarpeta } = await cargar();
  const existentes = ['People/ANA PÉREZ', 'People/Luz', 'People/Luz/sub'];
  assert.deepEqual(nombresCarpeta({ tipo: 'actriz', raiz: 'People', existentes, catalogo }), [
    'ANA PÉREZ',
    'Luz',
  ]);
  assert.deepEqual(
    nombresCarpeta({ tipo: 'actriz', raiz: 'People', existentes, catalogo, filtro: 'pér' }),
    ['ANA PÉREZ']
  );
});

test('categoría y etiqueta salen de su propio grupo', async () => {
  const { nombresCarpeta } = await cargar();
  assert.deepEqual(nombresCarpeta({ tipo: 'categoria', raiz: 'Categories', catalogo }), ['Playa']);
  assert.deepEqual(nombresCarpeta({ tipo: 'etiqueta', raiz: 'Unsorted', catalogo }), ['Chile']);
});
