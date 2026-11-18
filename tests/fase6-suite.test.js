'use strict';

/**
 * Fase 6, apartado 0: integración con la suite de Clipgeist. El interruptor «Permitir acceso desde
 * otros dispositivos» (escritorio) escribe `escuchar.txt` en la carpeta de datos y, si está la
 * suite (carpeta `suite/` al lado), también en la suya; sin usuario no deja abrir a la red.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-suite-'));
const datos = path.join(raiz, 'clipscout');
const suite = path.join(raiz, 'suite');
fs.mkdirSync(datos, { recursive: true });
process.env.DATA_DIR = datos;
process.env.CREW_PATH = path.join(datos, 'crew.json');
process.env.PROFILES_PATH = path.join(datos, 'profiles.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
process.env.CLIPGEIST_DETECTAR = 'no';
delete process.env.ADMIN_PASSWORD;
delete process.env.CLIPGEIST_CLAVE;

const { createApp } = require('../src/app');

let servidor;
let base;
before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.close();
  delete process.env.CLIPGEIST_LANZADOR;
  fs.rmSync(raiz, { recursive: true, force: true });
});

const red = (valor, cookie) =>
  fetch(`${base}/api/asistente/red`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ red: valor }),
  });

test('acceso desde la red: solo en escritorio, con usuario, y también en la suite', async () => {
  delete process.env.CLIPGEIST_LANZADOR;
  assert.equal((await red(true)).status, 409, 'en Docker o servidor no se toca');

  process.env.CLIPGEIST_LANZADOR = '1';
  const sinUsuario = await red(true);
  assert.equal(sinUsuario.status, 409);
  assert.equal((await sinUsuario.json()).codigo, 'sin_usuario');
  assert.equal(fs.existsSync(path.join(datos, 'escuchar.txt')), false);

  const alta = await fetch(`${base}/api/auth/configurar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'una-contrasena-larga' }),
  });
  assert.equal(alta.status, 200, 'alias /api/auth/configurar del primer usuario');
  const cookie = alta.headers.get('set-cookie').split(';')[0];

  // Sin suite: solo la carpeta de la app.
  let r = await red(true, cookie);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).suite, false);
  assert.equal(fs.readFileSync(path.join(datos, 'escuchar.txt'), 'utf8').trim(), 'red');
  assert.equal(fs.existsSync(suite), false, 'no crea la carpeta de la suite');

  // Con la suite instalada al lado: las dos.
  fs.mkdirSync(suite);
  r = await red(false, cookie);
  assert.equal((await r.json()).suite, true);
  assert.equal(fs.readFileSync(path.join(datos, 'escuchar.txt'), 'utf8').trim(), 'local');
  assert.equal(fs.readFileSync(path.join(suite, 'escuchar.txt'), 'utf8').trim(), 'local');
  const info = await (await fetch(`${base}/api/asistente/red`, { headers: { cookie } })).json();
  assert.equal(info.escritorio, true);
  assert.equal(info.red, false);
});
