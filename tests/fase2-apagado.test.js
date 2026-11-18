'use strict';

/**
 * Fase 2: apagado ordenado (CS-20), carpeta de datos (CS-26), guardados con reintentos (CS-21) y
 * procesos sin ventana en Windows.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { spawn } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fase2-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
delete process.env.ADMIN_PASSWORD;

const express = require('express');
const { createApp } = require('../src/app');
const apagado = require('../src/services/apagado');
const config = require('../src/config');
const { renombrar, renombrarSync } = require('../src/lib/ficheroJson');

const crudo = globalThis.fetchSinCabecera;
const esperar = ms => new Promise(r => setTimeout(r, ms));
let servidor;
let base;
let sesion;

before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const puesta = await fetch(`${base}/api/ajustes/acceso`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'playa-larga-1' }),
  });
  assert.equal(puesta.status, 200);
  sesion = (puesta.headers.get('set-cookie') || '').split(';')[0];
});

after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── A. Apagado ordenado ────────────────────────────────────────────── */

test('estado-trabajos: el propio equipo con X-Clipgeist entra sin sesión; sin la cabecera, no', async () => {
  const r = await fetch(`${base}/api/estado-trabajos`);
  assert.equal(r.status, 200);
  const e = await r.json();
  assert.equal(e.ocupado, false);
  assert.equal(e.que, null);
  assert.equal((await crudo(`${base}/api/estado-trabajos`)).status, 401);
  assert.equal((await crudo(`${base}/api/apagar`, { method: 'POST' })).status, 403);
  const conSesion = await crudo(`${base}/api/estado-trabajos`, { headers: { Cookie: sesion } });
  assert.equal(conSesion.status, 200);
});

test('apagar espera a la escritura en vuelo, guarda y sale con 0; lo nuevo recibe 503', async () => {
  apagado._reiniciar();
  const salidas = [];
  let navegadorCerrado = false;
  const app = express();
  app.use(apagado.middleware);
  app.post('/api/lento', async (req, res) => {
    await esperar(400);
    res.json({ ok: true });
  });
  app.post('/api/otra', (req, res) => res.json({ ok: true }));
  app.get('/api/estado-trabajos', (req, res) => res.json(apagado.estadoTrabajos()));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  apagado.configurar({
    server: null,
    cerrarNavegador: async () => {
      navegadorCerrado = true;
    },
    salir: codigo => salidas.push(codigo),
  });
  const lenta = fetch(`${url}/api/lento`, { method: 'POST' });
  await esperar(100);
  const e = await (await fetch(`${url}/api/estado-trabajos`)).json();
  assert.equal(e.ocupado, true);
  assert.equal(e.que, 'guardando');
  const promesa = apagado.apagar({ esperaMaxMs: 5000 });
  assert.equal((await fetch(`${url}/api/otra`, { method: 'POST' })).status, 503);
  assert.deepEqual(salidas, [], 'no sale mientras la escritura sigue');
  assert.equal((await lenta).status, 200, 'la escritura en vuelo termina entera');
  await promesa;
  assert.deepEqual(salidas, [0]);
  assert.ok(navegadorCerrado);
  assert.ok(fs.existsSync(path.join(config.datos.dir, 'busquedas.json')), 'foto de la cola');
  srv.close();
  apagado._reiniciar();
});

test('POST /api/apagar del lanzador responde enseguida con {ok, esperando}', async () => {
  apagado._reiniciar();
  const r = await fetch(`${base}/api/apagar`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esperando: null });
  await esperar(50);
  // Sin server.js (entorno de pruebas) no sale: solo deja de aceptar trabajo.
  const nueva = await fetch(`${base}/api/profiles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: sesion },
    body: JSON.stringify({ profiles: [] }),
  });
  assert.equal(nueva.status, 503);
  apagado._reiniciar();
});

test('server.js de verdad: POST /api/apagar y sale con 0; SIGTERM hace lo mismo', async () => {
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-apagar-'));
  const arrancar = async puerto => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    Object.assign(env, {
      PORT: String(puerto),
      HOST: '127.0.0.1',
      DATA_DIR: datos,
      BROWSER_ENABLED: 'false',
      SEARXNG_URL: '',
      OUTBOUND_PROXY: '',
    });
    delete env.CREW_PATH;
    delete env.PROFILES_PATH;
    const hijo = spawn(process.execPath, ['./server.js'], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', d => (salida += d));
    hijo.stderr.on('data', d => (salida += d));
    const fin = new Promise(r => hijo.once('exit', codigo => r(codigo)));
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${puerto}/api/health`)).ok) break;
      } catch {
        /* aún no */
      }
      await esperar(100);
    }
    return { hijo, fin, salida: () => salida };
  };
  const puerto = 20000 + Math.floor(Math.random() * 20000);
  const uno = await arrancar(puerto);
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/apagar`, { method: 'POST' });
    assert.equal(r.status, 200, uno.salida());
    const codigo = await Promise.race([uno.fin, esperar(15000).then(() => 'colgado')]);
    assert.equal(codigo, 0, uno.salida());
    // CS-26: con solo DATA_DIR, crew.json va dentro de esa carpeta.
    assert.ok(fs.existsSync(path.join(datos, 'crew.json')), 'crew.json en DATA_DIR');
    assert.ok(fs.existsSync(path.join(datos, 'busquedas.json')), 'la cola guardada al apagar');
    // En Windows no hay SIGTERM de verdad (kill termina en seco): allí lo cubre POST /api/apagar.
    if (process.platform !== 'win32') {
      const dos = await arrancar(puerto + 1);
      try {
        dos.hijo.kill('SIGTERM');
        assert.equal(await Promise.race([dos.fin, esperar(15000).then(() => 'colgado')]), 0);
      } finally {
        if (dos.hijo.exitCode === null) dos.hijo.kill('SIGKILL');
      }
    }
  } finally {
    if (uno.hijo.exitCode === null) uno.hijo.kill('SIGKILL');
    fs.rmSync(datos, { recursive: true, force: true });
  }
});

/* ── CS-26. DATA_DIR es la carpeta de todo ──────────────────────────── */

test('CS-26: sin DATA_DIR nada cambia (data/ del programa); con él, todo dentro', () => {
  const raiz = path.join(os.tmpdir(), 'programa-falso');
  const sin = config.rutasDatos({}, raiz);
  assert.equal(sin.dir, path.join(raiz, 'data'));
  assert.equal(sin.crew, path.join(raiz, 'data', 'crew.json'));
  assert.equal(sin.profiles, path.join(raiz, 'data', 'profiles.json'));
  const otra = path.join(os.tmpdir(), 'otra-instancia');
  const con = config.rutasDatos({ DATA_DIR: otra }, raiz);
  assert.equal(con.dir, otra);
  assert.equal(con.crew, path.join(otra, 'crew.json'));
  assert.equal(con.profiles, path.join(otra, 'profiles.json'));
  // CREW_PATH y PROFILES_PATH siguen mandando (el lanzador de escritorio da las tres).
  const fijas = config.rutasDatos(
    { DATA_DIR: otra, CREW_PATH: '/x/c.json', PROFILES_PATH: '/x/p.json' },
    raiz
  );
  assert.equal(fijas.crew, '/x/c.json');
  assert.equal(fijas.profiles, '/x/p.json');
  // Solo CREW_PATH (como hasta ahora): la carpeta de datos es la suya; perfiles, donde estaban.
  const soloCrew = config.rutasDatos({ CREW_PATH: '/y/crew.json' }, raiz);
  assert.equal(soloCrew.dir, '/y');
  assert.equal(soloCrew.profiles, path.join(raiz, 'data', 'profiles.json'));
});

test('CS-26: si el data/ del programa tiene crew.json y DATA_DIR no, solo se avisa', () => {
  const raiz = path.join(os.tmpdir(), 'programa-falso');
  const otra = path.join(os.tmpdir(), 'otra-instancia');
  const hay = new Set([path.join(raiz, 'data', 'crew.json')]);
  const avisos = config.avisosMigracionDatos({ DATA_DIR: otra }, raiz, r => hay.has(r));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /crew\.json/);
  assert.match(avisos[0], /No se ha copiado ni movido nada/);
  assert.deepEqual(
    config.avisosMigracionDatos({}, raiz, () => true),
    [],
    'sin DATA_DIR'
  );
  hay.add(path.join(otra, 'crew.json'));
  hay.add(path.join(otra, 'profiles.json'));
  assert.deepEqual(
    config.avisosMigracionDatos({ DATA_DIR: otra }, raiz, r => hay.has(r)),
    []
  );
});

/* ── CS-21. Guardados que fallan al azar en Windows ─────────────────── */

test('CS-21: rename reintenta ante EPERM/EBUSY (asíncrono y síncrono) y no ante otros', async () => {
  const fallarVeces = (n, code) => {
    let veces = 0;
    return () => {
      veces += 1;
      if (veces <= n) throw Object.assign(new Error(code), { code });
      return veces;
    };
  };
  assert.equal(await renombrar('a', 'b', { rename: fallarVeces(2, 'EPERM') }), 3);
  assert.equal(renombrarSync('a', 'b', { renameSync: fallarVeces(2, 'EBUSY') }), 3);
  await assert.rejects(renombrar('a', 'b', { rename: fallarVeces(1, 'ENOENT') }), /ENOENT/);
  assert.throws(() => renombrarSync('a', 'b', { renameSync: fallarVeces(9, 'EACCES') }), /EACCES/);
});

/* ── D. Windows: ningún proceso hijo con ventana ────────────────────── */

test('D: todo child_process del servidor lleva windowsHide (Puppeteer ya lo pone)', () => {
  const ficheros = [];
  const recorrer = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const ruta = path.join(d, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith('.js')) ficheros.push(ruta);
    }
  };
  recorrer(path.join(__dirname, '..', 'src'));
  ficheros.push(path.join(__dirname, '..', 'server.js'));
  for (const f of ficheros) {
    const texto = fs.readFileSync(f, 'utf8');
    const llamadas = texto.match(/\b(spawn|execFile|exec|fork)(Sync)?\s*\(/g) || [];
    if (!/require\(['"]node:child_process['"]\)|require\(['"]child_process['"]\)/.test(texto)) {
      continue;
    }
    assert.ok(
      llamadas.length === 0 || /windowsHide:\s*true/.test(texto),
      `${path.relative(process.cwd(), f)} lanza procesos sin windowsHide`
    );
  }
  const lanzador = fs.readFileSync(
    require.resolve('@puppeteer/browsers/lib/launch.js', {
      paths: [path.dirname(require.resolve('puppeteer'))],
    }),
    'utf8'
  );
  assert.match(lanzador, /windowsHide:\s*true/, 'Puppeteer abre el navegador sin ventana');
});
