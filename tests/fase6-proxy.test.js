'use strict';

/**
 * CS-N11: el proxy de salida desde Ajustes (en caliente, sin reiniciar) y «Probar» con la
 * dirección de salida. Todo local: un proxy de juguete que abre el túnel y contesta como el
 * servicio que dice la IP.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-proxy6-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.OUTBOUND_PROXY_URL_IP = 'http://ip.example/cdn-cgi/trace';
delete process.env.ADMIN_PASSWORD;
delete process.env.CLIPGEIST_CLAVE;

const config = require('../src/config');
const proxySalida = require('../src/services/proxySalida');
const respaldos = require('../src/services/respaldos');
const { agentesSeguros } = require('../src/lib/http');
const { createApp } = require('../src/app');

/**
 * Proxy de juguete: al CONNECT responde 200 (el túnel de la prueba) y a un GET absoluto (lo que
 * manda el agente HTTP por un proxy) contesta como el servicio de la IP.
 */
const pedidas = [];
const proxy = net.createServer(s => {
  s.on('data', d => {
    const texto = d.toString();
    pedidas.push(texto.split('\r\n')[0]);
    if (texto.startsWith('CONNECT')) s.write('HTTP/1.1 200 Connection established\r\n\r\n');
    else {
      const cuerpo = 'fl=1\nip=203.0.113.9\nts=1\n';
      s.end(
        `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${cuerpo.length}\r\n\r\n${cuerpo}`
      );
    }
  });
  s.on('error', () => {});
});

let servidor;
let base;
before(async () => {
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  proxySalida._reiniciar();
  require('../src/lib/http').usarProxy('');
  servidor.close();
  proxy.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const pedir = (ruta, metodo = 'GET', cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

test('guardar un proxy no válido: 400 y nada cambia', async () => {
  const r = await pedir('/api/ajustes/proxy', 'PUT', { url: 'ftp://equipo:21' });
  assert.equal(r.status, 400);
  assert.equal(config.outboundProxy, '');
});

test('guardar, aplicar en caliente, probar con la dirección de salida y volver al entorno', async () => {
  const url = `http://ana:secreta@127.0.0.1:${proxy.address().port}`;
  const directo = agentesSeguros().httpAgent;
  let r = await (await pedir('/api/ajustes/proxy', 'PUT', { url })).json();
  assert.equal(r.configurado, true);
  assert.equal(r.origen, 'ajustes');
  assert.match(r.proxy, /\/\/\*\*\*@127\.0\.0\.1/, 'sin credenciales a la vista');
  assert.notEqual(agentesSeguros().httpAgent, directo, 'los agentes cambian sin reiniciar');

  const prueba = await (await pedir('/api/ajustes/proxy/probar', 'POST', {})).json();
  assert.equal(prueba.ok, true);
  assert.equal(prueba.salida.ip, '203.0.113.9');
  assert.ok(pedidas.some(p => p.startsWith('CONNECT')));
  assert.ok(pedidas.some(p => p.startsWith('GET http://ip.example/cdn-cgi/trace')));

  // Guardado en crew.json; la copia lo lleva sin usuario ni contraseña.
  const crew = JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8'));
  assert.equal(crew.proxySalida.url, url);
  assert.equal(
    respaldos.sinSecretos(crew).proxySalida.url,
    `http://127.0.0.1:${proxy.address().port}`
  );

  // Sin proxy aunque el entorno tuviera uno; y null: volver al del entorno (aquí, ninguno).
  r = await (await pedir('/api/ajustes/proxy', 'PUT', { url: '' })).json();
  assert.equal(r.configurado, false);
  assert.equal(agentesSeguros().httpAgent, directo);
  r = await (await pedir('/api/ajustes/proxy', 'PUT', { url: null })).json();
  assert.equal(r.configurado, false);
  assert.equal(JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8')).proxySalida, undefined);
});
