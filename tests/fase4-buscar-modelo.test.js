'use strict';

/**
 * CS-22: el modelo puro de la pantalla Buscar (public/js/buscarModelo.js): qué se ve de lo
 * encontrado (filtros, orden, repetidos, álbumes) sin navegador.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULO = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'buscarModelo.js')).href;
let m;
test.before(async () => {
  m = await import(MODULO);
});

const filtros = (extra = {}) => ({
  ocultarTengo: true,
  ocultarEnviados: true,
  enBiblioteca: new Set(),
  enviados: new Set(),
  contener: [],
  excluir: [],
  soloFrase: false,
  idioma: '',
  minDuracion: 0,
  textoNormal: m.crearTextoNormal(),
  ...extra,
});
const estado = (extra = {}) => ({
  orden: 'llegada',
  enPestana: () => true,
  ocultarRepetidos: true,
  copias: new Map(),
  albumesAbiertos: new Set(),
  verOcultos: false,
  filtros: filtros(),
  ...extra,
});
const r = (n, extra = {}) => ({
  sitio: 0,
  url: `https://ejemplo.com/m/${n}.mp4`,
  sourceUrl: `https://ejemplo.com/v/${n}`,
  title: `Clip de prueba ${n}`,
  durationSeconds: n * 60,
  ...extra,
});

test('tipoDeEntrada: enlace, dominio o palabra', () => {
  assert.equal(m.tipoDeEntrada('https://ejemplo.com/v/1'), 'enlace');
  assert.equal(m.tipoDeEntrada('ejemplo.com/v/1 ejemplo.com/v/2'), 'enlace');
  assert.equal(m.tipoDeEntrada('ejemplo.com'), 'dominio');
  assert.equal(m.tipoDeEntrada('playa de arena'), 'palabra');
  assert.equal(m.tipoDeEntrada('   '), 'palabra');
});

test('nombreDeUrl: el último trozo de la ruta, legible', () => {
  assert.equal(m.nombreDeUrl('https://ejemplo.com/v/clip-de_prueba.mp4'), 'clip de prueba');
  assert.equal(m.nombreDeUrl('no es una dirección'), '');
});

test('motivoOculto: cada filtro con su motivo, en orden', () => {
  const f = filtros({
    enBiblioteca: new Set([r(1).sourceUrl]),
    enviados: new Set([r(2).sourceUrl]),
    excluir: ['lluvia'],
    contener: ['clip'],
    minDuracion: 5,
  });
  assert.equal(m.motivoOculto(r(9, { bloqueada: 'x' }), f), 'bloqueada');
  assert.equal(m.motivoOculto(r(1), f), 'tengo');
  assert.equal(m.motivoOculto(r(2), f), 'enviado');
  assert.equal(m.motivoOculto(r(9, { title: 'clip con lluvia' }), f), 'excluir');
  assert.equal(m.motivoOculto(r(9, { title: 'otra cosa' }), f), 'contener');
  assert.equal(m.motivoOculto(r(3), f), 'duracion');
  assert.equal(m.motivoOculto(r(9), f), null);
  // Lo ya tenido se ve si se desactiva su filtro.
  assert.equal(m.motivoOculto(r(1), { ...f, ocultarTengo: false, minDuracion: 0 }), null);
  // Idioma: un «dudoso» no se oculta nunca.
  const fi = filtros({ idioma: 'es' });
  assert.equal(m.motivoOculto(r(9, { idioma: 'en' }), fi), 'idioma');
  assert.equal(m.motivoOculto(r(9, { idioma: 'dudoso' }), fi), null);
  // Frase exacta: sin dato no se oculta.
  const ff = filtros({ soloFrase: true });
  assert.equal(m.motivoOculto(r(9, { frase: false }), ff), 'frase');
  assert.equal(m.motivoOculto(r(9), ff), null);
});

test('ordenar: sin dato al final y la llegada desempata', () => {
  const lista = [r(2), r(5, { durationSeconds: null }), r(7), r(3, { relevancia: 9 })];
  assert.deepEqual(
    m.ordenar(lista, 'duracion').map(x => x.title),
    ['Clip de prueba 7', 'Clip de prueba 3', 'Clip de prueba 2', 'Clip de prueba 5']
  );
  assert.equal(m.ordenar(lista, 'relevancia')[0].title, 'Clip de prueba 3');
  assert.equal(m.ordenar(lista, 'llegada'), lista);
});

test('calcularLista: repetidos y álbumes plegados, ocultos contados', () => {
  const a = r(1);
  const copia = r(2, {
    url: 'https://otro.example/m/1.mp4',
    sourceUrl: 'https://otro.example/v/1',
  });
  const mismoFichero = { ...a, sitio: -1 };
  const album1 = r(3, { sourceUrl: 'https://ejemplo.com/v/album' });
  const album2 = r(4, { sourceUrl: 'https://ejemplo.com/v/album' });
  const corto = r(0.5);
  const copias = new Map([[copia.url, { representante: a.url }]]);
  const todos = [a, copia, mismoFichero, album1, album2, corto];
  const p = m.calcularLista(todos, estado({ copias, filtros: filtros({ minDuracion: 1 }) }));
  assert.deepEqual(p.lista, [a, album1]);
  assert.equal(p.repetidos, 2);
  assert.equal(p.enAlbumes, 1);
  assert.deepEqual([...p.ocultos], [['duracion', 1]]);
  assert.deepEqual(p.albumes.get('https://ejemplo.com/v/album'), [album1, album2]);
  // Sin plegar repetidos, con el álbum abierto y viendo los ocultos.
  const q = m.calcularLista(
    todos,
    estado({
      copias,
      ocultarRepetidos: false,
      albumesAbiertos: new Set(['https://ejemplo.com/v/album']),
      verOcultos: true,
      filtros: filtros({ minDuracion: 1 }),
    })
  );
  // `a` y `mismoFichero` comparten ficha: sin plegar repetidos forman un álbum (cerrado).
  assert.deepEqual(q.lista, [a, copia, album1, album2]);
  assert.equal(q.pintar.length, 5);
  // La pestaña (un sitio) y lo quitado a mano no entran.
  const s = m.calcularLista(todos, estado({ copias, enPestana: x => x.sitio === -1 }));
  assert.deepEqual(s.lista, [mismoFichero]);
});

test('«los N primeros»: solo los tamaños menores que lo que hay', () => {
  assert.deepEqual(m.tamanosPrimeros(3), []);
  assert.deepEqual(m.tamanosPrimeros(12), [5, 10]);
  assert.deepEqual(m.tamanosPrimeros(80), [5, 10, 20, 50]);
});
