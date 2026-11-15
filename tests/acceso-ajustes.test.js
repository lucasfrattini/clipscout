'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// Contraseña puesta desde Ajustes → Acceso (como en clipkeeper y clonbuster), sin ADMIN_PASSWORD.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-acceso-'));
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

const pedir = (ruta, { metodo = 'GET', cuerpo, cookie, cabeceras = {} } = {}) =>
  fetch(base + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...cabeceras,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
const cookieDe = r => (r.headers.get('set-cookie') || '').split(';')[0];

test('sin contraseña todo pasa; poner una exige 8 caracteres', async () => {
  assert.equal((await pedir('/api/ajustes/general')).status, 200);
  assert.deepEqual(await (await pedir('/api/auth/estado')).json(), {
    protegido: false,
    delEntorno: false,
    usuario: '',
  });
  const corta = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cuerpo: { usuario: 'ana', contrasena: 'corta' },
  });
  assert.equal(corta.status, 400);
});

test('con contraseña: login, sesión, Basic, X-Api-Key, cambio y quitarla', async () => {
  const puesta = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cuerpo: { usuario: 'Ana', contrasena: 'playa-larga-1' },
  });
  assert.equal(puesta.status, 200);
  const sesion1 = cookieDe(puesta);
  assert.match(sesion1, /^clipgeist_sesion=/, 'quien la pone sigue dentro');
  assert.doesNotMatch(fs.readFileSync(process.env.CREW_PATH, 'utf8'), /playa-larga-1/);

  // Sin nada: 401 (API) o a /login (navegador)
  assert.equal((await pedir('/api/ajustes/general')).status, 401);
  const nav = await pedir('/', { cabeceras: { Accept: 'text/html' } });
  assert.equal(nav.status, 302);
  assert.equal(nav.headers.get('location'), '/login');

  const login = await pedir('/api/auth/login', {
    metodo: 'POST',
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
  });
  assert.equal(login.status, 200);
  const sesion2 = cookieDe(login);
  assert.equal((await pedir('/api/ajustes/general', { cookie: sesion2 })).status, 200);
  const basic = `Basic ${Buffer.from('ana:playa-larga-1').toString('base64')}`;
  assert.equal(
    (await pedir('/api/ajustes/general', { cabeceras: { Authorization: basic } })).status,
    200
  );
  const clave = (await (await pedir('/api/ajustes/general', { cookie: sesion2 })).json()).api_key;
  assert.equal(
    (await pedir('/api/ajustes/general', { cabeceras: { 'X-Api-Key': clave } })).status,
    200,
    'la clave de API vale para la API, como en las *arr'
  );

  // Cambiarla pide la actual y cierra las demás sesiones
  const sinActual = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cookie: sesion2,
    cuerpo: { usuario: 'ana', contrasena: 'montana-nevada' },
  });
  assert.equal(sinActual.status, 400);
  const cambio = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cookie: sesion2,
    cuerpo: { usuario: 'ana', contrasena: 'montana-nevada', actual: 'playa-larga-1' },
  });
  assert.equal(cambio.status, 200);
  const sesion3 = cookieDe(cambio);
  assert.equal((await pedir('/api/ajustes/general', { cookie: sesion1 })).status, 401);
  assert.equal((await pedir('/api/ajustes/general', { cookie: sesion3 })).status, 200);

  // Quitarla (pide la actual): vuelve a estar abierta
  const quitar = await pedir('/api/ajustes/acceso/quitar', {
    metodo: 'POST',
    cookie: sesion3,
    cuerpo: { actual: 'montana-nevada' },
  });
  assert.equal(quitar.status, 200);
  assert.equal((await pedir('/api/ajustes/general')).status, 200);
});
