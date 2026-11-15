'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-autocon-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');

const crew = require('../src/services/crew');
const { createApp } = require('../src/app');

/**
 * Instalación conjunta: con CLIPGEIST_CLAVE esa es la clave de esta app, y con las URLs de las
 * otras se conecta sola al arrancar (idempotente, sin tocar las conexiones hechas a mano, y
 * reintentando si la otra aún no responde). Sin las variables, nada cambia.
 */

const CLAVE = '0123456789abcdef0123456789abcdef';

function appFalsa(app) {
  let arrancada = false;
  const s = http.createServer((req, res) => {
    if (!arrancada) {
      res.statusCode = 503;
      return res.end();
    }
    if (req.url === '/api/crew/v1/status' && req.headers['x-api-key'] === CLAVE) {
      return res.end(JSON.stringify({ crew: 'Clipgeist', protocolo: 1, app, instancia: app }));
    }
    res.statusCode = 401;
    return res.end('{}');
  });
  s.arrancar = () => {
    arrancada = true;
  };
  return s;
}

test.after(() => {
  for (const v of ['CLIPGEIST_CLAVE', 'CLIPGEIST_CLIPKEEPER_URL', 'CLIPGEIST_CLONBUSTER_URL']) {
    delete process.env[v];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sin CLIPGEIST_CLAVE no hace nada', async () => {
  assert.deepEqual(await crew.autoconectar(), {});
  assert.equal((await crew.datos()).claveDelEntorno, undefined);
});

test('con las variables: clave del entorno, conexiones solas, reintento y nada a mano tocado', async t => {
  const clipkeeper = appFalsa('clipkeeper');
  const clonbuster = appFalsa('clonbuster');
  clipkeeper.listen(0, '127.0.0.1');
  clonbuster.listen(0, '127.0.0.1');
  await Promise.all([clipkeeper, clonbuster].map(s => new Promise(r => s.once('listening', r))));
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => {
    clipkeeper.close();
    clonbuster.close();
    app.close();
  });
  const urlCk = `http://127.0.0.1:${clipkeeper.address().port}`;
  const urlCb = `http://127.0.0.1:${clonbuster.address().port}`;
  // Una conexión hecha A MANO con la URL de clonbuster: no se toca.
  await crew.guardarConexion({ app: 'clonbuster', url: urlCb, api_key: 'clave-manual' });

  process.env.CLIPGEIST_CLAVE = CLAVE;
  process.env.CLIPGEIST_CLIPKEEPER_URL = urlCk;
  process.env.CLIPGEIST_CLONBUSTER_URL = urlCb;

  // La API ya pide la clave del entorno
  const api = `http://127.0.0.1:${app.address().port}/api/crew/v1/status`;
  assert.equal((await fetch(api, { headers: { 'X-Api-Key': CLAVE } })).status, 200);
  const regenerar = await fetch(`http://127.0.0.1:${app.address().port}/api/ajustes/api-key`, {
    method: 'POST',
  });
  assert.equal(regenerar.status, 409);

  // clipkeeper aún no arrancó: primer intento «no_responde», y lo reintenta solo.
  const primero = await crew.autoconectar({ cadaMs: 30, maxMs: 2000 });
  assert.deepEqual(primero, { clipkeeper: 'no_responde', clonbuster: 'manual' });
  clipkeeper.arrancar();
  let conexiones = [];
  for (let i = 0; i < 100; i++) {
    conexiones = await crew.listar();
    if (conexiones.some(c => c.app === 'clipkeeper')) break;
    await new Promise(r => setTimeout(r, 20));
  }
  const ck = conexiones.find(c => c.app === 'clipkeeper');
  assert.equal(ck.url, urlCk);
  assert.equal(ck.auto, true);
  const manual = (await crew.datos()).conexiones.find(c => c.url === urlCb);
  assert.equal(manual.api_key, 'clave-manual', 'la hecha a mano sigue como estaba');

  // Idempotente: otra vuelta no duplica ni cambia nada
  assert.deepEqual(await crew.autoconectar(), { clipkeeper: 'igual', clonbuster: 'manual' });
  assert.equal((await crew.listar()).filter(c => c.app === 'clipkeeper').length, 1);
  // La clave guardada en el fichero no se tocó: sin la variable vuelve a valer la suya
  assert.notEqual(JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8')).api_key, CLAVE);
});
