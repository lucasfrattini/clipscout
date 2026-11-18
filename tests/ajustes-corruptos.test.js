'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// crew.json dañado: antes se asumía «vacío», la app quedaba SIN contraseña y la siguiente
// escritura borraba todo. Ahora: se recupera la copia .bak, y sin copia buena la app queda
// cerrada y el fichero no se toca.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-corrupto-'));
const CREW = path.join(dir, 'crew.json');
process.env.CREW_PATH = CREW;
process.env.LOGIN_RETRASO_FALLO_MS = '0';
delete process.env.ADMIN_PASSWORD;

const ROTO = '{"acceso": {"usuario": "ana", "hash": "scrypt$';
fs.writeFileSync(CREW, ROTO);

const { createApp } = require('../src/app');
const crew = require('../src/services/crew');
const { escribirJson, leerJson, ErrorIlegible } = require('../src/lib/ficheroJson');
const { crearAlmacen } = require('../src/lib/almacen');

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

const pedir = (ruta, opciones = {}) => fetch(base + ruta, { redirect: 'manual', ...opciones });

test('crew.json dañado y sin copia: la app queda CERRADA y el fichero no se toca', async () => {
  const api = await pedir('/api/ajustes/general');
  assert.equal(api.status, 503);
  assert.match((await api.json()).detail, /crew\.json/);
  assert.equal((await pedir('/', { headers: { Accept: 'text/html' } })).status, 503);
  assert.equal((await pedir('/api/auth/estado')).status, 503);
  const login = await pedir('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'x', contrasena: 'y' }),
  });
  assert.equal(login.status, 503, 'el login no da «ok» sin contraseña');
  // Quitar la contraseña o crear una nueva tampoco pasa (y no escribe nada).
  const poner = await pedir('/api/ajustes/acceso', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'intruso', contrasena: 'una-cualquiera' }),
  });
  assert.equal(poner.status, 503);
  assert.equal((await pedir('/api/health')).status, 200, 'la salud sigue respondiendo');
  assert.equal(fs.readFileSync(CREW, 'utf8'), ROTO, 'el dañado sigue intacto');
  assert.ok(!fs.readdirSync(dir).some(n => n.includes('.corrupto-')), 'sin copia no se aparta');
});

test('al arreglar el fichero, la app se recupera sola (sin reiniciar) y pide contraseña', async () => {
  fs.writeFileSync(CREW, JSON.stringify({ api_key: 'a'.repeat(32) }));
  // Sin contraseña guardada: abierta, como siempre.
  assert.equal((await pedir('/api/ajustes/general')).status, 200);
  const puesta = await pedir('/api/ajustes/acceso', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'playa-larga-1' }),
  });
  assert.equal(puesta.status, 200);
  assert.equal((await pedir('/api/ajustes/general')).status, 401);
});

test('cada escritura deja la versión anterior en .bak', async () => {
  const antes = JSON.parse(fs.readFileSync(CREW, 'utf8'));
  await crew.cambiar(d => {
    d.instancia = 'pruebas';
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${CREW}.bak`, 'utf8')), antes);
  assert.equal(JSON.parse(fs.readFileSync(CREW, 'utf8')).instancia, 'pruebas');
  assert.ok(!fs.readdirSync(dir).some(n => n.endsWith('.tmp')), 'sin temporales sueltos');
});

test('crew.json dañado con .bak bueno: se recupera la copia y el dañado se aparta', async () => {
  const bueno = JSON.parse(fs.readFileSync(CREW, 'utf8'));
  fs.writeFileSync(`${CREW}.bak`, JSON.stringify(bueno));
  fs.writeFileSync(CREW, '');
  const d = await crew.datos();
  assert.equal(d.acceso.usuario, 'ana', 'la contraseña sigue ahí');
  assert.deepEqual(JSON.parse(fs.readFileSync(CREW, 'utf8')), bueno, 'principal restaurado');
  const apartados = fs.readdirSync(dir).filter(n => n.startsWith('crew.json.corrupto-'));
  assert.equal(apartados.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, apartados[0]), 'utf8'), '');
  // Y la app sigue cerrada con su contraseña de siempre.
  assert.equal((await pedir('/api/ajustes/general')).status, 401);
});

test('leerJson: un JSON que no es un objeto tampoco vale, y sin copia lanza sin tocar nada', async () => {
  const otro = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fj-'));
  try {
    const f = path.join(otro, 'x.json');
    assert.deepEqual(await leerJson(f), { datos: null });
    fs.writeFileSync(f, 'null');
    await assert.rejects(leerJson(f), ErrorIlegible);
    assert.equal(fs.readFileSync(f, 'utf8'), 'null');
    await escribirJson(`${f}.bak`, { a: 1 });
    assert.deepEqual((await leerJson(f)).datos, { a: 1 });
  } finally {
    fs.rmSync(otro, { recursive: true, force: true });
  }
});

test('almacén (estadísticas, paquetes…): dañado con .bak → se recupera la copia', async () => {
  const otro = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-alm-'));
  try {
    const f = path.join(otro, 'datos.json');
    const almacen = crearAlmacen(
      () => f,
      () => ({ n: 0 })
    );
    await almacen.cambiar(d => {
      d.n = 1;
    });
    await almacen.cambiar(d => {
      d.n = 2;
    });
    fs.writeFileSync(f, '{"n": 2');
    assert.equal((await almacen.leer()).n, 1, 'la versión anterior, no cero');
    // Sin ninguna copia buena: se aparta el dañado (no se pisa) y se empieza de cero.
    fs.writeFileSync(f, '{roto');
    fs.writeFileSync(`${f}.bak`, '{roto');
    assert.equal((await almacen.leer()).n, 0);
    assert.ok(fs.readdirSync(otro).some(n => n.startsWith('datos.json.corrupto-')));
  } finally {
    fs.rmSync(otro, { recursive: true, force: true });
  }
});
