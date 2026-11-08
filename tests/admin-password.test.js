'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// Con ADMIN_PASSWORD definida, toda la app pide HTTP Basic salvo health y el protocolo clip crew.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-admin-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.ADMIN_USER = 'lucas';
process.env.ADMIN_PASSWORD = 'secreta:con:dos-puntos';

const { createApp } = require('../src/app');

let servidor;
let base;

before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USER;
});

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

test('sin credenciales o con unas malas: 401 con WWW-Authenticate', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /Basic/);
  const mala = await fetch(`${base}/api/ajustes/general`, {
    headers: { Authorization: basic('lucas', 'otra') },
  });
  assert.equal(mala.status, 401);
});

test('con las credenciales correctas entra (la contraseña puede llevar «:»)', async () => {
  const r = await fetch(`${base}/api/ajustes/general`, {
    headers: { Authorization: basic('lucas', 'secreta:con:dos-puntos') },
  });
  assert.equal(r.status, 200);
});

test('el usuario entra sin distinguir mayúsculas; la contraseña sí las distingue', async () => {
  const bien = await fetch(`${base}/api/ajustes/general`, {
    headers: { Authorization: basic('Lucas', 'secreta:con:dos-puntos') },
  });
  assert.equal(bien.status, 200);
  const mala = await fetch(`${base}/api/ajustes/general`, {
    headers: { Authorization: basic('lucas', 'SECRETA:con:dos-puntos') },
  });
  assert.equal(mala.status, 401);
});

test('health y el protocolo clip crew no piden contraseña (tienen su propia clave)', async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/crew/v1/status`)).status, 401); // pide la clave de API, no la contraseña
  const sinClave = await (await fetch(`${base}/api/crew/v1/status`)).json();
  assert.match(sinClave.detail, /Clave de API/);
});
