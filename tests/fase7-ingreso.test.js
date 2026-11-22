'use strict';

/**
 * Fase 7 · NU-1 (lado emisor) y NU-4: las personas de clipkeeper (C1) con sus alias, lo esperado
 * (C2) en cada envío al gestor de descargas, los alias en «Recoger», las programadas y Buscar.
 * Un clipkeeper y un JDownloader de mentira; nada sale de 127.0.0.1.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f7-ingreso-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
delete process.env.CLIPGEIST_CLAVE;

const crew = require('../src/services/crew');
const jd = require('../src/services/jdownloader');
const paquetes = require('../src/services/paquetesJd');
const personas = require('../src/services/personas');
const esperados = require('../src/services/esperados');
const { elegir } = require('../src/lib/recoger');
const { filtrar, limpiarAlias } = require('../src/services/programadas');
const { conAlias, entradaDe } = require('../src/routes/buscar');
const { crearClipkeeper, crearJd } = require('./_fase7Falsos');

const ANA = {
  id: 1,
  nombre: 'Ana Pérez',
  rol: 'actriz',
  alias: ['Anita P', 'AnaPerezOficial'],
  biblioteca_id: 3,
  carpeta: 'People/Ana Pérez',
  carpeta_fotos: 'Fotos',
  videos: 12,
  fotos: 0,
  foto: true,
};
const LUIS = {
  id: 2,
  nombre: 'Luis Gómez',
  rol: 'actor',
  alias: [],
  biblioteca_id: 3,
  carpeta: null,
};

const ck = crearClipkeeper({ personas: [ANA, LUIS] });
const jdFalso = crearJd();

before(async () => {
  const urlCk = await ck.arrancar();
  const urlJd = await jdFalso.arrancar();
  await jd.guardar({ url: urlJd, autostart: false, biblioteca: 3 });
  await crew.guardarConexion({ app: 'clipkeeper', url: urlCk, api_key: 'clave-ck' });
});

after(async () => {
  paquetes.parar();
  await ck.cerrar();
  await jdFalso.cerrar();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C1: la lista de personas, limpia y recordada un minuto', async () => {
  personas.olvidar();
  const r = await personas.listar();
  assert.equal(r.conectado, true);
  assert.deepEqual(
    r.personas.map(p => [p.nombre, p.carpeta, p.carpeta_fotos]),
    [
      ['Ana Pérez', 'People/Ana Pérez', 'Fotos'],
      ['Luis Gómez', null, 'Fotos'],
    ]
  );
  const antes = ck.estado.llamadas.filter(l => l.ruta === '/api/crew/v1/personas').length;
  await personas.listar();
  assert.equal(
    ck.estado.llamadas.filter(l => l.ruta === '/api/crew/v1/personas').length,
    antes,
    'la segunda vez sale de la caché'
  );
  assert.equal(ck.estado.llamadas.at(-1).clave, 'clave-ck');
});

test('detección: por nombre o alias, palabras enteras o pegado; nombres cortos no', () => {
  const lista = [ANA, LUIS, { nombre: 'Al', alias: [] }];
  assert.deepEqual(personas.detectar(['Día de playa con anita p'], lista), ['Ana Pérez']);
  assert.deepEqual(personas.detectar(['https://ejemplo.com/v/anaperez-playa'], lista), [
    'Ana Pérez',
  ]);
  assert.deepEqual(personas.detectar(['Mariana en la montaña'], lista), []);
  assert.deepEqual(personas.detectar(['ANA-PÉREZ y Luis Gómez'], lista), [
    'Ana Pérez',
    'Luis Gómez',
  ]);
  assert.deepEqual(personas.detectar(['al final'], lista), [], 'menos de 3 letras: no cuenta');
  assert.equal(personas.porTermino('anita p', lista).nombre, 'Ana Pérez');
  assert.equal(personas.porTermino('Ana', lista), null, 'solo coincidencias exactas');
});

test('C2: cada envío avisa a clipkeeper de lo esperado (personas por título, término y regla)', async () => {
  ck.estado.esperados.length = 0;
  const r = await jd.enviar({
    links: ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/2'],
    titulos: ['Día de playa con Anita P', 'Paseo'],
    duraciones: [312, null],
    termino: 'Luis Gómez',
    carpeta: 'People/Ana Pérez',
    regla: {
      personas: [{ nombre: 'Ana Pérez' }],
      etiquetas: [{ nombre: 'Verano', grupo: 'Tipo' }],
    },
  });
  assert.equal(r.enviados, 2);
  assert.equal(r.esperados.ok, true);
  assert.equal(r.esperados.ids.length, 2);
  assert.equal(ck.estado.esperados.length, 1);
  const [aviso] = ck.estado.esperados;
  assert.equal(aviso.biblioteca_id, 3);
  assert.equal(aviso.carpeta, 'People/Ana Pérez');
  assert.deepEqual(aviso.items[0], {
    tipo: 'video',
    origen_url: 'https://ejemplo.com/v/1',
    titulo: 'Día de playa con Anita P',
    personas: ['Ana Pérez', 'Luis Gómez'],
    etiquetas: ['Verano'],
    duracion: 312,
    sustituye_video_id: null,
  });
  assert.equal(aviso.items[1].duracion, null);
  assert.deepEqual(aviso.items[1].personas, ['Ana Pérez', 'Luis Gómez']);
});

test('C2: `esperados: false` no avisa; un clipkeeper anterior (404) no rompe el envío', async () => {
  ck.estado.esperados.length = 0;
  let r = await jd.enviar({ links: ['https://ejemplo.com/v/3'], esperados: false });
  assert.equal(r.esperados, null);
  assert.equal(ck.estado.esperados.length, 0);
  ck.estado.esperadosEstado = 404;
  r = await jd.enviar({ links: ['https://ejemplo.com/v/4'], carpeta: 'Viajes' });
  assert.equal(r.ok, true);
  assert.equal(r.esperados.ok, false);
  ck.estado.esperadosEstado = 201;
});

test('C2: items limpios (álbum con n_fotos; sin origen fuera) y tandas de 500', async () => {
  assert.deepEqual(
    esperados.limpiarItem({
      tipo: 'album',
      origen_url: 'https://ejemplo.com/a/1',
      titulo: 'Vacaciones',
      album: 'Vacaciones',
      personas: ['Ana Pérez', 'Ana Pérez'],
      n_fotos: 24,
    }),
    {
      tipo: 'album',
      origen_url: 'https://ejemplo.com/a/1',
      titulo: 'Vacaciones',
      personas: ['Ana Pérez'],
      album: 'Vacaciones',
      n_fotos: 24,
    }
  );
  assert.equal(esperados.limpiarItem({ origen_url: 'ftp://x' }), null);
  ck.estado.esperados.length = 0;
  const items = Array.from({ length: 501 }, (_, i) => ({
    origen_url: `https://ejemplo.com/v/${i}`,
  }));
  const r = await esperados.avisar({ bibliotecaId: 3, carpeta: 'X', items });
  assert.equal(r.ok, true);
  assert.deepEqual(
    ck.estado.esperados.map(e => e.items.length),
    [500, 1]
  );
});

test('NU-4: «lleva el nombre» vale con cualquier alias (Recoger y programadas)', () => {
  const items = [
    { url: 'https://ejemplo.com/v/1', title: 'Anita P en la playa', durationSeconds: 600 },
    { url: 'https://ejemplo.com/v/2', title: 'Otra persona', durationSeconds: 900 },
  ];
  const sin = elegir(items, { nombre: 'Ana Pérez', soloConNombre: true });
  assert.equal(sin.elegidos.length, 0);
  const con = elegir(items, { nombre: 'Ana Pérez', alias: ['Anita P'], soloConNombre: true });
  assert.deepEqual(
    con.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
  assert.equal(
    filtrar(items, { termino: 'Ana Pérez', alias: ['Anita P'], soloConNombre: true }).elegidos
      .length,
    1
  );
  assert.deepEqual(limpiarAlias(['anita p', 'Anita P', 'ana perez', ' '], 'Ana Pérez'), [
    'anita p',
  ]);
});

test('NU-4: Buscar busca también por los alias si lo buscado es una persona (salvo alias:false)', async () => {
  personas.olvidar();
  const e = await conAlias(entradaDe({ q: 'ana perez' }), {});
  assert.deepEqual(e.alias, ['Anita P', 'AnaPerezOficial']);
  const sin = await conAlias(entradaDe({ q: 'ana perez' }), { alias: false });
  assert.equal(sin.alias, undefined);
  const otra = await conAlias(entradaDe({ q: 'playa' }), {});
  assert.equal(otra.alias, undefined);
  const dados = entradaDe({ q: 'x', alias: ['uno', 'dos'] });
  assert.deepEqual(dados.alias, ['uno', 'dos']);
});
