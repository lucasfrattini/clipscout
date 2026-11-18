'use strict';

/**
 * Proxy de salida caído (fase 4, punto 5): se detecta con una prueba corta (túnel CONNECT), las
 * búsquedas no esperan a cada sitio y la interfaz tiene de dónde sacar el aviso.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-proxy-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.DATA_DIR = dir;
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';

const config = require('../src/config');
const proxySalida = require('../src/services/proxySalida');
const { buscarEnTodos, buscarEnlace } = require('../src/services/busqueda');
const { createApp } = require('../src/app');

test.after(() => {
  config.outboundProxy = '';
  config.outboundProxyBypass.length = 0;
  proxySalida._reiniciar();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Un «proxy» de juguete que contesta al CONNECT con `respuesta` (o calla, si es null). */
async function proxyFalso(respuesta) {
  const recibidos = [];
  const server = net.createServer(s => {
    s.on('data', d => {
      recibidos.push(d.toString());
      if (respuesta) s.write(respuesta);
    });
    s.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, recibidos, url: `http://usuario:clave@127.0.0.1:${server.address().port}` };
}

/** Un puerto donde no escucha nadie. */
async function puertoLibre() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise(r => s.close(r));
  return port;
}

test('sin proxy configurado: no se prueba nada y la búsqueda sigue', async () => {
  proxySalida._reiniciar();
  config.outboundProxy = '';
  const e = await proxySalida.asegurar();
  assert.equal(e.configurado, false);
  assert.equal(e.ok, true);
});

test('proxy que abre el túnel: responde (con su usuario en la petición, no en el estado)', async t => {
  proxySalida._reiniciar();
  const p = await proxyFalso('HTTP/1.1 200 Connection established\r\n\r\n');
  t.after(() => p.server.close());
  config.outboundProxy = p.url;
  const e = await proxySalida.probar();
  assert.equal(e.ok, true);
  assert.equal(e.configurado, true);
  assert.ok(e.comprobado);
  assert.match(p.recibidos.join(''), /^CONNECT example\.com:443 HTTP\/1\.1/);
  assert.match(p.recibidos.join(''), /Proxy-Authorization: Basic /);
  assert.ok(!e.proxy.includes('clave'), 'la contraseña no se enseña');
});

test('proxy vivo pero sin salida (502): no responde', async t => {
  proxySalida._reiniciar();
  const p = await proxyFalso('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  t.after(() => p.server.close());
  config.outboundProxy = p.url;
  const e = await proxySalida.probar();
  assert.equal(e.ok, false);
  assert.equal(e.codigo, 'tunel');
  assert.match(e.error, /502/);
});

test('proxy que calla: se da por caído al tiempo máximo, no a los 30 s', async t => {
  proxySalida._reiniciar();
  const p = await proxyFalso(null);
  t.after(() => p.server.close());
  config.outboundProxy = p.url;
  const inicio = Date.now();
  const e = await proxySalida.probar({ timeoutMs: 300 });
  assert.equal(e.ok, false);
  assert.equal(e.codigo, 'tiempo');
  assert.ok(Date.now() - inicio < 2000);
});

test('proxy apagado (conexión rechazada): caído al momento', async () => {
  proxySalida._reiniciar();
  config.outboundProxy = `http://127.0.0.1:${await puertoLibre()}`;
  const e = await proxySalida.probar();
  assert.equal(e.ok, false);
  assert.equal(e.codigo, 'rechaza');
});

test('dos pruebas a la vez comparten una sola conexión', async t => {
  proxySalida._reiniciar();
  const p = await proxyFalso('HTTP/1.1 200 OK\r\n\r\n');
  t.after(() => p.server.close());
  config.outboundProxy = p.url;
  await Promise.all([proxySalida.probar(), proxySalida.probar(), proxySalida.asegurar()]);
  assert.equal(p.recibidos.length, 1);
});

test('búsqueda con el proxy caído: los sitios por proxy fallan ya; los «sin VPN» se buscan', async t => {
  proxySalida._reiniciar();
  const sitio = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url.startsWith('/buscar')) return res.end('<a href="/v/1">1</a>');
    return res.end('<video src="/m/1.mp4"></video>');
  });
  await new Promise(r => sitio.listen(0, '127.0.0.1', r));
  t.after(() => sitio.close());
  const puerto = sitio.address().port;
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({
      profiles: [
        {
          name: 'por proxy',
          config: {
            searchUrl: `http://localhost:${puerto}/buscar?q={q}`,
            linkPattern: '/v/',
            fileExtensions: '.mp4',
          },
        },
        {
          name: 'directo',
          config: {
            searchUrl: `http://127.0.0.1:${puerto}/buscar?q={q}`,
            linkPattern: '/v/',
            fileExtensions: '.mp4',
          },
        },
      ],
    })
  );
  config.outboundProxy = `http://127.0.0.1:${await puertoLibre()}`;
  config.outboundProxyBypass.splice(0, config.outboundProxyBypass.length, '127.0.0.1');
  t.after(() => {
    config.outboundProxyBypass.length = 0;
  });
  const eventos = [];
  const inicio = Date.now();
  const r = await buscarEnTodos({ q: 'playa', paginas: 1 }, { emit: e => eventos.push(e) });
  assert.ok(Date.now() - inicio < 5000);
  assert.ok(eventos.some(e => e.type === 'proxy_caido'));
  const fin = id => eventos.find(e => e.type === 'sitio_fin' && e.sitio === id);
  assert.equal(fin(0).error, proxySalida.ERROR_PROXY);
  assert.equal(fin(1).error, undefined);
  assert.equal(fin(1).total, 1);
  assert.equal(r.total, 1);

  // Un enlace pegado tampoco espera.
  const ev2 = [];
  await buscarEnlace({ url: `http://localhost:${puerto}/v/1` }, { emit: e => ev2.push(e) });
  assert.equal(ev2.find(e => e.type === 'sitio_fin').error, proxySalida.ERROR_PROXY);
});

test('API: estado y «Probar»', async t => {
  proxySalida._reiniciar();
  const p = await proxyFalso('HTTP/1.1 200 OK\r\n\r\n');
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
  t.after(() => {
    p.server.close();
    app.close();
  });
  config.outboundProxy = p.url;
  const base = `http://127.0.0.1:${app.address().port}/api/ajustes/proxy`;
  const antes = await (await fetch(base)).json();
  assert.equal(antes.configurado, true);
  assert.equal(antes.ok, null, 'leer no prueba');
  const probado = await (await fetch(`${base}/probar`, { method: 'POST' })).json();
  assert.equal(probado.ok, true);
  assert.equal((await (await fetch(base)).json()).ok, true);
});
