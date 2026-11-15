'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-jddirecto-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const jd = require('../src/services/jdownloader');
const paquetes = require('../src/services/paquetesJd');
const directo = require('../src/services/directo');

/**
 * Cuando JDownloader no puede con una ficha («Server error 404»), se le manda el fichero directo,
 * resuelto fresco, con la ficha como origen, al mismo paquete y carpeta; y el enlace caído se
 * quita. Todo contra un JDownloader FALSO.
 */

// Sitio: la ficha /v/1 tiene su vídeo; /v/2 no tiene ninguno.
const sitio = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url === '/v/1') return res.end('<title>Playa</title><video src="/m/1.mp4"></video>');
  return res.end('<title>Nada</title>');
});

// JDownloader falso con estado: un paquete «Playa» en /output/Viajes con un enlace caído.
const anadidos = [];
const quitados = [];
const quitadosCapturador = [];
let limpiado = 0;
let enlacesDescarga = [];
let enlacesCapturador = [];
const jdFalso = http.createServer((req, res) => {
  const [ruta, query = ''] = req.url.split('?');
  const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
  const responder = data => res.end(JSON.stringify({ data }));
  if (ruta === '/jd/version') return responder(1);
  if (ruta === '/config/get') return responder('/output');
  if (ruta === '/linkgrabberv2/addLinks') {
    anadidos.push(params[0]);
    return responder({ id: 500 + anadidos.length });
  }
  if (ruta === '/downloadsV2/queryPackages') {
    return responder([
      { uuid: 10, name: 'Playa', saveTo: '/output/Viajes', status: 'Server error 404' },
      { uuid: 11, name: 'Playa', saveTo: '/output/Otra' },
    ]);
  }
  if (ruta === '/downloadsV2/queryLinks') {
    return responder(enlacesDescarga.filter(l => params[0].packageUUIDs.includes(l.packageUUID)));
  }
  if (ruta === '/linkgrabberv2/queryLinks') return responder(enlacesCapturador);
  if (ruta === '/downloadsV2/removeLinks') {
    quitados.push(params[0]);
    return responder(null);
  }
  if (ruta === '/linkgrabberv2/removeLinks') {
    quitadosCapturador.push(params[0]);
    return responder(null);
  }
  if (ruta === '/linkgrabberv2/clearList') {
    limpiado += 1;
    return responder(null);
  }
  return responder([]);
});

let base;
before(async () => {
  sitio.listen(0, '127.0.0.1');
  jdFalso.listen(0, '127.0.0.1');
  await Promise.all([sitio, jdFalso].map(s => new Promise(r => s.once('listening', r))));
  base = `http://127.0.0.1:${sitio.address().port}`;
  // Sin autostart: así no entra en juego la espera del capturador (tiene su propio test).
  await jd.guardar({ url: `http://127.0.0.1:${jdFalso.address().port}`, autostart: false });
});

after(() => {
  paquetes.parar();
  sitio.close();
  jdFalso.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estado de un paquete a partir de sus enlaces', () => {
  const { resumir, fallido } = paquetes;
  assert.equal(resumir([], []).estado, 'enviado');
  assert.equal(resumir([{ finished: true }, { finished: true }], []).estado, 'terminado');
  assert.equal(resumir([{ finished: true }, { running: true }], []).estado, 'bajando');
  assert.equal(resumir([{ finished: true }, { status: 'Server error 404' }], []).estado, 'error');
  assert.equal(resumir([{}], [{ availability: 'ONLINE' }]).estado, 'cola');
  assert.equal(fallido({ status: 'Server error 404' }), true);
  assert.equal(fallido({ status: 'Server error 404', finished: true }), false);
  assert.equal(fallido({ status: 'Waiting' }), false);
});

test('un enlace caído se sustituye por el fichero directo, una vez por ficha', async () => {
  const ficha = `${base}/v/1`;
  const r = await jd.enviar({ links: [ficha], carpeta: 'Viajes', paquete: 'Playa' });
  assert.equal(r.carpeta, '/output/Viajes');
  assert.equal(anadidos.length, 1);
  assert.equal(anadidos[0].links, ficha);

  enlacesDescarga = [
    { uuid: 100, packageUUID: 10, url: ficha, status: 'Server error 404' },
    // mismo nombre de paquete pero OTRA carpeta: no es nuestro
    { uuid: 200, packageUUID: 11, url: ficha, status: 'Server error 404' },
  ];
  const vuelta = await paquetes.revisar();
  assert.equal(vuelta.sustituidas, 1);
  assert.equal(anadidos.length, 2);
  assert.deepEqual(
    {
      links: anadidos[1].links,
      sourceUrl: anadidos[1].sourceUrl,
      packageName: anadidos[1].packageName,
      destinationFolder: anadidos[1].destinationFolder,
    },
    {
      links: `${base}/m/1.mp4`,
      sourceUrl: ficha,
      packageName: 'Playa',
      destinationFolder: '/output/Viajes',
    }
  );
  assert.deepEqual(quitados, [[100]], 'el caído se quita; el del otro paquete, no');

  const [p] = await paquetes.listar();
  assert.deepEqual(p.sustituidas, [ficha]);
  assert.equal(p.directos[`${base}/m/1.mp4`], ficha);

  // Sigue caído (el falso no cambia): no se insiste solo…
  await paquetes.revisar();
  assert.equal(anadidos.length, 2);
  // …pero «Reintentar» sí lo vuelve a mandar, fresco.
  await paquetes.revisar({ soloId: p.id, forzar: true });
  assert.equal(anadidos.length, 3);
  assert.equal(anadidos[2].links, `${base}/m/1.mp4`);
});

test('en el capturador: OFFLINE también se sustituye; sin fichero, se apunta y no se toca', async () => {
  enlacesDescarga = [];
  const sinVideo = `${base}/v/2`;
  await jd.enviar({ links: [sinVideo], carpeta: 'Viajes', paquete: 'Otra cosa' });
  const antes = anadidos.length;
  enlacesCapturador = [{ uuid: 300, url: sinVideo, availability: 'OFFLINE' }];
  const [p] = await paquetes.listar();
  await paquetes.revisar({ soloId: p.id });
  assert.equal(anadidos.length, antes, 'sin fichero no se manda nada');
  const [despues] = await paquetes.listar();
  assert.deepEqual(despues.sinDirecto, [sinVideo]);
  assert.equal(despues.estado, 'error');
  assert.deepEqual(quitadosCapturador, []);
  enlacesCapturador = [];
});

test('sitio marcado «fichero directo»: se manda el fichero desde el principio', async () => {
  await directo.guardarOpcionesSitio('127.0.0.1', { jdDirecto: true });
  const antes = anadidos.length;
  const ficha = `${base}/v/1`;
  const r = await jd.enviar({ links: [ficha], carpeta: 'Viajes', paquete: 'Directo' });
  assert.equal(r.directos, 1);
  for (let i = 0; i < 50 && anadidos.length === antes; i++) {
    await new Promise(res => setTimeout(res, 20));
  }
  assert.equal(anadidos.length, antes + 1, 'un solo addLinks: el del fichero, no el de la ficha');
  assert.equal(anadidos.at(-1).links, `${base}/m/1.mp4`);
  assert.equal(anadidos.at(-1).sourceUrl, ficha);
  await directo.guardarOpcionesSitio('127.0.0.1', { jdDirecto: false });
});

test('panel: lista con estado, reintentar y vaciar el capturador (con el JD falso)', async t => {
  const { createApp } = require('../src/app');
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => app.close());
  const api = `http://127.0.0.1:${app.address().port}/api/ajustes/jdownloader`;
  const ficha = `${base}/v/1`;
  await jd.enviar({ links: [ficha], carpeta: 'Viajes', paquete: 'Playa' });
  enlacesDescarga = [{ uuid: 100, packageUUID: 10, url: ficha, status: 'Server error 404' }];

  const lista = await (await fetch(`${api}/paquetes?revisar=1`)).json();
  const p = lista.paquetes[0];
  assert.equal(p.nombre, 'Playa');
  assert.equal(p.directos, 1, 'la revisión ya mandó el fichero directo');
  assert.equal(p.estado, 'error');

  const antes = anadidos.length;
  const r = await fetch(`${api}/paquetes/${p.id}/reintentar`, { method: 'POST' });
  assert.equal((await r.json()).sustituidas, 1);
  assert.equal(anadidos.length, antes + 1);
  const noExiste = await fetch(`${api}/paquetes/nada/reintentar`, { method: 'POST' });
  assert.equal(noExiste.status, 404);

  const vaciar = await fetch(`${api}/vaciar-capturador`, { method: 'POST' });
  assert.deepEqual(await vaciar.json(), { ok: true });
  assert.equal(limpiado, 1);
  enlacesDescarga = [];
  paquetes.parar();
});
