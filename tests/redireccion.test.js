'use strict';

// Enlaces de salto de los agregadores: se manda la ficha de dentro, y lo que JDownloader nunca
// llega a ver ya no se da por «terminado» en silencio.

const test = require('node:test');
const assert = require('node:assert/strict');
const { desenvolver } = require('../src/lib/redireccion');
const { fichasNoVistas } = require('../src/services/paquetesJd');

const b64 = s => Buffer.from(s).toString('base64');

test('un salto con la ficha en claro o codificada como URL', () => {
  assert.equal(
    desenvolver('https://agregador.example.com/go?url=https%3A%2F%2Fsitio.example.org%2Fv%2F2'),
    'https://sitio.example.org/v/2'
  );
  assert.equal(
    desenvolver('https://agregador.example.com/out/?to=https://sitio.example.org/v/3'),
    'https://sitio.example.org/v/3'
  );
});

test('un salto con la ficha en base64, rodeada de bytes que no son texto', () => {
  const crudo = `Ü\u0001§https://sitio.example.org/video/9/titulo/?utm_source=agrÍ\u0002`;
  const l = encodeURIComponent(b64(crudo));
  assert.equal(
    desenvolver(`https://agregador.example.com/out/?l=${l}&c=abc&v=3&`),
    'https://sitio.example.org/video/9/titulo/'
  );
});

test('lo que no es un salto se queda como está', () => {
  for (const u of [
    'https://sitio.example.org/video/1',
    'https://sitio.example.org/search?q=https://otro.example.com',
    'https://sitio.example.org/video/1?ref=https://otro.example.com/',
    'https://sitio.example.org/go?url=https://sitio.example.org/v/2', // al mismo sitio
    'no es una url',
  ]) {
    assert.equal(desenvolver(u), u, u);
  }
});

test('fichas no vistas: las de sitios de los que JDownloader no enseñó nada', () => {
  const p = {
    fichas: [
      'https://www.uno.example.com/v/1',
      'https://agregador.example.com/out/?l=x',
      'https://dos.example.com/v/2',
    ],
    hostsVistos: ['uno.example.com'],
    directos: { 'https://cdn.example.net/f.mp4': 'https://dos.example.com/v/2' },
  };
  assert.deepEqual(fichasNoVistas(p), ['https://agregador.example.com/out/?l=x']);
});

test('sin nada visto del paquete (bajado y quitado deprisa) solo cuentan los saltos', () => {
  const salto = `https://agregador.example.com/out/?l=${encodeURIComponent(b64('https://tres.example.org/v/3'))}`;
  const p = { fichas: ['https://uno.example.com/v/1', salto], hostsVistos: [], directos: {} };
  assert.deepEqual(fichasNoVistas(p), [salto]);
});
