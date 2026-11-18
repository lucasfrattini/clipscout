'use strict';

/**
 * CS-03: una programada que estaba en marcha al reiniciar se recoge (su búsqueda se retoma y su
 * resultado se trata como siempre) y no se lanza otra encima.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-prog4-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.BROWSER_ENABLED = 'false';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_FONDO_MAX_ACTIVAS = '0';

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ahora = Date.now();
const programada = extra => ({
  id: 'p1',
  termino: 'paisaje',
  carpeta: '',
  persona: '',
  etiqueta: '',
  minutosMinimo: 0,
  sinDuracion: false,
  contener: '',
  excluir: '',
  cadaDias: 7,
  abierta: false,
  activa: true,
  ultimaVez: null,
  ultimo: null,
  ...extra,
});

test('toca: con una vuelta en marcha no se lanza otra', () => {
  const { toca } = require('../src/services/programadas');
  assert.equal(toca(programada()), true);
  assert.equal(toca(programada({ enCurso: { busqueda: 'x' } })), false);
});

test('tras un reinicio se recoge la búsqueda de la programada y se quita la marca', async () => {
  fs.writeFileSync(
    process.env.CREW_PATH,
    JSON.stringify({ programadas: [programada({ enCurso: { busqueda: 'b-prog' } })] })
  );
  // La búsqueda ya había terminado justo antes del corte (formato 2: índice + eventos).
  fs.mkdirSync(path.join(dir, 'busquedas'), { recursive: true });
  const eventos = [
    { type: 'inicio', seq: 0 },
    {
      type: 'resultados',
      sitio: 0,
      items: [
        { url: 'https://ejemplo.com/m/1.mp4', sourceUrl: 'https://ejemplo.com/v/1', title: 'a' },
        { url: 'https://ejemplo.com/m/2.mp4', sourceUrl: 'https://ejemplo.com/v/2', title: 'b' },
      ],
      seq: 1,
    },
    { type: 'fin', total: 2, seq: 2 },
  ];
  fs.writeFileSync(
    path.join(dir, 'busquedas', 'b-prog.jsonl'),
    eventos.map(e => `${JSON.stringify(e)}\n`).join('')
  );
  fs.writeFileSync(
    path.join(dir, 'busquedas.json'),
    JSON.stringify({
      version: 2,
      ultima: null,
      cola: [],
      busquedas: [
        {
          id: 'b-prog',
          entrada: { q: 'paisaje' },
          q: 'paisaje',
          origen: 'programada',
          estado: 'fin',
          creadaEn: ahora - 5000,
          terminadaEn: ahora - 1000,
          eventos: 3,
        },
      ],
    })
  );
  const fondo = require('../src/services/busquedasFondo');
  const programadas = require('../src/services/programadas');
  const crew = require('../src/services/crew');
  fondo.restaurar();
  await programadas.reenganchar();
  let p;
  for (let i = 0; i < 100; i++) {
    p = (await crew.datos()).programadas[0];
    if (p.ultimo) break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(p.ultimo.encontrados, 2, 'lo encontrado por la búsqueda retomada');
  assert.ok(p.ultimaVez);
  assert.equal(p.enCurso, undefined);
  assert.equal(programadas.enMarcha(), false);
});

test('si su búsqueda ya no existe, se olvida la marca (se lanzará cuando le toque)', async () => {
  const crew = require('../src/services/crew');
  await crew.cambiar(d => {
    d.programadas = [programada({ enCurso: { busqueda: 'no-existe' } })];
  });
  const programadas = require('../src/services/programadas');
  await programadas.reenganchar();
  const p = (await crew.datos()).programadas[0];
  assert.equal(p.enCurso, undefined);
  assert.equal(programadas.toca(p), true);
});
