'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const ajustes = require('../src/services/ajustesBusqueda');

test('sitios a la vez: de 6 por defecto, editable (1–10) y aplicado en caliente', async () => {
  assert.equal((await ajustes.leer()).sitiosALaVez, 6);
  assert.equal((await ajustes.guardar({ sitiosALaVez: 9 })).sitiosALaVez, 9);
  assert.equal(config.busqueda.sitiosALaVez, 9);
  assert.equal((await ajustes.guardar({ sitiosALaVez: 99 })).sitiosALaVez, 10);
  assert.equal((await ajustes.guardar({ sitiosALaVez: 0 })).sitiosALaVez, 1);
  // Guardar otra cosa no lo toca.
  assert.equal((await ajustes.guardar({ webPaginas: 2 })).sitiosALaVez, 1);
});
