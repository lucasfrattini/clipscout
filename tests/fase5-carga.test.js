'use strict';

/**
 * CS-15: la carga inicial. index.html pide de una vez (modulepreload) exactamente los módulos que
 * app.js importa de forma estática: si alguien añade un import y no lo pone aquí, vuelve la
 * cascada; si quita uno y lo deja, se baja de más. Las pantallas que se abren después y los
 * diccionarios (solo el del idioma activo) no van en la carga inicial.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLICO = path.join(__dirname, '..', 'public');

function grafo(entrada) {
  const vistos = new Set();
  const visitar = fichero => {
    if (vistos.has(fichero)) return;
    vistos.add(fichero);
    const fuente = fs.readFileSync(fichero, 'utf8');
    const estaticos = [
      ...fuente.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm),
      ...fuente.matchAll(/^export\s+[^'"]*\s+from\s+['"](\.[^'"]+)['"]/gm),
    ];
    for (const m of estaticos) visitar(path.resolve(path.dirname(fichero), m[1]));
  };
  visitar(entrada);
  return [...vistos].map(f => `/${path.relative(PUBLICO, f).split(path.sep).join('/')}`);
}

test('modulepreload = el grafo estático de app.js, ni más ni menos', () => {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  const precargados = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(
    m => m[1]
  );
  const esperado = grafo(path.join(PUBLICO, 'js', 'app.js'));
  assert.deepEqual([...precargados].sort(), [...esperado].sort());
  // Ni las demás pantallas ni los diccionarios van en la carga inicial.
  for (const fuera of [
    '/js/views/ajustes.js',
    '/js/views/explorer.js',
    '/js/i18n/es.js',
    '/js/i18n/en.js',
  ]) {
    assert.ok(!esperado.includes(fuera), `${fuera} entra en la carga inicial`);
  }
});

test('el logo de la barra es el pequeño (no el de 256 px)', () => {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  assert.match(html, /cs-marca[\s\S]*?<img src="\/img\/logo-68\.png"/);
  assert.ok(fs.statSync(path.join(PUBLICO, 'img', 'logo-68.png')).size < 20 * 1024);
});
