'use strict';

/**
 * CS-01 y CS-02: busquedas.json pasa a ser un índice pequeño y los eventos de cada búsqueda van a
 * busquedas/<id>.jsonl (se añaden, no se reescriben). Migración automática de los datos de la
 * 2.21.0 sin perder la cola ni lo ya encontrado; un índice ilegible se aparta en vez de pisarse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-formato-'));
process.env.DATA_DIR = dir;
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.BROWSER_ENABLED = 'false';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_PERSISTIR_MS = '30';
// Nada arranca: así se ve la cola tal cual quedó tras migrar.
process.env.BUSQUEDA_FONDO_MAX_ACTIVAS = '0';

const RUTA = require.resolve('../src/services/busquedasFondo');
const cargar = () => {
  delete require.cache[RUTA];
  return require(RUTA);
};
const indice = () => path.join(dir, 'busquedas.json');
const eventosDe = id => path.join(dir, 'busquedas', `${id}.jsonl`);
const lineas = id => fs.readFileSync(eventosDe(id), 'utf8').trim().split('\n');
const limpiar = () => {
  for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { recursive: true });
};

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const item = n => ({
  url: `https://ejemplo.com/m/${n}.mp4`,
  sourceUrl: `https://ejemplo.com/v/${n}`,
  title: `Clip ${n}`,
});

/** Un busquedas.json tal como lo deja la 2.21.0 (formato 1: los eventos dentro). */
function ficheroDe2210() {
  const ahora = Date.now();
  return {
    version: 1,
    guardadoEn: new Date(ahora).toISOString(),
    ultima: 'en-curso',
    cola: ['espera-2', 'espera-1'],
    busquedas: [
      {
        id: 'terminada',
        entrada: { q: 'montaña' },
        q: 'montaña',
        terminoRelevancia: 'montaña',
        carpeta: 'Viajes',
        origen: 'manual',
        estado: 'fin',
        quitada: false,
        creadaEn: ahora - 60000,
        empezadaEn: ahora - 59000,
        terminadaEn: ahora - 30000,
        eventos: [
          { type: 'inicio', seq: 0 },
          { type: 'sitios', sitios: [{ id: 0, nombre: 'a' }], seq: 1 },
          { type: 'resultados', sitio: 0, items: [item(1), item(2)], seq: 2 },
          { type: 'sitio_fin', sitio: 0, total: 2, seq: 3 },
          { type: 'fin', total: 2, seq: 4 },
        ],
      },
      {
        id: 'en-curso',
        entrada: { q: 'playa', sitios: [0, 1] },
        q: 'playa',
        terminoRelevancia: 'playa',
        carpeta: '',
        origen: 'manual',
        estado: 'curso',
        creadaEn: ahora - 20000,
        empezadaEn: ahora - 19000,
        terminadaEn: null,
        eventos: [
          { type: 'inicio', seq: 0 },
          { type: 'sitios', sitios: [{ id: 0 }, { id: 1 }], seq: 1 },
          { type: 'resultados', sitio: 0, items: [item(3)], seq: 2 },
          { type: 'sitio_fin', sitio: 0, total: 1, seq: 3 },
        ],
      },
      {
        id: 'espera-1',
        entrada: { q: 'río' },
        q: 'río',
        origen: 'programada',
        estado: 'cola',
        creadaEn: ahora - 10000,
        eventos: [{ type: 'en_cola', posicion: 1, seq: 0 }],
      },
      {
        id: 'espera-2',
        entrada: { q: 'lago' },
        q: 'lago',
        origen: 'manual',
        estado: 'cola',
        creadaEn: ahora - 9000,
        eventos: [{ type: 'en_cola', posicion: 2, seq: 0 }],
      },
    ],
  };
}

test('migra solo los datos de la 2.21.0: la cola, lo encontrado y lo terminado siguen', async () => {
  limpiar();
  fs.writeFileSync(indice(), JSON.stringify(ficheroDe2210()));
  const fondo = cargar();
  assert.deepEqual(await fondo.restaurar(), { retomadas: 3, terminadas: 1 });

  // La cola: la que estaba en marcha la primera y las que esperaban en su orden.
  const enCola = fondo.lista().filter(b => b.estado === 'cola');
  assert.deepEqual(
    enCola.map(b => b.id),
    ['en-curso', 'espera-2', 'espera-1']
  );
  const terminada = fondo.lista().find(b => b.id === 'terminada');
  assert.equal(terminada.estado, 'fin');
  assert.equal(terminada.total, 2);
  assert.equal(terminada.carpeta, 'Viajes');
  assert.equal(fondo.actual().id, 'en-curso');

  // En disco, ya en el formato 2: índice sin eventos y un .jsonl por búsqueda.
  const nuevo = JSON.parse(fs.readFileSync(indice(), 'utf8'));
  assert.equal(nuevo.version, 2);
  assert.ok(nuevo.busquedas.every(b => typeof b.eventos === 'number'));
  assert.equal(lineas('terminada').length, 5);
  assert.equal(lineas('en-curso').length, 4);
  assert.equal(JSON.parse(lineas('terminada')[2]).items[1].title, 'Clip 2');

  // Y un arranque más (ya en formato 2) lo deja igual.
  const otra = cargar();
  assert.deepEqual(await otra.restaurar(), { retomadas: 3, terminadas: 1 });
  const vistos = [];
  otra.suscribir('terminada', 0, e => vistos.push(e));
  assert.deepEqual(
    vistos.map(e => e.seq),
    [0, 1, 2, 3, 4]
  );
  assert.equal(
    otra
      .lista()
      .filter(b => b.estado === 'cola')
      .map(b => b.id)
      .join(),
    'en-curso,espera-2,espera-1'
  );
});

test('los resultados se añaden: el índice no se reescribe con cada tanda', async () => {
  limpiar();
  const fondo = cargar();
  const id = fondo.iniciar({ q: 'bosque' });
  await fondo.guardarAhora();
  const indiceAntes = fs.statSync(indice()).mtimeMs;
  const tamAntes = fs.statSync(eventosDe(id)).size;
  // Sin hueco para arrancar (máximo 0): se simula lo que llegaría parando y mirando el fichero.
  fondo.parar(id);
  await fondo.guardarAhora();
  assert.ok(fs.statSync(eventosDe(id)).size > tamAntes, 'el fin se añadió al .jsonl');
  assert.ok(fs.statSync(indice()).mtimeMs >= indiceAntes);
  const ultimo = JSON.parse(lineas(id).at(-1));
  assert.equal(ultimo.type, 'fin');
  assert.equal(ultimo.quitada, true);
});

test('una última línea cortada (apagón) se descarta y el fichero queda limpio', async () => {
  limpiar();
  const datos = ficheroDe2210();
  const terminada = datos.busquedas[0];
  fs.mkdirSync(path.join(dir, 'busquedas'));
  fs.writeFileSync(
    eventosDe('terminada'),
    `${terminada.eventos.map(e => JSON.stringify(e)).join('\n')}\n{"type":"resul`
  );
  fs.writeFileSync(
    indice(),
    JSON.stringify({
      version: 2,
      ultima: null,
      cola: [],
      busquedas: [{ ...terminada, eventos: 5 }],
    })
  );
  fs.writeFileSync(eventosDe('huerfana'), '{"type":"inicio","seq":0}\n');
  const fondo = cargar();
  assert.deepEqual(await fondo.restaurar(), { retomadas: 0, terminadas: 1 });
  assert.equal(lineas('terminada').length, 5);
  assert.ok(fs.readFileSync(eventosDe('terminada'), 'utf8').endsWith('\n'));
  assert.ok(!fs.existsSync(eventosDe('huerfana')), 'lo que no es de ninguna búsqueda se borra');
});

test('CS-02: un índice ilegible se aparta, no se pisa', async () => {
  limpiar();
  fs.writeFileSync(indice(), '{"version":2,"busq');
  const fondo = cargar();
  assert.deepEqual(await fondo.restaurar(), { retomadas: 0, terminadas: 0 });
  const apartados = fs.readdirSync(dir).filter(n => n.startsWith('busquedas.json.corrupto-'));
  assert.equal(apartados.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, apartados[0]), 'utf8'), '{"version":2,"busq');
});
