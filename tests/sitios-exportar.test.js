'use strict';

/** «Descargar configuración» y «Subir configuración» de Ajustes → Sitios: ida y vuelta. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-sitios-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
const CLAVE = '0123456789abcdef0123456789abcdef';
fs.writeFileSync(process.env.CREW_PATH, JSON.stringify({ api_key: CLAVE, instancia: 'clipscout' }));

const { createApp } = require('../src/app');

let base;
let servidor;
test.before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

const pedir = (ruta, opciones = {}) =>
  fetch(base + ruta, {
    ...opciones,
    headers: {
      'X-Api-Key': CLAVE,
      'Content-Type': 'application/json',
      ...(opciones.headers || {}),
    },
  });

const perfil = (nombre, host, extra = {}) => ({
  name: nombre,
  config: { searchUrl: `https://${host}/buscar?q={q}`, linkPattern: '/video/', ...extra },
});

test('exportar y volver a importar: suma lo nuevo, salta lo que ya hay y reemplaza si se pide', async () => {
  await pedir('/api/profiles', {
    method: 'PUT',
    body: JSON.stringify({
      profiles: [
        perfil('Uno', 'uno.example.com'),
        perfil('Dos', 'dos.example.com', { fichaComoFichero: true }),
      ],
    }),
  });
  const r = await pedir('/api/sitios/exportar');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="clipscout-sitios-/);
  const exportado = await r.json();
  assert.equal(exportado.formato, 'clipscout-sitios');
  assert.equal(exportado.sitios.length, 2);
  assert.equal(exportado.sitios[1].config.fichaComoFichero, true);
  assert.ok(!JSON.stringify(exportado).includes(CLAVE));

  // Otro equipo con solo «Uno», que lo tiene distinto.
  await pedir('/api/profiles', {
    method: 'PUT',
    body: JSON.stringify({
      profiles: [perfil('Uno mío', 'uno.example.com', { linkPattern: '/v/' })],
    }),
  });
  let i = await (
    await pedir('/api/sitios/importar', { method: 'POST', body: JSON.stringify(exportado) })
  ).json();
  assert.deepEqual([i.anadidos, i.saltados, i.total], [1, 1, 2]);
  let perfiles = (await (await pedir('/api/profiles')).json()).profiles;
  assert.equal(perfiles[0].config.linkPattern, '/v/'); // lo propio no se pisa
  i = await (
    await pedir('/api/sitios/importar?reemplazar=1', {
      method: 'POST',
      body: JSON.stringify(exportado),
    })
  ).json();
  assert.equal(i.actualizados, 2);
  perfiles = (await (await pedir('/api/profiles')).json()).profiles;
  assert.equal(perfiles[0].name, 'Uno mío');
  assert.equal(perfiles[0].config.linkPattern, '/video/');

  const malo = await pedir('/api/sitios/importar', {
    method: 'POST',
    body: JSON.stringify({ sitios: [] }),
  });
  assert.equal(malo.status, 400);
});
