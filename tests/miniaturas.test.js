'use strict';

// Las miniaturas salen de pocas en pocas y solo las que se ven: con cientos a la vez, el resto de
// peticiones (enviar a JDownloader, abrir una ficha) esperaban segundos detrás de ellas.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let alVerse = null;
const vigiladas = new Set();
globalThis.IntersectionObserver = class {
  constructor(cb) {
    alVerse = cb;
  }
  observe(x) {
    vigiladas.add(x);
  }
  unobserve(x) {
    vigiladas.delete(x);
  }
};

function imagen() {
  const oyentes = {};
  return {
    isConnected: true,
    src: '',
    addEventListener(tipo, fn) {
      oyentes[tipo] = fn;
    },
    disparar(tipo) {
      oyentes[tipo]?.();
    },
  };
}

const cargar = () => import(pathToFileURL(path.join(__dirname, '../public/js/miniaturas.js')).href);

test('solo se piden las que se ven, y como mucho 4 a la vez', async () => {
  const { cargarMiniatura, estadoMiniaturas } = await cargar();
  const imgs = Array.from({ length: 10 }, () => imagen());
  imgs.forEach((img, i) => cargarMiniatura(img, `/api/thumbnail?n=${i}`));
  assert.equal(imgs.filter(i => i.src).length, 0, 'nada se pide antes de saber si se ve');

  // Se ven las 6 primeras; las otras 4 no.
  alVerse(imgs.map((img, i) => ({ target: img, isIntersecting: i < 6 })));
  assert.deepEqual(
    imgs.map(i => Boolean(i.src)),
    [true, true, true, true, false, false, false, false, false, false]
  );
  assert.equal(estadoMiniaturas().enVuelo, 4);

  // La 5.ª sale de la pantalla antes de su turno: pierde el sitio, y entra la 6.ª.
  alVerse([{ target: imgs[4], isIntersecting: false }]);
  imgs[0].disparar('load');
  assert.equal(imgs[4].src, '');
  assert.equal(imgs[5].src, '/api/thumbnail?n=5');

  // Una que falla también deja el turno.
  imgs[1].disparar('error');
  assert.equal(estadoMiniaturas().enCola, 0);
  assert.equal(estadoMiniaturas().enVuelo, 3);
  for (const i of [2, 3, 5]) imgs[i].disparar('load');
  assert.equal(estadoMiniaturas().enVuelo, 0);

  // Lo que ya no está en la página no se pide aunque llegue su aviso.
  imgs[6].isConnected = false;
  alVerse([{ target: imgs[6], isIntersecting: true }]);
  assert.equal(imgs[6].src, '');
});
