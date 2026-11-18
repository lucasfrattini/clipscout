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

// La interfaz manda «X-Clipgeist: 1» en todas sus llamadas (public/js/api.js). Los tests hacen de
// interfaz: el fetch de Node la lleva por defecto. Los que prueban el rechazo de peticiones de
// otras webs usan `globalThis.fetchSinCabecera`.
const fetchOriginal = globalThis.fetch;
globalThis.fetchSinCabecera = fetchOriginal;
globalThis.fetch = (url, opciones = {}) => {
  const cabeceras = new Headers(opciones.headers || {});
  if (!cabeceras.has('X-Clipgeist')) cabeceras.set('X-Clipgeist', '1');
  return fetchOriginal(url, { ...opciones, headers: cabeceras });
};

// Ninguna prueba sale a clipgeist.com (SU-13): el fichero de versiones apunta a un puerto cerrado
// salvo que el test monte su propio servidor. Lo heredan también los server.js que arrancan.
if (!process.env.CLIPGEIST_VERSIONES_URL) {
  process.env.CLIPGEIST_VERSIONES_URL = 'http://127.0.0.1:9/versiones.json';
}

if (!process.env.CREW_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-test-'));
  process.env.CREW_PATH = path.join(dir, 'crew.json');
}
