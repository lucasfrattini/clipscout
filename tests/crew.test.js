'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// El fichero de clip crew va a un directorio temporal ANTES de cargar la config.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-crew-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');

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
});

const json = async (ruta, opciones = {}) => {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  });
  return { status: r.status, body: await r.json() };
};

test('status exige la clave y responde con la identidad de clipscout', async () => {
  const { body: general } = await json('/api/ajustes/general');
  assert.match(general.api_key, /^[0-9a-f]{32}$/);
  assert.equal((await json('/api/crew/v1/status')).status, 401);
  assert.equal(
    (await json('/api/crew/v1/status', { headers: { 'X-Api-Key': 'mala' } })).status,
    401
  );
  const { status, body } = await json('/api/crew/v1/status', {
    headers: { 'X-Api-Key': general.api_key },
  });
  assert.equal(status, 200);
  assert.equal(body.crew, 'clip crew');
  assert.equal(body.app, 'clipscout');
  assert.equal(body.protocolo, 1);
});

test('ajustes generales y regenerar la clave', async () => {
  const r = await json('/api/ajustes/general', {
    method: 'PUT',
    body: JSON.stringify({ instancia: 'Buscador', url: `${base}/` }),
  });
  assert.equal(r.status, 200);
  const { body: g } = await json('/api/ajustes/general');
  assert.equal(g.instancia, 'Buscador');
  assert.equal(g.url, base);
  const malo = await json('/api/ajustes/general', {
    method: 'PUT',
    body: JSON.stringify({ url: 'ftp://x' }),
  });
  assert.equal(malo.status, 400);
  assert.match(malo.body.detail, /http/);
  const vieja = g.api_key;
  const { body: nueva } = await json('/api/ajustes/api-key', { method: 'POST', body: '{}' });
  assert.notEqual(nueva.api_key, vieja);
  assert.equal(
    (await json('/api/crew/v1/status', { headers: { 'X-Api-Key': vieja } })).status,
    401
  );
});

test('probar, conectar, listar sin claves y quitar', async () => {
  const { body: g } = await json('/api/ajustes/general');
  const probar = datos =>
    json('/api/ajustes/conexiones/probar', {
      method: 'POST',
      body: JSON.stringify({ app: 'clipscout', url: base, api_key: g.api_key, ...datos }),
    });
  assert.match((await probar({ api_key: 'mala' })).body.error, /clave/);
  assert.match((await probar({ app: 'clonbuster' })).body.error, /clipscout/);
  assert.match((await probar({ url: 'http://127.0.0.1:9' })).body.error, /conectar|responde/);
  assert.equal((await probar({})).body.ok, true);

  // Conectarse consigo mismo sirve para probar el alta y la vuelta sin otra app.
  const alta = await json('/api/ajustes/conexiones', {
    method: 'POST',
    body: JSON.stringify({ app: 'clipscout', url: base, api_key: g.api_key }),
  });
  assert.equal(alta.status, 200);
  assert.equal(alta.body.prueba.ok, true);
  assert.deepEqual(alta.body.reciproca, { ok: true });
  const { body: lista } = await json('/api/ajustes/conexiones');
  assert.equal(lista.length, 1, 'la vuelta a la misma URL no duplica');
  assert.equal(lista[0].api_key, undefined, 'la clave nunca sale por la API');
  const estado = await json(`/api/ajustes/conexiones/${lista[0].id}/estado`);
  assert.equal(estado.body.ok, true);
  await json(`/api/ajustes/conexiones/${lista[0].id}`, { method: 'DELETE' });
  assert.deepEqual((await json('/api/ajustes/conexiones')).body, []);
});

test('«¿ya lo tengo?» sin clipkeeper conectado lo dice, sin fallar', async () => {
  const r = await json('/api/ajustes/ya-lo-tengo', {
    method: 'POST',
    body: JSON.stringify({ titulos: ['algo'], duraciones: [null] }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.conectado, false);
});
