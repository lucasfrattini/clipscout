'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// Con ADMIN_PASSWORD definida, toda la app pide sesión salvo health y el protocolo Clipgeist.
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
const entrar = (usuario, contrasena) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, contrasena }),
  });

test('sin sesión: 401, sin pedir HTTP Basic', async () => {
  const r = await fetch(`${base}/api/ajustes/general`);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), null, 'ya no se ofrece Basic');
});

test('HTTP Basic ya no abre nada, ni con las credenciales buenas', async () => {
  const r = await fetch(`${base}/api/ajustes/general`, {
    headers: { Authorization: basic('lucas', 'secreta:con:dos-puntos') },
  });
  assert.equal(r.status, 401);
});

test('el usuario entra sin distinguir mayúsculas; la contraseña sí las distingue (y puede llevar «:»)', async () => {
  assert.equal((await entrar('Lucas', 'secreta:con:dos-puntos')).status, 200);
  assert.equal((await entrar('lucas', 'SECRETA:con:dos-puntos')).status, 401);
});

test('un navegador va a la pantalla de acceso; al entrar, la cookie abre la app', async () => {
  const html = await fetch(`${base}/`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
  assert.equal(html.status, 302);
  assert.equal(html.headers.get('location'), '/login');
  assert.equal((await fetch(`${base}/login`, { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await entrar('lucas', 'mala')).status, 401);
  const ok = await entrar('LUCAS', 'secreta:con:dos-puntos');
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.match(cookie, /^clipgeist_sesion=clipscout\.[A-Za-z0-9_-]{43}$/, 'testigo opaco');
  // La contraseña del entorno no deja rastro en ningún fichero (solo se guarda el resumen en memoria).
  for (const f of fs.readdirSync(dir)) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /secreta:con/);
  }
  const r = await fetch(`${base}/api/ajustes/general`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const falsa = await fetch(`${base}/api/ajustes/general`, {
    headers: { Cookie: `${cookie.slice(0, -1)}0` },
  });
  assert.equal(falsa.status, 401);
});

test('tras muchos fallos, el login se bloquea', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await entrar('lucas', 'mala')).status, 401);
  assert.equal((await entrar('lucas', 'secreta:con:dos-puntos')).status, 429);
});

test('health y el protocolo Clipgeist no piden contraseña (tienen su propia clave)', async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  // status es público (contrato de la suite); el resto del protocolo pide la clave, no la contraseña
  assert.equal((await fetch(`${base}/api/crew/v1/status`)).status, 200);
  assert.equal((await fetch(`${base}/api/crew/v1/conexiones`)).status, 401);
  const sinClave = await (await fetch(`${base}/api/crew/v1/conexiones`)).json();
  assert.match(sinClave.detail, /Clave de API/);
});
