'use strict';

/**
 * CS-N1 «Recoger» y CS-04: la función de elección única (lib/recoger.js), «¿lo tengo?» contra
 * `POST /api/crew/v1/tengo` de clipkeeper (y, con uno anterior, `/buscar`) y la propuesta.
 * Todo local: un clipkeeper de mentira y la búsqueda en segundo plano sustituida por una foto.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-recoger-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');

const { elegir, coincidencia, calidadDe, llevaNombre } = require('../src/lib/recoger');
const { filtrar } = require('../src/services/programadas');

const v = (n, titulo, segundos, extra = {}) => ({
  url: `https://ejemplo.com/v/${n}`,
  title: titulo,
  durationSeconds: segundos,
  ...extra,
});

/* ── La función de elección ─────────────────────────────────────────── */

test('elegir: solo lo que lleva el nombre, los más largos primero, sin repetidos ni lo enviado', () => {
  const items = [
    v(1, 'Ana Pérez en la playa', 300),
    v(2, 'Otra persona', 900),
    v(3, 'Paseo con ana perez', 1200),
    v(4, 'Ana sola', 2000), // falta «Pérez»
    v(5, 'ANA-PÉREZ montaña', 600),
    v(6, 'Ana Pérez ya enviada', 5000),
  ];
  const { elegidos, descartes } = elegir(items, {
    nombre: 'Ana Pérez',
    soloConNombre: true,
    orden: 'largos',
    yaEnviados: ['https://www.ejemplo.com/v/6/'],
  });
  assert.deepEqual(
    elegidos.map(e => e.link),
    ['https://ejemplo.com/v/3', 'https://ejemplo.com/v/5', 'https://ejemplo.com/v/1']
  );
  assert.equal(descartes.sinNombre, 2);
  assert.equal(descartes.enviado, 1);
});

test('elegir: de cada grupo de repetidos sale el mejor (más largo o más calidad), uno solo', () => {
  const items = [
    v(1, 'Ana Pérez 720p', 600),
    v(2, 'Ana Pérez 1080p', 590),
    v(3, 'Ana Pérez 4K', 100),
  ];
  const grupos = [{ miembros: items.map(i => i.url) }];
  const largos = elegir(items, { nombre: 'Ana Pérez', orden: 'largos', grupos });
  assert.deepEqual(
    largos.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
  assert.equal(largos.descartes.repetido, 2);
  assert.equal(largos.elegidos[0].claves.length, 3, 'todo el grupo cuenta como enviado');
  const calidad = elegir(items, { nombre: 'Ana Pérez', orden: 'calidad', grupos });
  assert.deepEqual(
    calidad.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/3']
  );
  // Sin orden (las programadas de antes): el primero que pasa los filtros, como siempre.
  assert.deepEqual(
    elegir(items, { grupos }).elegidos.map(e => e.link),
    ['https://ejemplo.com/v/1']
  );
});

test('elegir: duración mínima, contener, excluir y palabras bloqueadas', () => {
  const items = [
    v(1, 'Ana playa', 30),
    v(2, 'Ana playa larga', 900),
    v(3, 'Ana trailer', 900),
    v(4, 'Ana montaña', 900),
    v(5, 'Ana prohibida', 900),
    v(6, 'Ana playa sin duración', undefined),
  ];
  const r = elegir(items, {
    minutosMinimo: 1,
    sinDuracion: false,
    contener: 'playa',
    excluir: 'trailer',
    bloqueadas: ['prohibida'],
  });
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    ['https://ejemplo.com/v/2']
  );
  assert.deepEqual(
    { ...r.descartes },
    {
      repetido: 0,
      enviado: 0,
      duracion: 2,
      contener: 1,
      excluir: 1,
      bloqueada: 1,
      sinNombre: 0,
    }
  );
});

test('calidad y nombre: se deducen del título y la dirección', () => {
  assert.equal(calidadDe({ title: 'Algo 2160p' }), 4);
  assert.equal(calidadDe({ title: 'Algo', url: 'https://e.com/v/algo-1080p.mp4' }), 2);
  assert.equal(calidadDe({ title: 'Algo HD' }), 1);
  assert.equal(calidadDe({ title: 'Hdmi suelto' }), 0);
  assert.equal(llevaNombre({ title: 'x', url: 'https://e.com/ana-perez-123' }, 'Ana Pérez'), true);
  assert.equal(llevaNombre({ title: 'Anabel' }, 'Ana'), true, 'empieza palabra');
  assert.equal(llevaNombre({ title: 'Mariana' }, 'Ana'), false);
});

test('programadas: la misma elección; las de antes (sin n ni orden) no cambian', () => {
  const items = [v(1, 'Ana corta', 100), v(2, 'Otra larga', 900), v(3, 'Ana larga', 800)];
  assert.deepEqual(
    filtrar(items, { termino: 'Ana' }).elegidos.map(e => e.link),
    items.map(i => i.url)
  );
  assert.deepEqual(
    filtrar(items, { termino: 'Ana', soloConNombre: true, orden: 'largos', n: 1 }).elegidos.map(
      e => e.link
    ),
    ['https://ejemplo.com/v/3', 'https://ejemplo.com/v/1']
  );
});

/* ── ¿Lo tengo? ─────────────────────────────────────────────────────── */

test('coincidencia: misma página, o duración ±2 s y título parecido, o sin título ±1 s', () => {
  const videos = [
    { id: 1, titulo: 'Día de playa', fichero: 'x.mp4', duracion: 61.2, origen_url: null },
    { id: 2, titulo: '', fichero: 'Paseo largo.mp4', duracion: 300, origen_url: null },
    { id: 3, titulo: 'Nada', duracion: 10, origen_url: 'https://ejemplo.com/v/9' },
  ];
  assert.equal(coincidencia({ url: 'https://www.ejemplo.com/v/9/' }, videos)?.id, 3);
  assert.equal(coincidencia({ title: 'Dia de Playa HD', durationSeconds: 62 }, videos)?.id, 1);
  assert.equal(coincidencia({ title: 'Día de playa', durationSeconds: 70 }, videos), null);
  assert.equal(coincidencia({ title: 'Otra cosa', durationSeconds: 61 }, videos), null);
  assert.equal(coincidencia({ title: 'paseo largo', durationSeconds: 301.5 }, videos)?.id, 2);
  assert.equal(coincidencia({ durationSeconds: 300.8 }, videos)?.id, 2);
  assert.equal(coincidencia({ durationSeconds: 302 }, videos), null);
});

/* ── Contra un clipkeeper de mentira ────────────────────────────────── */

let modo = 'tengo'; // 'tengo' | 'antiguo'
const pedidas = [];
const keeper = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', c => (cuerpo += c));
  req.on('end', () => {
    pedidas.push({ ruta: req.url, cuerpo: JSON.parse(cuerpo || '{}') });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/crew/v1/tengo' && modo === 'tengo') {
      return res.end(
        JSON.stringify({
          termino: 'Ana Pérez',
          total: 2,
          truncado: false,
          personas: [{ nombre: 'Ana Pérez', videos: 2 }],
          videos: [
            { id: 1, titulo: 'Ana Pérez muy larga', duracion: 3000, estado: 'ok' },
            {
              id: 2,
              titulo: 'Borrada',
              duracion: 10,
              origen_url: 'https://ejemplo.com/v/4',
              estado: 'papelera',
            },
          ],
        })
      );
    }
    if (req.url === '/api/crew/v1/buscar') {
      const { titulos } = JSON.parse(cuerpo);
      return res.end(
        JSON.stringify({
          resultados: titulos.map(t => ({ coincidencias: /muy larga/.test(t) ? [{ id: 1 }] : [] })),
        })
      );
    }
    res.statusCode = 404;
    return res.end('{"codigo":"no_encontrado","detail":"No encontrado."}');
  });
});

let recoger;
const fondo = require('../src/services/busquedasFondo');
const FOTO = [
  v(1, 'Ana Pérez muy larga', 3001),
  v(2, 'Ana Pérez media', 1500),
  v(3, 'Ana Pérez corta', 600),
  v(4, 'Ana Pérez borrada', 2000),
  v(5, 'Otra persona', 9000),
];
before(async () => {
  await new Promise(r => keeper.listen(0, '127.0.0.1', r));
  fs.writeFileSync(
    process.env.CREW_PATH,
    JSON.stringify({
      api_key: 'a'.repeat(32),
      conexiones: [
        {
          id: 1,
          app: 'clipkeeper',
          nombre: 'clipkeeper',
          url: `http://127.0.0.1:${keeper.address().port}`,
          api_key: 'cgc_prueba',
          activa: true,
        },
      ],
    })
  );
  // La búsqueda en segundo plano: una «foto» fija en vez de buscar de verdad.
  fondo.suscribir = (id, desde, oyente) => {
    if (id !== 'b1') return null;
    oyente({ type: 'resultados', items: FOTO.map(x => ({ ...x })) });
    oyente({ type: 'fin' });
    return () => {};
  };
  fondo.lista = () => [{ id: 'b1', q: 'Ana Pérez', carpeta: '' }];
  recoger = require('../src/services/recoger');
});
after(() => {
  keeper.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('propuesta: los N más largos con el nombre, sin lo que tengo ni lo de la papelera', async () => {
  modo = 'tengo';
  const r = await recoger.proponer({ busqueda: 'b1', n: 2 });
  assert.equal(r.nombre, 'Ana Pérez', 'el nombre sale de lo buscado');
  assert.equal(r.terminada, true);
  assert.deepEqual(
    r.propuesta.map(p => p.link),
    ['https://ejemplo.com/v/2', 'https://ejemplo.com/v/3']
  );
  assert.equal(r.descartes.tengo, 1);
  assert.equal(r.descartes.papelera, 1);
  assert.equal(r.descartes.sinNombre, 1);
  assert.equal(r.clipkeeper.disponible, true);
  assert.deepEqual(r.clipkeeper.personas, [{ nombre: 'Ana Pérez', videos: 2 }]);
  assert.equal(pedidas.at(-1).cuerpo.termino, 'Ana Pérez');
});

test('propuesta con un clipkeeper anterior (sin /tengo): pregunta con /buscar', async () => {
  modo = 'antiguo';
  pedidas.length = 0;
  const r = await recoger.proponer({ busqueda: 'b1', n: 5, orden: 'largos' });
  assert.equal(r.clipkeeper.disponible, false);
  assert.equal(r.clipkeeper.conectado, true);
  assert.deepEqual(
    pedidas.map(p => p.ruta),
    ['/api/crew/v1/tengo', '/api/crew/v1/buscar']
  );
  assert.deepEqual(
    r.propuesta.map(p => p.link),
    ['https://ejemplo.com/v/4', 'https://ejemplo.com/v/2', 'https://ejemplo.com/v/3']
  );
  assert.equal(r.descartes.tengo, 1);
});

test('propuesta: una búsqueda que ya no existe da 404', async () => {
  await assert.rejects(recoger.proponer({ busqueda: 'nada' }), e => e.status === 404);
});

test('elegir: el mismo título en dos sitios es el mismo vídeo (si la duración no lo contradice)', () => {
  const items = [
    v(1, 'Clip de prueba uno', 100),
    { ...v(2, 'Clip de prueba uno', 101), url: 'https://otro.example/v/2' },
    { ...v(3, 'Clip de prueba uno', 400), url: 'https://otro.example/v/3' },
    v(4, 'Corto', 50),
    v(5, 'Corto', 50),
  ];
  const r = elegir(items, { orden: 'largos' });
  assert.deepEqual(
    r.elegidos.map(e => e.link),
    [
      'https://otro.example/v/3',
      'https://otro.example/v/2',
      'https://ejemplo.com/v/4',
      'https://ejemplo.com/v/5',
    ],
    'títulos cortos no se juntan; con 300 s de diferencia, son otro vídeo'
  );
  assert.equal(r.descartes.repetido, 1);
});
