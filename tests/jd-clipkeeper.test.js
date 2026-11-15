'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-jdck-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');

const crew = require('../src/services/crew');
const jd = require('../src/services/jdownloader');
const paquetes = require('../src/services/paquetesJd');

/**
 * Cuando JDownloader termina un paquete, clipkeeper escanea esa carpeta al momento (contrato
 * POST /api/crew/v1/escanear), una sola vez por paquete. Sin clipkeeper, nada.
 */

let terminado = false;
const jdFalso = http.createServer((req, res) => {
  const [ruta, query = ''] = req.url.split('?');
  const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
  const responder = data => res.end(JSON.stringify({ data }));
  if (ruta === '/jd/version') return responder(1);
  if (ruta === '/config/get') return responder('/output');
  if (ruta === '/linkgrabberv2/addLinks') return responder({ id: 7 });
  if (ruta === '/downloadsV2/queryPackages') {
    return responder([{ uuid: 1, name: 'Playa', saveTo: '/output/Viajes/Playa' }]);
  }
  if (ruta === '/downloadsV2/queryLinks') {
    return responder(
      params[0].packageUUIDs.includes(1)
        ? [
            {
              uuid: 10,
              packageUUID: 1,
              url: 'https://ejemplo.com/v/1',
              ...(terminado ? { finished: true } : { running: true }),
            },
          ]
        : []
    );
  }
  return responder([]);
});

const escaneos = [];
const clipkeeper = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', c => (cuerpo += c));
  req.on('end', () => {
    if (req.url === '/api/crew/v1/escanear' && req.method === 'POST') {
      escaneos.push({ clave: req.headers['x-api-key'], cuerpo: JSON.parse(cuerpo) });
      res.statusCode = 202;
      return res.end(JSON.stringify({ encolado: true }));
    }
    res.statusCode = 404;
    return res.end('{}');
  });
});

before(async () => {
  jdFalso.listen(0, '127.0.0.1');
  clipkeeper.listen(0, '127.0.0.1');
  await Promise.all([jdFalso, clipkeeper].map(s => new Promise(r => s.once('listening', r))));
  await jd.guardar({
    url: `http://127.0.0.1:${jdFalso.address().port}`,
    autostart: false,
    biblioteca: 3,
  });
});

after(() => {
  paquetes.parar();
  jdFalso.close();
  clipkeeper.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sin clipkeeper conectado no se avisa a nadie (ni se insiste)', async () => {
  await jd.enviar({
    links: ['https://ejemplo.com/v/1'],
    carpeta: 'Viajes/Playa',
    paquete: 'Playa',
  });
  terminado = true;
  await paquetes.revisar();
  const [p] = await paquetes.listar();
  assert.equal(p.estado, 'terminado');
  assert.equal(p.sinClipkeeper, true);
  assert.equal(paquetes.faltaAviso(p), false);
  terminado = false;
});

test('paquete terminado → clipkeeper escanea su carpeta, una vez', async () => {
  await crew.guardarConexion({
    app: 'clipkeeper',
    url: `http://127.0.0.1:${clipkeeper.address().port}`,
    api_key: 'clave-de-clipkeeper',
  });
  await jd.enviar({
    links: ['https://ejemplo.com/v/1'],
    carpeta: 'Viajes/Playa',
    paquete: 'Playa',
  });
  await paquetes.revisar();
  assert.equal(escaneos.length, 0, 'bajando todavía: nada');
  terminado = true;
  await paquetes.revisar();
  assert.deepEqual(escaneos, [
    { clave: 'clave-de-clipkeeper', cuerpo: { biblioteca_id: 3, carpeta: 'Viajes/Playa' } },
  ]);
  await paquetes.revisar();
  assert.equal(escaneos.length, 1, 'una sola vez por paquete');
  const [p] = await paquetes.listar();
  assert.ok(p.escaneado);
});
