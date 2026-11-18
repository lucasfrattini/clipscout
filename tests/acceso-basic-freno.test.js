'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// HTTP Basic cuenta los fallos igual que el formulario: mismo contador por dirección y mismo
// bloqueo. Antes Basic no contaba y permitía probar contraseñas sin límite.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-basic-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
delete process.env.ADMIN_PASSWORD;

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
  fs.rmSync(dir, { recursive: true, force: true });
});

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const conBasic = (u, p) =>
  fetch(`${base}/api/ajustes/general`, { headers: { Authorization: basic(u, p) } });
const login = (usuario, contrasena) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, contrasena }),
  });

test('Basic: tras 8 fallos se bloquea (también con la buena) y bloquea el formulario', async () => {
  const puesta = await fetch(`${base}/api/ajustes/acceso`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'playa-larga-1' }),
  });
  assert.equal(puesta.status, 200);
  assert.equal((await conBasic('ana', 'playa-larga-1')).status, 200);

  for (let i = 0; i < 8; i++) {
    assert.equal((await conBasic('ana', `mala-${i}`)).status, 401, `fallo ${i + 1}`);
  }
  const bloqueada = await conBasic('ana', 'playa-larga-1');
  assert.equal(bloqueada.status, 429, 'bloqueada: ni la buena entra');
  assert.ok(Number(bloqueada.headers.get('retry-after')) > 0);
  // Un solo contador: el formulario también queda bloqueado para esa dirección.
  assert.equal((await login('ana', 'playa-larga-1')).status, 429);
});

test('el formulario y Basic suman al mismo contador', async () => {
  // Otra app (contador nuevo) sobre el mismo crew.json, que ya tiene contraseña.
  const otro = createApp().listen(0, '127.0.0.1');
  await new Promise(r => otro.once('listening', r));
  const url = `http://127.0.0.1:${otro.address().port}`;
  try {
    const formulario = contrasena =>
      fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'ana', contrasena }),
      });
    const viaBasic = contrasena =>
      fetch(`${url}/api/ajustes/general`, { headers: { Authorization: basic('ana', contrasena) } });
    for (let i = 0; i < 4; i++) assert.equal((await formulario(`mala-${i}`)).status, 401);
    for (let i = 0; i < 4; i++) assert.equal((await viaBasic(`mala-${i}`)).status, 401);
    assert.equal((await viaBasic('playa-larga-1')).status, 429);
    assert.equal((await formulario('playa-larga-1')).status, 429);
  } finally {
    otro.close();
  }
});
