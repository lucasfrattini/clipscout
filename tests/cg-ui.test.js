'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Paquete común de interfaz (SU-17): `public/cg/` es una COPIA byte a byte de la canónica, que
 * vive en clonbuster (`src/clonbuster/web/cg/`). Si alguien la toca aquí, las tres apps dejan de
 * verse y portarse igual sin que nada falle: este test lo para. Al copiar una versión nueva se
 * actualizan estas constantes (y las de los otros dos repos).
 */
const MD5 = {
  'cg-ui.css': '6433880eceb42d7f9997ecfac183cb10',
  'cg-ui.js': '2d58c724c1ba79cf67d7aa90cf562f01',
};

const dir = path.join(__dirname, '..', 'public', 'cg');

for (const [fichero, esperado] of Object.entries(MD5)) {
  test(`cg/${fichero} es la copia idéntica del paquete común`, () => {
    const md5 = crypto
      .createHash('md5')
      .update(fs.readFileSync(path.join(dir, fichero)))
      .digest('hex');
    assert.strictEqual(md5, esperado, `${fichero} no coincide con la copia canónica de clonbuster`);
  });
}

test('index.html carga el paquete común con defer y antes que la app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/cg\/cg-ui\.css" \/>/);
  assert.match(html, /<script src="\/cg\/cg-ui\.js" defer><\/script>/);
  assert.ok(
    html.indexOf('/cg/cg-ui.js') < html.indexOf('/js/app.js'),
    'cg-ui.js tiene que ir antes que app.js para que los componentes existan al arrancar'
  );
});
