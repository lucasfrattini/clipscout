'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULO = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'albumes.js')).href;

const r = (ficha, n) => ({
  url: `https://ejemplo.com/m/${ficha}-${n}.mp4`,
  sourceUrl: `https://ejemplo.com/v/${ficha}`,
});

test('un álbum se pliega en su primer fichero visible y se despliega junto', async () => {
  const { plegarAlbumes } = await import(MODULO);
  const lista = [r('a', 1), r('b', 1), r('a', 2), r('a', 3), { url: 'https://ejemplo.com/v/c' }];
  const plegada = plegarAlbumes(lista);
  assert.deepEqual(
    plegada.lista.map(x => x.url),
    [lista[0].url, lista[1].url, lista[4].url]
  );
  assert.equal(plegada.albumes.get('https://ejemplo.com/v/a').length, 3);
  assert.equal(
    plegada.albumes.has('https://ejemplo.com/v/b'),
    false,
    'un solo fichero no es álbum'
  );

  const abierta = plegarAlbumes(lista, new Set(['https://ejemplo.com/v/a']));
  assert.deepEqual(
    abierta.lista.map(x => x.url),
    [lista[0].url, lista[2].url, lista[3].url, lista[1].url, lista[4].url],
    'los miembros van juntos detrás del primero'
  );
  // Los filtros son por fichero: si solo pasa uno, ya no es un álbum plegado
  assert.equal(plegarAlbumes([r('a', 2)]).albumes.size, 0);
});
