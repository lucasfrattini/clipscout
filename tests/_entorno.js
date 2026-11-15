'use strict';

/**
 * Se carga antes de cada fichero de test (ver "test" en package.json). Los tests no deben leer
 * el data/crew.json real del que los ejecuta: si ese clipscout tiene contraseña, las rutas de la
 * interfaz piden sesión y los tests de API fallan aunque el código esté bien. Cada proceso de test
 * usa su propio crew.json temporal, salvo que el test fije otro.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.CREW_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-test-'));
  process.env.CREW_PATH = path.join(dir, 'crew.json');
}
