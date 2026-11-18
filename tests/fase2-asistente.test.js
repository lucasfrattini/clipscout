'use strict';

/**
 * Fase 2: asistente de primer arranque (CS-N3, §2.6) y el código QR propio.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-asis-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
process.env.CLIPGEIST_DETECTAR = 'no';
delete process.env.ADMIN_PASSWORD;
delete process.env.CLIPGEIST_CLAVE;

// La otra app (un clonbuster de mentira): estado con usuario, login y logout.
const llamadas = [];
const otra = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', c => (cuerpo += c));
  req.on('end', () => {
    llamadas.push({ ruta: req.url, metodo: req.method, cuerpo, cookie: req.headers.cookie });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/estado') return res.end(JSON.stringify({ configurado: true }));
    if (req.url === '/api/auth/login') {
      const { usuario, contrasena } = JSON.parse(cuerpo || '{}');
      if (usuario === 'ana' && contrasena === 'la-de-la-otra-1') {
        res.setHeader('Set-Cookie', 'clipgeist_sesion=clonbuster.prueba; Path=/');
        return res.end('{"ok":true}');
      }
      res.statusCode = 401;
      return res.end('{"detail":"no"}');
    }
    if (req.url === '/api/auth/logout') return res.end('{"ok":true}');
    res.statusCode = 404;
    return res.end('{}');
  });
});

const { createApp } = require('../src/app');

let servidor;
let base;
before(async () => {
  await new Promise(r => otra.listen(0, '127.0.0.1', r));
  process.env.CLIPGEIST_CLONBUSTER_URL = `http://127.0.0.1:${otra.address().port}`;
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  otra.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const estado = async () => (await fetch(`${base}/api/auth/estado`)).json();
const post = (ruta, cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

test('instalación nueva: el asistente aparece; con sitios guardados (ya usada), no', async () => {
  assert.equal((await estado()).asistente, true);
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({ version: 1, profiles: [{ name: 'Sitio A', config: {} }] })
  );
  assert.equal((await estado()).asistente, false, 'sin usuario pero ya usada: nada cambia');
  fs.rmSync(process.env.PROFILES_PATH);
  assert.equal((await estado()).asistente, true);
});

test('la página del asistente y sus módulos se sirven; las otras apps se detectan', async () => {
  const pagina = await fetch(`${base}/bienvenida`, { headers: { Accept: 'text/html' } });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /bienvenida\.js/);
  const { apps } = await (await fetch(`${base}/api/auth/apps`)).json();
  assert.deepEqual(
    apps.map(a => [a.app, a.tieneUsuario]),
    [['clonbuster', true]]
  );
});

test('«usar la misma cuenta que clonbuster»: se valida allí, se cierra esa sesión y se crea aquí', async () => {
  const mal = await post('/api/auth/primer-usuario', {
    usuario: 'ana',
    contrasena: 'otra-cualquiera-1',
    cuentaDe: 'clonbuster',
  });
  assert.equal(mal.status, 401);
  assert.equal((await estado()).protegido, false, 'no se crea nada si la otra dice que no');
  const bien = await post('/api/auth/primer-usuario', {
    usuario: 'ana',
    contrasena: 'la-de-la-otra-1',
    cuentaDe: 'clonbuster',
  });
  assert.equal(bien.status, 200);
  const cerrada = llamadas.find(l => l.ruta === '/api/auth/logout');
  assert.equal(cerrada?.cookie, 'clipgeist_sesion=clonbuster.prueba', 'sesión de la otra cerrada');
  const e = await estado();
  assert.equal(e.protegido, true);
  assert.equal(e.asistente, false, 'con usuario el asistente ya no sale solo');
  // Sin sesión, ya no se dice qué apps hay.
  assert.equal((await fetch(`${base}/api/auth/apps`)).status, 401);
  // Y la contraseña es la tecleada (nunca se copia nada de la otra).
  const login = await post('/api/auth/login', { usuario: 'ana', contrasena: 'la-de-la-otra-1' });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const red = await (
    await fetch(`${base}/api/asistente/red`, { headers: { Cookie: cookie } })
  ).json();
  assert.ok(Array.isArray(red.direcciones));
  for (const d of red.direcciones) assert.match(d, /^http:\/\/[^/]+:\d+\/$/);
});

test('las licencias se sirven (Ajustes → Acerca de)', async () => {
  const login = await post('/api/auth/login', { usuario: 'ana', contrasena: 'la-de-la-otra-1' });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const terceros = await fetch(`${base}/api/terceros`, { headers: { Cookie: cookie } });
  assert.equal(terceros.status, 200);
  assert.match(terceros.headers.get('content-type'), /text\/plain/);
  const texto = await terceros.text();
  assert.match(texto, /express/);
  assert.match(texto, /chrome-headless-shell/);
  const licencia = await fetch(`${base}/api/licencia`, { headers: { Cookie: cookie } });
  assert.match(await licencia.text(), /GNU AFFERO GENERAL PUBLIC LICENSE/);
});

/* ── B. Componentes fijados y licencias ──────────────────────────────── */

test('componentes.txt: versiones fijadas con sha256, nunca «latest»; el navegador = el de Puppeteer', async () => {
  const { leerComponentes, paquetesDeProduccion } = require('../empaquetado/terceros');
  const componentes = leerComponentes(path.join(__dirname, '..', 'empaquetado', 'componentes.txt'));
  assert.ok(componentes.length >= 4);
  for (const c of componentes) {
    assert.match(c.sha256, /^[0-9a-f]{64}$/, c.nombre);
    assert.doesNotMatch(c.url, /latest|master/i, c.nombre);
  }
  const revisiones = fs.readFileSync(
    require.resolve('puppeteer-core/lib/puppeteer/revisions.js', {
      paths: [path.dirname(require.resolve('puppeteer'))],
    }),
    'utf8'
  );
  const version = revisiones.match(/'chrome-headless-shell': '([^']+)'/)[1];
  for (const c of componentes.filter(x => x.nombre === 'chrome-headless-shell')) {
    assert.ok(c.url.includes(`/${version}/`), `navegador fijado ${c.url} ≠ Puppeteer ${version}`);
  }
  // TERCEROS.txt al día: están todos los paquetes de producción del fichero de bloqueo.
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const terceros = fs.readFileSync(
    path.join(__dirname, '..', 'empaquetado', 'TERCEROS.txt'),
    'utf8'
  );
  for (const p of paquetesDeProduccion(lock)) {
    assert.ok(
      terceros.includes(`\n${p.nombre} ${p.version} `),
      `${p.nombre} ${p.version} falta en TERCEROS.txt: node empaquetado/terceros.js`
    );
  }
});

/* ── QR propio ──────────────────────────────────────────────────────── */

test('QR: tamaño y versión según el texto, buscadores en las esquinas, siempre igual', async () => {
  const { codificarQR } = await import('../public/js/qr.js');
  const corto = codificarQR('http://192.168.1.20:3001/');
  assert.equal(corto.version, 2);
  assert.equal(corto.tam, 25);
  const largo = codificarQR(`http://192.168.1.20:3001/?${'x'.repeat(150)}`);
  assert.equal(largo.version, 9);
  assert.throws(() => codificarQR('x'.repeat(300)), /demasiado largo/);
  // Patrón de búsqueda (7×7) en las tres esquinas.
  for (const [x0, y0] of [
    [0, 0],
    [corto.tam - 7, 0],
    [0, corto.tam - 7],
  ]) {
    for (let i = 0; i < 7; i += 1) {
      assert.equal(corto.modulos[y0][x0 + i], true);
      assert.equal(corto.modulos[y0 + 6][x0 + i], true);
    }
    assert.equal(corto.modulos[y0 + 1][x0 + 1], false);
    assert.equal(corto.modulos[y0 + 3][x0 + 3], true);
  }
  // Huella de la matriz: comprobada con un lector de QR al escribir el módulo.
  const huella = require('node:crypto')
    .createHash('sha256')
    .update(corto.modulos.map(f => f.map(b => (b ? 1 : 0)).join('')).join('\n'))
    .digest('hex')
    .slice(0, 16);
  assert.equal(huella, HUELLA_QR);
});

const HUELLA_QR = 'b08973d21ceb6c42';
