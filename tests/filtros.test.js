'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-filtros-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');

const servidor = require('../src/lib/filtros');
const filtrosGlobales = require('../src/services/filtrosGlobales');
const { filtrar } = require('../src/services/programadas');
const { marcar } = require('../src/services/busquedasFondo');
const { createApp } = require('../src/app');

const MODULO = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'filtros.js')).href;

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const CASOS = [
  'Año-Nuevo en la PLAYA',
  'ÁRBOL_de__navidad',
  '  dos   espacios ',
  'https://ejemplo.com/v/montana-nevada_720p',
  '',
  null,
  'Ünïcödé çañón',
];

test('el espejo del navegador normaliza y separa igual que el servidor', async () => {
  const front = await import(MODULO);
  for (const c of CASOS) {
    assert.equal(front.normalizar(c), servidor.normalizar(c), `normalizar(${c})`);
    assert.deepEqual(front.palabras(c), servidor.palabras(c), `palabras(${c})`);
  }
  assert.deepEqual(front.palabras('uno, Dos-Tres\ncuatro'), ['uno', 'dos tres', 'cuatro']);
  const item = { title: 'Día de Playa', sourceUrl: 'https://ejemplo.com/v/1', url: 'x' };
  assert.equal(front.textoDe(item), servidor.textoDe(item));
  assert.equal(
    front.contieneAlguna(front.textoDe(item), ['montana', 'dia de']),
    servidor.contieneAlguna(servidor.textoDe(item), ['montana', 'dia de'])
  );
});

test('idioma probable: claro cuando hay palabras frecuentes, dudoso si no', () => {
  const idioma = title => servidor.idiomaProbable({ title, url: 'https://ejemplo.com/v/1' });
  assert.equal(idioma('The best day at the beach with my friends'), 'en');
  assert.equal(idioma('Un día en la playa con los amigos'), 'es');
  assert.equal(idioma('Um dia na praia com os amigos'), 'pt');
  assert.equal(idioma('Playa'), 'dudoso');
  assert.equal(idioma(''), 'dudoso');
  // La ruta cuenta, el dominio no
  assert.equal(
    servidor.idiomaProbable({ url: 'https://the-and-with.ejemplo.com/v/un-dia-en-la-playa' }),
    'es'
  );
});

test('palabras bloqueadas: en título o dirección, sin tildes ni guiones', () => {
  const lista = servidor.palabras('tráiler, avance rapido');
  assert.equal(servidor.bloqueadaPor({ title: 'Playa (Trailer)' }, lista), 'trailer');
  assert.equal(
    servidor.bloqueadaPor({ url: 'https://ejemplo.com/v/avance-rapido-1' }, lista),
    'avance rapido'
  );
  assert.equal(servidor.bloqueadaPor({ title: 'Playa' }, lista), null);
  assert.equal(servidor.bloqueadaPor({ title: 'Playa' }, []), null);
});

test('las búsquedas programadas no mandan lo bloqueado y lo cuentan aparte', () => {
  const items = [
    { title: 'Playa larga', sourceUrl: 'https://ejemplo.com/v/1', durationSeconds: 900 },
    { title: 'Playa tráiler', sourceUrl: 'https://ejemplo.com/v/2', durationSeconds: 900 },
  ];
  const r = filtrar(items, {}, new Set(), servidor.palabras('trailer'));
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
  assert.equal(r.descartes.bloqueada, 1);
});

test('cada tanda de resultados llega marcada con idioma y palabra bloqueada (sin quitar nada)', () => {
  filtrosGlobales.aplicar('avance');
  const items = marcar([
    { title: 'The best day at the beach', url: 'https://ejemplo.com/a.mp4' },
    { title: 'Avance', url: 'https://ejemplo.com/b.mp4' },
  ]);
  filtrosGlobales.aplicar('');
  assert.equal(items.length, 2);
  assert.equal(items[0].idioma, 'en');
  assert.equal(items[0].bloqueada, undefined);
  assert.equal(items[1].bloqueada, 'avance');
});

test('Ajustes guarda las palabras y JDownloader no recibe lo bloqueado', async t => {
  const recibidos = [];
  const jd = http.createServer((req, res) => {
    const [ruta, query = ''] = req.url.split('?');
    const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
    const responder = data => res.end(JSON.stringify({ data }));
    if (ruta === '/jd/version') return responder(1);
    if (ruta === '/config/get') return responder('/output');
    if (ruta === '/linkgrabberv2/addLinks') {
      recibidos.push(params[0]);
      return responder({ id: 1 });
    }
    return responder([]);
  });
  const app = createApp().listen(0, '127.0.0.1');
  jd.listen(0, '127.0.0.1');
  await Promise.all([app, jd].map(s => new Promise(r => s.once('listening', r))));
  t.after(() => {
    app.close();
    jd.close();
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const pedir = async (ruta, metodo, cuerpo) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };

  assert.equal((await pedir('/api/ajustes/filtros', 'GET')).body.bloqueadas, '');
  const guardado = await pedir('/api/ajustes/filtros', 'PUT', { bloqueadas: 'Tráiler\nAvance' });
  assert.deepEqual(guardado.body.lista, ['trailer', 'avance']);

  await pedir('/api/ajustes/jdownloader', 'PUT', {
    url: `http://127.0.0.1:${jd.address().port}`,
    autostart: false,
  });
  const r = await pedir('/api/ajustes/jdownloader/enviar', 'POST', {
    links: [
      'https://ejemplo.com/v/1',
      'https://ejemplo.com/v/trailer-2',
      'https://ejemplo.com/v/3',
    ],
    titulos: ['Playa', '', 'Avance de la playa'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.enviados, 1);
  assert.equal(r.body.bloqueados, 2);
  assert.equal(recibidos.at(-1).links, 'https://ejemplo.com/v/1');

  const todo = await pedir('/api/ajustes/jdownloader/enviar', 'POST', {
    links: ['https://ejemplo.com/v/trailer-2'],
  });
  assert.equal(todo.status, 400);
  assert.match(todo.body.detail, /bloqueadas/);
  await pedir('/api/ajustes/filtros', 'PUT', { bloqueadas: '' });
});
