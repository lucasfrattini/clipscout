'use strict';

/**
 * Actualizar de 2.17.0 a la fase 1 sin dejar fuera a nadie: datos de 2.17 con contraseña, una
 * cookie firmada de entonces, conexiones con la clave de administración de la otra app, una
 * búsqueda en cola y una programada. Se arranca el servidor de verdad (server.js) sobre ellos y:
 * la cookie se canjea, la X-Api-Key de siempre abre la API, las conexiones pasan solas a claves
 * de conexión (la vieja se deja y se reintenta), la búsqueda en cola se retoma, la programada sigue
 * y los permisos de los ficheros quedan en 600/700.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { firmarSesion } = require('../src/services/acceso');
const { crearAppFalsa } = require('./_appFalsa');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-actualizar-'));
const ADMIN = '0123456789abcdef0123456789abcdef';
const nueva = crearAppFalsa({ app: 'clipkeeper', admin: 'admin-de-clipkeeper' });
const vieja = crearAppFalsa({ app: 'clonbuster', admin: 'admin-de-clonbuster', vieja: true });
let hijo;
let base;
let cookieAntigua;
let salida = '';

const puertoLibre = () =>
  new Promise(resolver => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolver(port));
    });
  });

function hashDe(contrasena) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(contrasena, sal, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${sal.toString('hex')}$${h}`;
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function hasta(condicion, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condicion()) return true;
    await esperar(100);
  }
  return false;
}

before(async () => {
  const urlNueva = await nueva.arrancar();
  const urlVieja = await vieja.arrancar();
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  const hash = hashDe('playa-larga-1');
  const crewJson = {
    api_key: ADMIN,
    instancia: 'clipscout',
    url: base,
    acceso: { usuario: 'ana', hash },
    conexiones: [
      {
        id: 1,
        app: 'clipkeeper',
        nombre: 'clipkeeper',
        url: urlNueva,
        api_key: 'admin-de-clipkeeper',
        activa: true,
        creada: '2026-11-08T09:00:00.000Z',
      },
      {
        id: 2,
        app: 'clonbuster',
        nombre: 'clonbuster',
        url: urlVieja,
        api_key: 'admin-de-clonbuster',
        activa: true,
        creada: '2026-11-08T09:00:00.000Z',
      },
    ],
    programadas: [
      {
        id: 'p1',
        q: 'paisaje',
        cadaDias: 7,
        activa: true,
        ultima: new Date().toISOString(),
      },
    ],
  };
  // Como los dejaba 2.17: legibles por todos.
  fs.chmodSync(dir, 0o755);
  fs.writeFileSync(path.join(dir, 'crew.json'), JSON.stringify(crewJson, null, 2), { mode: 0o644 });
  fs.writeFileSync(
    path.join(dir, 'busquedas.json'),
    JSON.stringify({
      version: 1,
      guardadoEn: new Date().toISOString(),
      ultima: 'b1',
      cola: ['b1'],
      busquedas: [
        {
          id: 'b1',
          entrada: { q: 'paisaje' },
          q: 'paisaje',
          origen: 'manual',
          estado: 'cola',
          creadaEn: Date.now() - 1000,
          eventos: [],
        },
      ],
    }),
    { mode: 0o644 }
  );
  const caduca = Math.floor(Date.now() / 1000) + 20 * 24 * 3600;
  cookieAntigua = `clipgeist_sesion=${firmarSesion('ana', hash, caduca)}`;

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.ADMIN_PASSWORD;
  Object.assign(env, {
    PORT: String(puerto),
    HOST: '127.0.0.1',
    CREW_PATH: path.join(dir, 'crew.json'),
    DATA_DIR: dir,
    PROFILES_PATH: path.join(dir, 'profiles.json'),
    BROWSER_ENABLED: 'false',
    SEARXNG_URL: '',
    OUTBOUND_PROXY: '',
    LOG_LEVEL: 'info',
    CLIPGEIST_MIGRACION_ESPERA_MS: '200',
  });
  hijo = spawn(process.execPath, ['./server.js'], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout.on('data', d => {
    salida += d;
  });
  hijo.stderr.on('data', d => {
    salida += d;
  });
  const arrancado = await hasta(async () => {
    try {
      return (await fetch(`${base}/api/health`)).ok;
    } catch {
      return false;
    }
  });
  assert.ok(arrancado, `el servidor no arrancó:\n${salida}`);
});

after(async () => {
  if (hijo && hijo.exitCode === null) {
    hijo.kill('SIGTERM');
    await Promise.race([new Promise(r => hijo.once('exit', r)), esperar(5000)]);
    if (hijo.exitCode === null) hijo.kill('SIGKILL');
  }
  await nueva.cerrar();
  await vieja.cerrar();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la cookie de 2.17 se canjea por una sesión nueva (sin volver a entrar)', async () => {
  const r = await fetch(`${base}/api/ajustes/general`, { headers: { Cookie: cookieAntigua } });
  assert.equal(r.status, 200);
  const nuevaCookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.match(nuevaCookie, /^clipgeist_sesion=clipscout\./);
  assert.equal(
    (await fetch(`${base}/api/ajustes/general`, { headers: { Cookie: nuevaCookie } })).status,
    200
  );
  const pagina = await fetch(`${base}/`, {
    headers: { Cookie: nuevaCookie, Accept: 'text/html' },
    redirect: 'manual',
  });
  assert.equal(pagina.status, 200);
});

test('la X-Api-Key de siempre abre la API (scripts): cola, programadas, envío al gestor', async () => {
  const conClave = (ruta, opciones = {}) =>
    globalThis.fetchSinCabecera(`${base}${ruta}`, {
      ...opciones,
      headers: { 'X-Api-Key': ADMIN, 'Content-Type': 'application/json' },
    });
  assert.equal((await conClave('/api/ajustes/general')).status, 200);
  const { programadas } = await (await conClave('/api/ajustes/programadas')).json();
  assert.equal(programadas[0].id, 'p1', 'las programadas siguen');
  // La búsqueda que estaba en cola se retoma sola.
  const enCola = await hasta(async () => {
    const { busquedas } = await (await conClave('/api/buscar/cola')).json();
    return busquedas.some(b => b.id === 'b1');
  });
  assert.ok(enCola, 'la búsqueda en cola sigue ahí');
  // Mandar al gestor de descargas: sin gestor configurado responde con su error, no con 401/403.
  const envio = await conClave('/api/ajustes/jdownloader/enviar', {
    method: 'POST',
    body: JSON.stringify({ enlaces: ['https://ejemplo.test/v/1'] }),
  });
  assert.ok(![401, 403].includes(envio.status), `envío: ${envio.status}`);
  // Una búsqueda nueva por la API, como hacen sus scripts.
  const buscar = await conClave('/api/buscar/iniciar', {
    method: 'POST',
    body: JSON.stringify({ q: 'paisaje' }),
  });
  assert.ok(![401, 403].includes(buscar.status), `buscar: ${buscar.status}`);
});

test('las conexiones pasan solas a claves de conexión; la vieja se queda como estaba', async () => {
  const leer = () => JSON.parse(fs.readFileSync(path.join(dir, 'crew.json'), 'utf8'));
  const migrada = await hasta(() =>
    leer()
      .conexiones.find(c => c.app === 'clipkeeper')
      .api_key.startsWith('cgc_')
  );
  assert.ok(migrada, `no migró:\n${salida}`);
  const d = leer();
  const ck = d.conexiones.find(c => c.app === 'clipkeeper');
  assert.ok(nueva.estado.entradas.has(ck.api_key));
  const renovar = nueva.estado.llamadas.find(l => l.ruta === '/api/crew/v1/conexiones/renovar');
  assert.equal(renovar.clave, 'admin-de-clipkeeper', 'se renueva con la clave antigua');
  assert.equal(renovar.datos.app, 'clipscout');
  assert.equal(renovar.datos.url, base);
  // Con la clave que le dimos, clipkeeper puede llamarnos (y solo a lo permitido).
  const suya = nueva.estado.paraLlamar;
  assert.match(suya, /^cgc_/);
  assert.equal(
    (await fetch(`${base}/api/crew/v1/status`, { headers: { 'X-Api-Key': suya } })).status,
    200
  );
  assert.equal(
    (await fetch(`${base}/api/ajustes/general`, { headers: { 'X-Api-Key': suya } })).status,
    403
  );
  // La de clonbuster (versión vieja: 404) sigue con su clave, sin romperse.
  assert.equal(d.conexiones.find(c => c.app === 'clonbuster').api_key, 'admin-de-clonbuster');
  // Y las apps que aún nos llaman con nuestra clave de administración siguen pudiendo.
  assert.equal(
    (await fetch(`${base}/api/crew/v1/status`, { headers: { 'X-Api-Key': ADMIN } })).status,
    200
  );
  assert.equal(d.api_key, ADMIN, 'la clave de administración no se regenera');
});

test(
  'permisos: carpeta de datos 700 y ficheros 600',
  { skip: process.platform === 'win32' },
  async () => {
    const ok = await hasta(() => (fs.statSync(dir).mode & 0o777) === 0o700);
    assert.ok(ok);
    for (const f of ['crew.json', 'sesiones.json']) {
      assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
    }
  }
);
