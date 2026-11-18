'use strict';

/**
 * CS-N8: destino de «Compartir» del móvil (Web Share Target). El manifiesto lo declara, la página
 * se sirve también sin sesión (no lleva datos) y lo compartido se reduce al enlace.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-compartir-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.ADMIN_PASSWORD = 'una-contrasena-larga';
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
  delete process.env.ADMIN_PASSWORD;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el manifiesto declara /compartir (GET con title, text y url)', async () => {
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.deepEqual(m.share_target, {
    action: '/compartir',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  });
});

test('/compartir y su script se sirven sin sesión; el resto sigue pidiéndola', async () => {
  const html = { headers: { Accept: 'text/html' }, redirect: 'manual' };
  const pagina = await fetch(`${base}/compartir?url=https%3A%2F%2Fejemplo.com%2Fv%2F1`, html);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /\/js\/compartir\.js/);
  assert.equal((await fetch(`${base}/js/compartir.js`)).status, 200);
  assert.equal((await fetch(`${base}/`, html)).status, 302, 'la app, a la pantalla de acceso');
});

test('de lo compartido se queda el enlace (o, si no hay, el texto)', async () => {
  const { enlaceCompartido } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'compartir.js')).href
  );
  assert.equal(enlaceCompartido({ url: 'https://ejemplo.com/v/1' }), 'https://ejemplo.com/v/1');
  assert.equal(
    enlaceCompartido({ title: 'Un vídeo', text: 'Mira esto: https://ejemplo.com/v/2.' }),
    'https://ejemplo.com/v/2',
    'Android lo manda dentro del texto'
  );
  assert.equal(enlaceCompartido({ text: '  Ana   Pérez ' }), 'Ana Pérez');
  assert.equal(enlaceCompartido({}), '');
});
