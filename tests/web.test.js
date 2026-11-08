'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { consultaSite, hostDe } = require('../src/services/web');

test('búsqueda web: dominio y «site:» desde la configuración guardada', () => {
  assert.equal(hostDe('https://www.ejemplo.com/search?q={q}&p={page:02}'), 'ejemplo.com');
  // Con un prefijo literal de ruta se afina a las fichas
  assert.equal(
    consultaSite('Ana', 'https://www.ejemplo.com/search?q={q}', '/a/'),
    'site:ejemplo.com/a/ Ana'
  );
  // Con una expresión regular, solo el dominio
  assert.equal(
    consultaSite('Ana', 'https://ejemplo.com/m/{q}', '/\\/[0-9a-f]{8}-/'),
    'site:ejemplo.com Ana'
  );
  assert.equal(consultaSite('Ana', 'https://ejemplo.com/?s={q}', ''), 'site:ejemplo.com Ana');
});
