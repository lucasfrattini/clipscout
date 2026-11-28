'use strict';

/** Vista previa de un resultado: de dónde saca el vídeo y a qué fichas se niega. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-previa-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
const CLAVE = '0123456789abcdef0123456789abcdef';
fs.writeFileSync(process.env.CREW_PATH, JSON.stringify({ api_key: CLAVE, instancia: 'clipscout' }));
fs.writeFileSync(
  process.env.PROFILES_PATH,
  JSON.stringify([{ name: 'Uno', config: { searchUrl: 'https://uno.example.com/buscar?q={q}' } }])
);

const { createApp } = require('../src/app');
const { videosEnHtml } = require('../src/services/vistaPrevia');

let base;
let servidor;
test.before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

const pedir = ruta => fetch(base + ruta, { headers: { 'X-Api-Key': CLAVE } });

test('saca del HTML las listas HLS y los ficheros, también escapados en JSON, HLS primero', () => {
  const html = `<source src="https://cdn.example.net/v/1.mp4?t=1&amp;e=2">
    <script>var d={"hls":"https:\\/\\/cdn.example.net\\/v\\/1\\/master.m3u8?k=9"}</script>
    <a href="https://cdn.example.net/v/1.mp4?t=1&e=2">otra vez</a>`;
  assert.deepEqual(videosEnHtml(html, 'https://uno.example.com/v/1'), [
    'https://cdn.example.net/v/1/master.m3u8?k=9',
    'https://cdn.example.net/v/1.mp4?t=1&e=2',
  ]);
  assert.deepEqual(videosEnHtml('<p>nada</p>', 'https://uno.example.com/'), []);
});

test('sin dirección, 400; de un sitio que no está configurado, 403', async () => {
  assert.equal((await pedir('/api/vista-previa')).status, 400);
  const r = await pedir(
    `/api/vista-previa?url=${encodeURIComponent('https://ajeno.example.org/v/1')}`
  );
  assert.equal(r.status, 403);
  assert.equal(
    (await pedir(`/api/vista-previa?url=${encodeURIComponent('file:///etc/passwd')}`)).status,
    403
  );
});
