'use strict';

/**
 * Sesión común de Clipgeist: el mismo vector está en los tests de clipkeeper y clonbuster, así
 * que si las tres firman igual, una sesión abierta en cualquiera vale en las otras dos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { firmarSesion } = require('../src/services/acceso');

test('mismo token que clipkeeper y clonbuster', () => {
  assert.equal(
    firmarSesion('Luquitas', 'scrypt$00ff$aabb', 4102444800),
    '4102444800.5cde53e914f9eb4ff62b69bc534d6e079b10d6ae3133bdefd347973b94f3a796'
  );
});
