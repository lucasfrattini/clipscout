'use strict';

/**
 * Fase 5 (un solo producto): los contratos comunes de Clipgeist del lado de clipscout, sobre datos
 * como los deja la 2.22.0 (contraseña, clave de administración, una conexión, gestor de descargas
 * y proxy de salida configurados):
 *
 * - B (SU-10) errores `{codigo, detail, params}` en el idioma de la petición, sin perder `detail`.
 * - C (SU-11) salud honesta, diagnóstico (proxy caído dicho claro), registro con rotación e
 *   informe sin rutas, ficheros ni claves.
 * - D (SU-20) copia de la suite: sin secretos, con manifiesto; restaurar comprueba app y versión,
 *   guarda lo de antes y no cambia contraseña ni claves.
 * - E (SU-13) versiones: sin enviar nada, una vez al día, tolera 404 y respeta el interruptor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f5-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';

const ADMIN = '0123456789abcdef0123456789abcdef';
const ENTRADA = 'cgc_entrada-de-clipkeeper-para-llamarnos';
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

function hashDe(contrasena) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(contrasena, sal, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${sal.toString('hex')}$${h}`;
}

// crew.json como lo deja la 2.22.0 (sin `buscar_actualizaciones`).
const CREW_2_22 = {
  api_key: ADMIN,
  instancia: 'clipscout',
  acceso: { usuario: 'ana', hash: hashDe('playa-larga-1') },
  conexiones: [
    {
      id: 1,
      app: 'clipkeeper',
      nombre: 'clipkeeper',
      url: 'http://127.0.0.1:9',
      api_key: 'cgc_la-que-usamos-para-llamar',
      activa: true,
      entradas: [{ h: sha(ENTRADA), creada: '2026-11-10T09:00:00.000Z' }],
    },
  ],
  jdownloader: { url: 'http://127.0.0.1:9' },
  programadas: [{ id: 'p1', q: 'paisaje', cadaDias: 7, activa: true }],
};
fs.writeFileSync(process.env.CREW_PATH, JSON.stringify(CREW_2_22, null, 2));
fs.writeFileSync(
  process.env.PROFILES_PATH,
  JSON.stringify({
    profiles: [{ name: 'Ejemplo', config: { searchUrl: 'https://a.example/?q={q}' } }],
  })
);

const config = require('../src/config');
const { createApp } = require('../src/app');
const logger = require('../src/lib/logger');
const registro = require('../src/lib/registro');
const zip = require('../src/lib/zip');
const diagnostico = require('../src/services/diagnostico');
const actualizaciones = require('../src/services/actualizaciones');
const { version } = require('../package.json');

let servidor;
let base;
test.before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  // Nada de lanzar Chromium en las pruebas.
  diagnostico.probadores.navegador = async () => 'arranca';
});
test.after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const conClave = (ruta, opciones = {}) =>
  fetch(`${base}${ruta}`, {
    ...opciones,
    headers: { 'X-Api-Key': ADMIN, 'Content-Type': 'application/json', ...opciones.headers },
  });

/* ── B. Errores con código ─────────────────────────────────────────── */

test('B: sin sesión → sin_sesion, con detail en español y en inglés según Accept-Language', async () => {
  const es = await fetch(`${base}/api/buscar/cola`);
  assert.equal(es.status, 401);
  const cuerpo = await es.json();
  assert.equal(cuerpo.codigo, 'sin_sesion');
  assert.equal(cuerpo.detail, 'Hace falta usuario y contraseña.');
  assert.deepEqual(cuerpo.params, {});
  const en = await (
    await fetch(`${base}/api/buscar/cola`, { headers: { 'Accept-Language': 'en-GB,en;q=0.8' } })
  ).json();
  assert.equal(en.codigo, 'sin_sesion');
  assert.equal(en.detail, 'Username and password required.');
});

test('B: los códigos comunes de la guardia de acceso', async () => {
  const mala = await (
    await fetch(`${base}/api/buscar/cola`, { headers: { 'X-Api-Key': 'no-es' } })
  ).json();
  assert.equal(mala.codigo, 'clave_invalida');
  const protocolo = await (await fetch(`${base}/api/crew/v1/conexiones`)).json();
  assert.equal(protocolo.codigo, 'clave_invalida');
  const otraWeb = await globalThis.fetchSinCabecera(`${base}/api/ajustes/general`, {
    method: 'PUT',
    headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(otraWeb.status, 403);
  assert.equal((await otraWeb.json()).codigo, 'origen_rechazado');
  const host = await new Promise(resolver => {
    http
      .get(
        {
          host: '127.0.0.1',
          port: servidor.address().port,
          path: '/api/ajustes/general',
          headers: { Host: 'ataque.ejemplo.test' },
        },
        res => {
          let texto = '';
          res.on('data', d => (texto += d));
          res.on('end', () => resolver({ status: res.statusCode, cuerpo: JSON.parse(texto) }));
        }
      )
      .on('error', resolver);
  });
  assert.equal(host.status, 421);
  assert.equal(host.cuerpo.codigo, 'host_no_permitido');
  const conexion = await (
    await fetch(`${base}/api/ajustes/general`, { headers: { 'X-Api-Key': ENTRADA } })
  ).json();
  assert.equal(conexion.codigo, 'prohibido');
});

test('B: con la clave de siempre, los scripts siguen leyendo detail (y error/code de antes)', async () => {
  const cola = await conClave('/api/buscar/cola');
  assert.equal(cola.status, 200);
  const vacia = await conClave('/api/buscar/iniciar', { method: 'POST', body: '{}' });
  assert.equal(vacia.status, 400);
  const v = await vacia.json();
  assert.equal(v.codigo, 'datos_invalidos');
  assert.ok(v.detail && v.error, 'detail y error');
  const nada = await (await conClave('/api/no-existe')).json();
  assert.equal(nada.codigo, 'no_encontrado');
  assert.equal(nada.code, 'NOT_FOUND');
  assert.match(nada.detail, /no-existe/);
  const sinConexion = await (await conClave('/api/ajustes/conexiones/99/estado')).json();
  assert.equal(sinConexion.codigo, 'no_encontrado');
  assert.equal(sinConexion.detail, 'No existe esa conexión.');
});

test('B: lo no previsto sale como error_interno con un id que también está en el registro', async () => {
  const express = require('express');
  const errores = require('../src/lib/errores');
  const { errorHandler } = require('../src/middleware/errorHandler');
  const app = express();
  app.use(errores.formatoErrores);
  app.get('/api/roto', () => {
    throw new TypeError('se rompió por dentro /srv/secreto/x.json');
  });
  app.use(errorHandler);
  const s = app.listen(0, '127.0.0.1');
  await new Promise(r => s.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/roto`, {
      headers: { 'Accept-Language': 'en' },
    });
    assert.equal(r.status, 500);
    const cuerpo = await r.json();
    assert.equal(cuerpo.codigo, 'error_interno');
    assert.match(cuerpo.params.id, /^[0-9a-f]{8}$/);
    assert.equal(cuerpo.detail, `Internal error (ref. ${cuerpo.params.id}).`);
    assert.ok(!JSON.stringify(cuerpo).includes('se rompió') || cuerpo.stack, 'el mensaje no sale');
    assert.ok(registro.ultimas(50).some(l => l.includes(`[${cuerpo.params.id}]`)));
    assert.equal(errores.ultimos()[0].id, cuerpo.params.id);
  } finally {
    s.close();
  }
});

/* ── C. Diagnóstico ────────────────────────────────────────────────── */

test('C: /api/salud sin sesión y honesta', async () => {
  const r = await fetch(`${base}/api/salud`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, app: 'clipscout', version });
});

test('C: diagnóstico con el proxy de salida caído lo dice claro (estado degradado)', async t => {
  const antes = config.outboundProxy;
  config.outboundProxy = 'http://127.0.0.1:9';
  t.after(() => {
    config.outboundProxy = antes;
  });
  assert.equal((await fetch(`${base}/api/diagnostico`)).status, 401, 'pide sesión o clave');
  const d = await (await conClave('/api/diagnostico')).json();
  assert.equal(d.app, 'clipscout');
  assert.equal(d.version, version);
  assert.ok(Date.parse(d.arranque));
  assert.equal(d.estado, 'degradado');
  const por = Object.fromEntries(d.comprobaciones.map(c => [c.nombre, c]));
  for (const n of ['ajustes', 'carpeta_datos', 'navegador', 'proxy_salida', 'gestor_descargas']) {
    assert.ok(por[n], `falta la comprobación ${n}`);
  }
  assert.equal(por.ajustes.ok, true);
  assert.equal(por.carpeta_datos.ok, true);
  assert.equal(por.navegador.ok, true);
  assert.equal(por.proxy_salida.ok, false);
  assert.match(por.proxy_salida.detalle, /proxy de salida NO responde/);
  assert.equal(por.gestor_descargas.ok, false, 'el gestor configurado no responde');
  assert.equal(por['conexion:clipkeeper'].ok, false);
  assert.ok(Array.isArray(d.ultimos_errores));
  const en = await (
    await conClave('/api/diagnostico', { headers: { 'Accept-Language': 'en' } })
  ).json();
  assert.match(en.comprobaciones.find(c => c.nombre === 'proxy_salida').detalle, /NOT responding/);
});

test('C: una comprobación que no contesta no cuelga el diagnóstico', async t => {
  const antes = diagnostico.probadores.navegador;
  const tiempo = config.diagnostico.timeoutMs;
  diagnostico._reiniciar();
  diagnostico.probadores.navegador = () => new Promise(() => {});
  config.diagnostico.timeoutMs = 50;
  t.after(() => {
    diagnostico.probadores.navegador = antes;
    config.diagnostico.timeoutMs = tiempo;
  });
  // El del navegador tiene un mínimo de 20 s: se prueba la utilidad directamente.
  await assert.rejects(diagnostico.conTiempo(new Promise(() => {}), 30), diagnostico.TiempoAgotado);
});

test('C: registro con rotación (5 MB × 3) y últimas líneas', async t => {
  const antes = config.logging.maxBytes;
  config.logging.maxBytes = 2000;
  t.after(() => {
    config.logging.maxBytes = antes;
  });
  for (let i = 0; i < 120; i++) logger.info(`línea de prueba ${i} ${'x'.repeat(40)}`);
  const carpeta = path.dirname(registro.ruta());
  const ficheros = fs.readdirSync(carpeta).sort();
  assert.deepEqual(ficheros, ['clipscout.log', 'clipscout.log.1', 'clipscout.log.2']);
  for (const f of ficheros) assert.ok(fs.statSync(path.join(carpeta, f)).size <= 2000);
  const { lineas } = await (await conClave('/api/diagnostico/registro?lineas=5')).json();
  assert.equal(lineas.length, 5);
  assert.match(lineas.at(-1), /línea de prueba 119/);
});

test('C: el informe es un zip sin rutas absolutas, nombres de fichero ni claves', async () => {
  logger.warn(`No se pudo leer ${path.join(dir, 'crew.json')} con la clave ${ADMIN}`);
  logger.info('Enviado «vacaciones playa.mp4» con cgc_abcdefghijk a C:\\Users\\ana\\Descargas');
  logger.info('proxy http://usuario:secreto@10.0.0.2:8118 caído');
  const r = await conClave('/api/diagnostico/informe');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const dentro = zip.leer(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual([...dentro.keys()].sort(), ['diagnostico.json', 'registro.txt']);
  const todo = [...dentro.values()].map(b => b.toString('utf8')).join('\n');
  JSON.parse(dentro.get('diagnostico.json').toString('utf8'));
  for (const prohibido of [
    dir,
    os.tmpdir(),
    ADMIN,
    'crew.json',
    'playa.mp4',
    'cgc_',
    'Users',
    'secreto',
  ]) {
    assert.ok(!todo.includes(prohibido), `el informe lleva «${prohibido}»`);
  }
  assert.match(todo, /<ruta>/);
  assert.match(todo, /<clave>/);
});

test('C: salud ok:false si los ajustes no se pueden leer', async t => {
  const original = fs.readFileSync(process.env.CREW_PATH);
  fs.rmSync(`${process.env.CREW_PATH}.bak`, { force: true });
  fs.writeFileSync(process.env.CREW_PATH, '{ roto');
  diagnostico._reiniciar();
  t.after(() => {
    fs.writeFileSync(process.env.CREW_PATH, original);
    require('../src/services/crew').olvidarCache();
    diagnostico._reiniciar();
  });
  const r = await fetch(`${base}/api/salud`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).ok, false);
});

/* ── D. Copia de la suite ──────────────────────────────────────────── */

async function bajarCopia() {
  const r = await conClave('/api/crew/v1/copia?miniaturas=1');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  return Buffer.from(await r.arrayBuffer());
}

test('D: la copia lleva manifiesto y datos, sin contraseña ni claves', async () => {
  const dentro = zip.leer(await bajarCopia());
  const manifiesto = JSON.parse(dentro.get('manifiesto.json').toString('utf8'));
  assert.equal(manifiesto.app, 'clipscout');
  assert.equal(manifiesto.version, version);
  assert.equal(manifiesto.esquema, 1);
  assert.ok(Date.parse(manifiesto.fecha));
  assert.deepEqual(manifiesto.contenido.sort(), ['crew.json', 'profiles.json']);
  const crew = JSON.parse(dentro.get('crew.json').toString('utf8'));
  assert.equal(crew.acceso, undefined);
  assert.equal(crew.api_key, undefined);
  assert.equal(crew.conexiones[0].api_key, undefined);
  assert.equal(crew.conexiones[0].entradas, undefined);
  assert.equal(crew.programadas[0].id, 'p1');
  assert.ok(!dentro.has('sesiones.json'));
});

test('D: permisos — sin nada 401, con clave de conexión 403', async () => {
  assert.equal((await fetch(`${base}/api/crew/v1/copia`)).status, 401);
  const r = await fetch(`${base}/api/crew/v1/copia`, { headers: { 'X-Api-Key': ENTRADA } });
  assert.equal(r.status, 403);
});

test('D: restaurar pone los datos, guarda lo anterior y no toca contraseña ni claves', async () => {
  const copia = await bajarCopia();
  fs.writeFileSync(process.env.PROFILES_PATH, JSON.stringify({ profiles: [] }));
  const r = await conClave('/api/crew/v1/copia/restaurar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: copia,
  });
  assert.equal(r.status, 200, await r.clone().text());
  const cuerpo = await r.json();
  assert.equal(cuerpo.reiniciar, true);
  assert.ok(cuerpo.restaurados.includes('profiles.json'));
  const perfiles = JSON.parse(fs.readFileSync(process.env.PROFILES_PATH, 'utf8'));
  assert.equal(perfiles.profiles[0].name, 'Ejemplo');
  const crew = JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8'));
  assert.equal(crew.api_key, ADMIN, 'la clave de administración sigue (scripts)');
  assert.equal(crew.acceso.usuario, 'ana');
  assert.equal(crew.conexiones[0].api_key, 'cgc_la-que-usamos-para-llamar');
  assert.equal(crew.conexiones[0].activa, true);
  assert.ok(fs.existsSync(path.join(dir, 'respaldos', cuerpo.previa, 'profiles.json')));
  // La clave sigue abriendo la API.
  assert.equal((await conClave('/api/buscar/cola')).status, 200);
});

test('D: no restaura una copia de otra app, de una versión más nueva ni un fichero cualquiera', async () => {
  const con = async (entradas, esperado, codigo) => {
    const r = await conClave('/api/crew/v1/copia/restaurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: Array.isArray(entradas) ? zip.crear(entradas) : entradas,
    });
    assert.equal(r.status, esperado);
    assert.equal((await r.json()).codigo, codigo);
  };
  const manifiesto = m => ({ nombre: 'manifiesto.json', datos: Buffer.from(JSON.stringify(m)) });
  await con(
    [manifiesto({ app: 'clonbuster', version: '0.1.0', esquema: 1 })],
    400,
    'copia_de_otra_app'
  );
  await con(
    [manifiesto({ app: 'clipscout', version: '99.0.0', esquema: 1 })],
    409,
    'copia_mas_nueva'
  );
  await con(Buffer.from('no es un zip'), 400, 'copia_no_valida');
  await con(
    [
      manifiesto({ app: 'clipscout', version: '2.22.0', esquema: 1 }),
      { nombre: 'profiles.json', datos: Buffer.from('{ roto') },
    ],
    400,
    'copia_no_valida'
  );
  const perfiles = JSON.parse(fs.readFileSync(process.env.PROFILES_PATH, 'utf8'));
  assert.equal(perfiles.profiles[0].name, 'Ejemplo', 'nada se pisó');
});

test('D: una conexión que llega sin clave y no existe aquí queda desactivada, no borrada', async () => {
  const crewCopia = {
    instancia: 'otra',
    conexiones: [{ id: 7, app: 'clonbuster', url: 'http://10.1.1.1:8095', activa: true }],
  };
  const r = await conClave('/api/crew/v1/copia/restaurar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zip.crear([
      {
        nombre: 'manifiesto.json',
        datos: Buffer.from(JSON.stringify({ app: 'clipscout', version: '2.22.0', esquema: 1 })),
      },
      { nombre: 'crew.json', datos: Buffer.from(JSON.stringify(crewCopia)) },
    ]),
  });
  assert.equal(r.status, 200);
  const crew = JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8'));
  const c = crew.conexiones.find(x => x.id === 7);
  assert.equal(c.activa, false);
  assert.equal(c.sin_clave, true);
  assert.equal(crew.api_key, ADMIN);
  // Se vuelve a dejar como estaba para lo que sigue.
  fs.writeFileSync(process.env.CREW_PATH, JSON.stringify(CREW_2_22, null, 2));
  require('../src/services/crew').olvidarCache();
});

/* ── E. Actualizaciones ────────────────────────────────────────────── */

test('E: el fichero de versiones se pide sin enviar nada, una vez al día, y tolera el 404', async t => {
  const pedidas = [];
  let respuesta = { status: 404, cuerpo: 'no' };
  const web = http.createServer((req, res) => {
    pedidas.push({ url: req.url, cabeceras: req.headers });
    res.writeHead(respuesta.status, { 'Content-Type': 'application/json' });
    res.end(
      typeof respuesta.cuerpo === 'string' ? respuesta.cuerpo : JSON.stringify(respuesta.cuerpo)
    );
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const antes = config.actualizaciones.url;
  config.actualizaciones.url = `http://127.0.0.1:${web.address().port}/versiones.json`;
  t.after(() => {
    config.actualizaciones.url = antes;
    web.close();
  });

  // Datos de la 2.22.0: sin el ajuste → encendido.
  const inicial = await (await conClave('/api/actualizaciones')).json();
  assert.equal(inicial.activo, true);
  assert.equal(inicial.hay_nueva, false);

  // 404 (el fichero aún no existe en la web): sin error para el usuario.
  const tras404 = await (
    await conClave('/api/actualizaciones/comprobar', { method: 'POST' })
  ).json();
  assert.equal(tras404.hay_nueva, false);
  assert.equal(tras404.error, 'HTTP 404');
  assert.equal(pedidas.length, 1);
  assert.equal(pedidas[0].url, '/versiones.json', 'sin parámetros');
  assert.equal(pedidas[0].cabeceras['user-agent'], 'Clipgeist');
  assert.equal(pedidas[0].cabeceras.cookie, undefined);
  assert.equal(pedidas[0].cabeceras['x-api-key'], undefined);

  // Una vez al día: sin forzar no se vuelve a pedir.
  await actualizaciones.comprobar();
  assert.equal(pedidas.length, 1);

  respuesta = {
    status: 200,
    cuerpo: {
      actualizado: '2026-12-01',
      apps: {
        clipscout: {
          version: '99.1.0',
          notas: 'Novedades',
          url: 'https://clipgeist.com/descargas',
          minimas: { clonbuster: '0.23.0', clipkeeper: 'raro' },
        },
        clonbuster: { version: '0.30.0' },
      },
    },
  };
  const nueva = await (await conClave('/api/actualizaciones/comprobar', { method: 'POST' })).json();
  assert.equal(nueva.hay_nueva, true);
  assert.equal(nueva.ultima, '99.1.0');
  assert.equal(nueva.notas, 'Novedades');
  assert.equal(nueva.url, 'https://clipgeist.com/descargas');
  assert.deepEqual(nueva.minimas, { clonbuster: '0.23.0' }, 'lo que no es versión se descarta');
  assert.equal(nueva.otras.clonbuster, '0.30.0');

  // Apagado: ni forzando sale nada.
  const apagar = await conClave('/api/actualizaciones', {
    method: 'PUT',
    body: JSON.stringify({ activo: false }),
  });
  assert.equal((await apagar.json()).activo, false);
  await conClave('/api/actualizaciones/comprobar', { method: 'POST' });
  assert.equal(pedidas.length, 2);
  await conClave('/api/actualizaciones', { method: 'PUT', body: JSON.stringify({ activo: true }) });
});

test('E: sin red no molesta', async t => {
  const antes = config.actualizaciones.url;
  config.actualizaciones.url = 'http://127.0.0.1:9/versiones.json';
  t.after(() => {
    config.actualizaciones.url = antes;
  });
  const r = await actualizaciones.comprobar({ forzar: true });
  assert.equal(r.error, 'sin_red');
  assert.equal(r.hay_nueva, true, 'se queda lo último que se supo');
});

/* ── F. Qué sale de este equipo ────────────────────────────────────── */

test('F: la lista de lo que sale del equipo dice lo configurado, sin credenciales', async t => {
  const antes = config.outboundProxy;
  config.outboundProxy = 'http://usuario:secreto@10.0.0.2:8118';
  t.after(() => {
    config.outboundProxy = antes;
  });
  const { salientes } = await (await conClave('/api/privacidad')).json();
  const por = Object.fromEntries(salientes.map(s => [s.tipo, s]));
  assert.deepEqual(Object.keys(por).sort(), [
    'apps',
    'gestor',
    'ip_salida',
    'proxy',
    'sitios',
    'versiones',
    'web',
  ]);
  assert.equal(por.sitios.n, 1);
  assert.equal(por.gestor.activo, true);
  assert.equal(por.proxy.url, 'http://***@10.0.0.2:8118');
  assert.ok(!JSON.stringify(salientes).includes('secreto'));
  assert.deepEqual(
    por.apps.apps.map(a => a.app),
    ['clipkeeper']
  );
  assert.equal(por.versiones.activo, true);
  assert.equal(por.web.activo, false);
});

/* ── G. Instalable en el móvil ─────────────────────────────────────── */

test('G: manifiesto sin sesión, con iconos 192/512/maskable que existen y miden lo que dicen', async () => {
  const r = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /manifest\+json/);
  const m = await r.json();
  assert.equal(m.name, 'clipscout');
  assert.equal(m.display, 'standalone');
  assert.ok(m.theme_color && m.background_color);
  const tamano = buf => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  const propositos = new Set();
  for (const icono of m.icons) {
    const img = await fetch(`${base}${icono.src}`);
    assert.equal(img.status, 200, icono.src);
    const [ancho, alto] = tamano(Buffer.from(await img.arrayBuffer()));
    assert.equal(`${ancho}x${alto}`, icono.sizes, icono.src);
    propositos.add(icono.purpose);
  }
  assert.ok(m.icons.some(i => i.sizes === '192x192'));
  assert.ok(propositos.has('maskable'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon"/);
  assert.equal((html.match(/<meta name="theme-color"/g) || []).length, 2, 'claro y oscuro');
});
