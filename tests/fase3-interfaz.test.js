'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Datos aparte: la ruta de «ya enviado» lee los paquetes de DATA_DIR.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fase3-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');

const paquetesJd = require('../src/services/paquetesJd');
const { createApp } = require('../src/app');

const MODULO = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'unaMano.js')).href;
const cargar = () => import(MODULO);

test.after(() => {
  paquetesJd.parar();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── Navegación: Ajustes en 4 secciones y las direcciones viejas ───────── */

test('Ajustes: 4 secciones y cada dirección vieja lleva a la suya', async () => {
  const { SECCIONES_AJUSTES, seccionAjustes } = await cargar();
  assert.deepEqual(SECCIONES_AJUSTES, ['busqueda', 'descargas', 'clipgeist', 'sistema']);
  const viejas = {
    sitios: 'busqueda',
    busqueda: 'busqueda',
    jdownloader: 'descargas',
    conexiones: 'clipgeist',
    general: 'sistema',
    seguridad: 'sistema',
    copia: 'sistema',
    apariencia: 'sistema',
    acerca: 'sistema',
  };
  for (const [vieja, nueva] of Object.entries(viejas)) {
    assert.equal(seccionAjustes(vieja), nueva, vieja);
  }
  assert.equal(seccionAjustes(''), '');
  assert.equal(seccionAjustes('inventada'), '');
});

test('Actividad: tres pestañas; lo desconocido abre la primera', async () => {
  const { PESTANAS_ACTIVIDAD, pestanaActividad } = await cargar();
  assert.deepEqual(PESTANAS_ACTIVIDAD, ['busquedas', 'descargas', 'programadas', 'avisos']);
  assert.equal(pestanaActividad('descargas'), 'descargas');
  assert.equal(pestanaActividad('otra'), 'busquedas');
  assert.equal(pestanaActividad(undefined), 'busquedas');
});

/* ── Iconos de las otras apps: la dirección desde la que se mira ───────── */

test('las otras apps se abren con la máquina desde la que se ve la página', async () => {
  const { urlDeApp } = await cargar();
  // Guardada como «localhost»: desde el móvil apuntaba al propio teléfono.
  assert.equal(urlDeApp('http://localhost:8096', '192.168.1.20'), 'http://192.168.1.20:8096/');
  assert.equal(urlDeApp('http://127.0.0.1:8095/', 'equipo.local'), 'http://equipo.local:8095/');
  // Nombre de contenedor (sin dominio): tampoco lo resuelve el navegador.
  assert.equal(urlDeApp('http://clipkeeper:8096', '192.168.1.20'), 'http://192.168.1.20:8096/');
  // Una dirección de verdad se respeta tal cual.
  assert.equal(
    urlDeApp('https://biblioteca.ejemplo.test', '192.168.1.20'),
    'https://biblioteca.ejemplo.test/'
  );
  assert.equal(urlDeApp('http://192.168.1.30:8096', '192.168.1.20'), 'http://192.168.1.30:8096/');
  // Viendo la página en el propio equipo, nada que cambiar.
  assert.equal(urlDeApp('http://localhost:8096', 'localhost'), 'http://localhost:8096/');
  assert.equal(urlDeApp('no es una dirección', 'equipo'), 'no es una dirección');
});

/* ── «Descargar todo» sin lo que ya tienes ni lo enviado (CS-41, CS-N7) ── */

test('«Descargar todo» deja fuera lo que ya tienes y lo ya enviado, y no repite fichas', async () => {
  const { paraDescargarTodo } = await cargar();
  const lista = [
    { url: 'https://ejemplo.test/f/1.mp4', sourceUrl: 'https://ejemplo.test/v/1' },
    { url: 'https://ejemplo.test/f/1b.mp4', sourceUrl: 'https://ejemplo.test/v/1' }, // álbum
    { url: 'https://ejemplo.test/v/2' },
    { url: 'https://ejemplo.test/v/3' },
    { url: 'https://ejemplo.test/v/4' },
  ];
  const tengo = new Map([['https://ejemplo.test/v/2', { id: 7 }]]);
  const enviados = new Map([['https://ejemplo.test/v/3', Date.now()]]);
  assert.deepEqual(paraDescargarTodo(lista, { tengo, enviados }), [
    'https://ejemplo.test/v/1',
    'https://ejemplo.test/v/4',
  ]);
  assert.equal(paraDescargarTodo(lista).length, 4);
});

/* ── Memoria de lo ya enviado ──────────────────────────────────────────── */

test('enviadosDe: la última fecha en que cada ficha fue en un paquete', () => {
  const paquetes = [
    { creado: 300, fichas: ['https://ejemplo.test/v/1'] },
    { creado: 100, fichas: ['https://ejemplo.test/v/1/', 'https://ejemplo.test/v/2'] },
  ];
  assert.deepEqual(
    paquetesJd.enviadosDe(paquetes, [
      'https://ejemplo.test/v/1',
      'https://ejemplo.test/v/2/',
      'https://ejemplo.test/v/9',
    ]),
    { 'https://ejemplo.test/v/1': 300, 'https://ejemplo.test/v/2/': 100 }
  );
  assert.deepEqual(paquetesJd.enviadosDe([], ['x']), {});
});

test('POST /api/ajustes/jdownloader/enviados responde con lo apuntado en los paquetes', async t => {
  await paquetesJd.registrar({
    nombre: 'Prueba',
    carpeta: 'Prueba',
    fichas: ['https://ejemplo.test/v/1'],
    jobIds: [],
  });
  paquetesJd.parar();
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => app.close());
  const r = await fetch(`http://127.0.0.1:${app.address().port}/api/ajustes/jdownloader/enviados`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enlaces: ['https://ejemplo.test/v/1', 'https://ejemplo.test/v/2'] }),
  });
  assert.equal(r.status, 200);
  const { enviados } = await r.json();
  assert.deepEqual(Object.keys(enviados), ['https://ejemplo.test/v/1']);
  assert.ok(enviados['https://ejemplo.test/v/1'] > 0);
});

/* ── La interfaz: navegación nueva y lo que se movió ─────────────────── */

test('index.html: Buscar · Explorar · Actividad · Ajustes · Más en la barra (Más la última, con las apps)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const barra = html.slice(
    html.indexOf('<cg-barra-inferior'),
    html.indexOf('</cg-barra-inferior>')
  );
  const destinos = [...barra.matchAll(/href="#\/(\w+)" data-icono/g)].map(m => m[1]);
  assert.deepEqual(destinos, ['buscar', 'explorer', 'actividad', 'ajustes']);
  // Auditoría UX (SU-UX-001): «Apps» pasa a ser «Más» (apps, guía y salir).
  assert.match(barra, /<button[^>]*id="boton-apps"[^>]*data-icono="mas"/);
  assert.ok(
    barra.lastIndexOf('boton-apps') > barra.lastIndexOf('href="#/'),
    '«Apps» es el último botón'
  );
  assert.match(html, /id="view-actividad"/);
  assert.match(html, /id="view-explorer"/);
  assert.match(html, /id="hoja-apps"/);
});
