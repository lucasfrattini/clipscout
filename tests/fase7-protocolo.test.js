'use strict';

/**
 * Fase 7 · lo que clipkeeper pide a clipscout: seguir a una persona (C4), mejorar calidad (C5),
 * volver a descargar (C6) y recuento (C7), con la clave de conexión (lista de permisos) y las
 * conexiones del servidor abiertas ≥ 65 s. Servidores de mentira en 127.0.0.1.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f7-proto-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.HTTP_RETRIES = '1';
delete process.env.CLIPGEIST_CLAVE;
delete process.env.ADMIN_PASSWORD;

const crew = require('../src/services/crew');
const jd = require('../src/services/jdownloader');
const paquetes = require('../src/services/paquetesJd');
const mejorar = require('../src/services/mejorar');
const recuento = require('../src/services/recuento');
const programadas = require('../src/services/programadas');
const { writeProfiles } = require('../src/services/profiles');
const { createApp, ajustarConexiones } = require('../src/app');
const { crearClipkeeper, crearJd, crearSitio } = require('./_fase7Falsos');

let app;
let servidor;
let admin;
let conexion;
const ck = crearClipkeeper({
  personas: [
    {
      id: 1,
      nombre: 'Ana Pérez',
      alias: ['Anita P'],
      biblioteca_id: 3,
      carpeta: 'People/Ana Pérez',
    },
  ],
});
const jdFalso = crearJd();
const sitio = crearSitio({
  '/buscar': '<html><body><h2>1.234 resultados para tu búsqueda</h2></body></html>',
  '/otro': '<html><body><p>Videos (87)</p></body></html>',
  '/nada': '<html><body><p>Sin cifras aquí</p></body></html>',
});

const pedir = (ruta, { metodo = 'GET', cuerpo, clave = admin } = {}) =>
  fetch(`${app}${ruta}`, {
    method: metodo,
    headers: { 'X-Api-Key': clave, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

before(async () => {
  const urlCk = await ck.arrancar();
  const base = await sitio.arrancar();
  await jd.guardar({ url: await jdFalso.arrancar(), autostart: false, biblioteca: 3 });
  // clipkeeper se da de alta aquí (ida y vuelta) y recibe su clave de conexión para llamarnos.
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  app = `http://127.0.0.1:${servidor.address().port}`;
  admin = (await crew.datos()).api_key;
  const alta = await crew.registrarConexion(
    { app: 'clipkeeper', url: urlCk, clave: 'cgc_de-clipscout-para-clipkeeper-xxxxxxxxxxxxxx' },
    { admin: true }
  );
  conexion = alta.clave;
  await writeProfiles([
    { name: 'Uno', config: { searchUrl: `${base}/buscar?q={q}` } },
    { name: 'Dos', config: { searchUrl: `${base}/otro?q={q}` } },
    { name: 'Tres', config: { searchUrl: `${base}/nada?q={q}` } },
  ]);
});

after(async () => {
  paquetes.parar();
  mejorar.usarBusqueda(null);
  servidor.close();
  await Promise.all([ck.cerrar(), jdFalso.cerrar(), sitio.cerrar()]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('conexiones abiertas ≥ 65 s (Safari «Load failed»), también en server.js', () => {
  const falso = {};
  ajustarConexiones(falso);
  assert.ok(falso.keepAliveTimeout >= 65000);
  assert.ok(falso.headersTimeout > falso.keepAliveTimeout);
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(fuente, /ajustarConexiones\(server\)/);
});

test('C4 · seguir: crea (201) o actualiza la de esa persona; lista; quitar', async () => {
  let r = await pedir('/api/crew/v1/seguir', {
    metodo: 'POST',
    clave: conexion,
    cuerpo: {
      persona: 'Ana Pérez',
      alias: ['Anita P', 'ana perez'],
      biblioteca_id: 3,
      carpeta: 'People/Ana Pérez',
      cada_dias: 7,
      limite: 20,
    },
  });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  r = await pedir('/api/crew/v1/seguir', {
    metodo: 'POST',
    clave: conexion,
    cuerpo: {
      persona: 'ANA PEREZ',
      alias: ['Anita P'],
      biblioteca_id: 3,
      carpeta: 'People/Ana Pérez',
      cada_dias: 3,
      limite: 10,
    },
  });
  assert.equal((await r.json()).id, id, 'la misma persona no se sigue dos veces');
  const { programadas: lista } = await programadas.listar();
  const p = lista.find(x => x.id === id);
  assert.deepEqual(
    [p.termino, p.alias, p.n, p.cadaDias, p.soloConNombre, p.orden, p.seguida, p.bibliotecaId],
    ['ANA PEREZ', ['Anita P'], 10, 3, true, 'largos', true, 3]
  );
  const g = await (await pedir('/api/crew/v1/seguir', { clave: conexion })).json();
  assert.equal(g.seguidas.length, 1);
  const s = g.seguidas[0];
  assert.deepEqual(
    Object.keys(s).filter(k =>
      ['id', 'persona', 'cada_dias', 'limite', 'ultima', 'proxima', 'ultimos_enviados'].includes(k)
    ).length,
    7
  );
  assert.equal(s.ultima, null);
  assert.ok(s.proxima);
  assert.deepEqual(s.ultimos_enviados, []);
  // La interfaz lo ve igual en «Seguidas».
  assert.equal((await (await fetch(`${app}/api/seguidas`)).json()).seguidas.length, 1);
  assert.equal(
    (await pedir(`/api/crew/v1/seguir/${id}`, { metodo: 'DELETE', clave: conexion })).status,
    200
  );
  assert.equal(
    (await pedir(`/api/crew/v1/seguir/${id}`, { metodo: 'DELETE', clave: conexion })).status,
    404
  );
  assert.equal((await pedir('/api/crew/v1/seguir', { metodo: 'POST', cuerpo: {} })).status, 400);
});

test('lista de permisos: la clave de conexión abre C4–C7 y nada más nuevo; sin clave, 401', async () => {
  assert.equal((await pedir('/api/crew/v1/recuento?termino=x', { clave: conexion })).status, 200);
  assert.equal((await pedir('/api/crew/v1/mejorar/no-existe', { clave: conexion })).status, 404);
  assert.equal((await pedir('/api/crew/v1/conexiones', { clave: conexion })).status, 403);
  assert.equal((await fetch(`${app}/api/crew/v1/seguir`)).status, 401);
});

test('C5 · candidatos: misma persona, título parecido, duración ±3 % y más alto; máx. 3', () => {
  const item = { video_id: 7, titulo: 'Día de playa', duracion: 600, alto: 480 };
  const r = (n, titulo, d, extra = {}) => ({
    url: `https://ejemplo.com/v/${n}`,
    title: titulo,
    durationSeconds: d,
    ...extra,
  });
  const c = mejorar.candidatosPara(
    item,
    [
      r(1, 'Ana Pérez - Día de playa 1080p', 610),
      r(2, 'Ana Pérez - Día de playa 720p', 595),
      r(3, 'Ana Pérez - Día de playa 4K', 650), // fuera: +8 %
      r(4, 'Luis - Día de playa 1080p', 600), // fuera: otra persona
      r(5, 'Ana Pérez - Montaña 1080p', 600), // fuera: otro título
      r(6, 'Ana Pérez - Día de playa', 600), // fuera: no se sabe si es mejor
      r(7, 'Anita P - Día de playa 2160p', 601),
      r(8, 'Ana Pérez Día de playa 1440p', 600),
    ],
    { nombres: ['Ana Pérez', 'Anita P'] }
  );
  assert.deepEqual(
    c.map(x => [x.url.split('/').pop(), x.alto]),
    [
      ['7', 2160],
      ['8', 1440],
      ['1', 1080],
    ]
  );
});

test('C5 · mejorar: trabajo (202), propuestas y enviar con sustituye_video_id', async () => {
  const busquedas = [];
  mejorar.usarBusqueda(async (q, { alias }) => {
    busquedas.push([q, alias]);
    return {
      sitios: new Map([[0, 'Ejemplo']]),
      resultados: [
        {
          sitio: 0,
          url: 'https://ejemplo.com/v/10',
          title: 'Ana Pérez Día de playa 1080p',
          durationSeconds: 300,
        },
        {
          sitio: 0,
          url: 'https://ejemplo.com/v/11',
          title: 'Ana Pérez Montaña 720p',
          durationSeconds: 900,
        },
      ],
    };
  });
  assert.equal(
    (
      await pedir('/api/crew/v1/mejorar', {
        metodo: 'POST',
        cuerpo: { items: Array(201).fill({ video_id: 1 }) },
      })
    ).status,
    400
  );
  let r = await pedir('/api/crew/v1/mejorar', {
    metodo: 'POST',
    clave: conexion,
    cuerpo: {
      items: [
        {
          video_id: 1,
          titulo: 'Día de playa',
          personas: ['Ana Pérez'],
          duracion: 302,
          alto: 480,
          biblioteca_id: 3,
          carpeta: 'People/Ana Pérez',
        },
        {
          video_id: 2,
          titulo: 'Montaña',
          personas: ['Ana Pérez'],
          duracion: 900,
          alto: 1080,
          biblioteca_id: 3,
          carpeta: 'People/Ana Pérez',
        },
      ],
    },
  });
  assert.equal(r.status, 202);
  const { trabajo } = await r.json();
  let estado;
  for (let i = 0; i < 100; i += 1) {
    estado = await (await pedir(`/api/crew/v1/mejorar/${trabajo}`, { clave: conexion })).json();
    if (estado.estado !== 'buscando') break;
    await new Promise(res => setTimeout(res, 20));
  }
  assert.equal(estado.estado, 'hecho');
  assert.deepEqual([estado.hechos, estado.total], [2, 2]);
  assert.deepEqual(busquedas, [['Ana Pérez', ['Anita P']]], 'una búsqueda por persona, con alias');
  const p1 = estado.propuestas.find(p => p.video_id === 1);
  assert.deepEqual(
    p1.candidatos.map(c => [c.url, c.sitio, c.alto]),
    [['https://ejemplo.com/v/10', 'Ejemplo', 1080]]
  );
  assert.deepEqual(
    estado.propuestas.find(p => p.video_id === 2).candidatos,
    [],
    '720p no mejora 1080p'
  );
  jdFalso.estado.anadidos.length = 0;
  ck.estado.esperados.length = 0;
  r = await pedir(`/api/crew/v1/mejorar/${trabajo}/enviar`, {
    metodo: 'POST',
    clave: conexion,
    cuerpo: {
      elegidos: [
        { video_id: 1, url: 'https://ejemplo.com/v/10' },
        { video_id: 2, url: 'https://ejemplo.com/v/99' },
      ],
    },
  });
  const env = await r.json();
  assert.equal(env.enviados, 1);
  assert.equal(env.fallos.length, 1, 'lo que no se propuso no se manda');
  assert.equal(jdFalso.estado.anadidos[0].destinationFolder, '/output/People/Ana Pérez');
  assert.deepEqual(
    ck.estado.esperados[0].items.map(i => [
      i.origen_url,
      i.sustituye_video_id,
      i.duracion,
      i.personas,
    ]),
    [['https://ejemplo.com/v/10', 1, 300, ['Ana Pérez']]]
  );
});

test('C6 · reenviar: al gestor y a lo esperado; sin origen, a fallos', async () => {
  jdFalso.estado.anadidos.length = 0;
  ck.estado.esperados.length = 0;
  const r = await pedir('/api/crew/v1/reenviar', {
    metodo: 'POST',
    clave: conexion,
    cuerpo: {
      items: [
        {
          origen_url: 'https://ejemplo.com/v/20',
          biblioteca_id: 3,
          carpeta: 'Viajes',
          titulo: 'Playa',
          personas: [],
          sustituye_video_id: 44,
        },
        {
          origen_url: 'https://ejemplo.com/v/21',
          biblioteca_id: 3,
          carpeta: 'Viajes',
          titulo: 'Río',
          personas: ['Ana Pérez'],
        },
        { origen_url: '', biblioteca_id: 3, carpeta: 'Viajes' },
      ],
    },
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.enviados, 2);
  assert.equal(j.fallos.length, 1);
  assert.equal(jdFalso.estado.anadidos.length, 1, 'un paquete por carpeta');
  assert.deepEqual(
    ck.estado.esperados[0].items.map(i => [i.titulo, i.sustituye_video_id]),
    [
      ['Playa', 44],
      ['Río', null],
    ]
  );
  assert.equal(
    (await pedir('/api/crew/v1/reenviar', { metodo: 'POST', cuerpo: { items: [] } })).status,
    400
  );
});

test('C7 · recuento: lo que dice cada sitio, null si no lo dice; caché 24 h', async () => {
  recuento.olvidar();
  const r = await (
    await pedir('/api/crew/v1/recuento?termino=Ana%20P%C3%A9rez', { clave: conexion })
  ).json();
  assert.equal(r.termino, 'Ana Pérez');
  assert.deepEqual(r.sitios, [
    { sitio: 'Uno', total: 1234 },
    { sitio: 'Dos', total: 87 },
    { sitio: 'Tres', total: null },
  ]);
  assert.equal(r.total, 1321);
  assert.ok(r.fecha);
  const antes = sitio.peticiones.length;
  await pedir('/api/crew/v1/recuento?termino=ana perez', { clave: conexion });
  assert.equal(sitio.peticiones.length, antes, 'de la caché');
  assert.equal(recuento.totalDeHtml('<p>Showing 1-24 of 2,310 results</p>'), 2310);
  assert.equal((await pedir('/api/crew/v1/recuento')).status, 400);
});
