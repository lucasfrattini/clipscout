'use strict';

/**
 * Fase 1: cookie antigua de un solo uso, navegador interno sin acceso a la red local (CS-S6) y
 * con aislamiento (CS-S3), permisos de los ficheros (SU-07) y copias descargadas sin secretos
 * (CS-S10).
 */
const assert = require('node:assert/strict');
const dns = require('node:dns');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fase1v-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
delete process.env.ADMIN_PASSWORD;

const config = require('../src/config');
const { createApp } = require('../src/app');
const accesoSrv = require('../src/services/acceso');
const sesiones = require('../src/services/sesiones');
const browser = require('../src/lib/browser');

let servidor;
let base;
before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cookie de 2.17: vale una vez (con margen para las peticiones a la vez) y luego no', async () => {
  const puesta = await fetch(`${base}/api/ajustes/acceso`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'playa-larga-1' }),
  });
  assert.equal(puesta.status, 200);
  const { hash } = JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8')).acceso;
  const caduca = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
  const antigua = `clipgeist_sesion=${accesoSrv.firmarSesion('ana', hash, caduca)}`;
  const pedir = cookie => fetch(`${base}/api/ajustes/general`, { headers: { Cookie: cookie } });

  const primera = await pedir(antigua);
  assert.equal(primera.status, 200);
  assert.match(primera.headers.get('set-cookie'), /clipgeist_sesion=clipscout\./);
  const margen = await pedir(antigua);
  assert.equal(margen.status, 200, 'otra petición a la vez con la misma cookie');
  assert.equal(margen.headers.get('set-cookie'), null, 'sin crear otra sesión');

  // Pasado el margen, ya no.
  const ruta = path.join(config.datos.dir, 'sesiones.json');
  const d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  d.canjeadas.forEach(c => {
    c.en = 0;
  });
  fs.writeFileSync(ruta, JSON.stringify(d));
  sesiones._reiniciar();
  assert.equal((await pedir(antigua)).status, 401);

  // Una firmada para después de la actualización (no pudo emitirla 2.17): no se acepta.
  const futura = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  assert.equal(
    (await pedir(`clipgeist_sesion=${accesoSrv.firmarSesion('ana', hash, futura)}`)).status,
    401
  );
  // Y una mal firmada, tampoco.
  assert.equal((await pedir(`clipgeist_sesion=${caduca}.${'0'.repeat(64)}`)).status, 401);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(ruta).mode & 0o777, 0o600, 'sesiones.json solo para el dueño');
    assert.equal(fs.statSync(process.env.CREW_PATH).mode & 0o777, 0o600);
  }
});

/* ── CS-S6: el navegador interno no alcanza la red local ─────────────── */

test('vaARedLocal: IPs privadas, loopback, enlace local y nombres que resuelven a ellas', async () => {
  const original = dns.promises.lookup;
  dns.promises.lookup = async host => {
    if (host === 'interno.ejemplo.test') return [{ address: '192.168.1.1', family: 4 }];
    if (host === 'mixto.ejemplo.test') {
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ];
    }
    if (host === 'publico.ejemplo.test') return [{ address: '93.184.216.34', family: 4 }];
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  };
  try {
    for (const url of [
      'http://127.0.0.1:3001/api/ajustes/general',
      'http://192.168.1.10:5800/',
      'http://10.1.2.3/',
      'http://172.17.0.1:8096/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:8095/',
      'http://[fd00::5]/',
      'http://localhost:3001/',
      'http://router.local/',
      'ws://192.168.1.10:9000/',
      'https://interno.ejemplo.test/',
      'https://mixto.ejemplo.test/',
    ]) {
      assert.equal(await browser.vaARedLocal(url), true, url);
    }
    for (const url of [
      'https://publico.ejemplo.test/v/1',
      'https://93.184.216.34/',
      'data:text/plain,hola',
      'blob:https://publico.ejemplo.test/abc',
      // No se puede resolver aquí (con proxy de salida lo resuelve el proxy): no se corta.
      'https://sin-resolver.ejemplo.test/',
    ]) {
      assert.equal(await browser.vaARedLocal(url), false, url);
    }
  } finally {
    dns.promises.lookup = original;
  }
});

test('protegerPestana: corta lo local, deja pasar lo público, y los observadores solo miran', async () => {
  const pagina = new EventEmitter();
  pagina.setRequestInterception = async v => {
    pagina.interceptando = v;
  };
  await browser.protegerPestana(pagina, [r => vistas.push(r.url())]);
  const vistas = [];
  assert.equal(pagina.interceptando, true);
  const peticion = url => {
    const r = {
      url: () => url,
      resolucion: null,
      isInterceptResolutionHandled: () => r.resolucion !== null,
      abort: async motivo => {
        r.resolucion = `abort:${motivo}`;
      },
      continue: async () => {
        r.resolucion = 'continue';
      },
    };
    pagina.emit('request', r);
    return r;
  };
  const local = peticion('http://192.168.1.1/admin');
  const publica = peticion('https://93.184.216.34/v.mp4');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(local.resolucion, 'abort:addressunreachable');
  assert.equal(publica.resolucion, 'continue');
  assert.deepEqual(vistas, ['http://192.168.1.1/admin', 'https://93.184.216.34/v.mp4']);
});

test('con la protección SSRF apagada (tests contra servidores locales) no se corta nada', async () => {
  const antes = config.security.blockPrivateAddresses;
  config.security.blockPrivateAddresses = false;
  try {
    assert.equal(await browser.vaARedLocal('http://127.0.0.1/'), false);
  } finally {
    config.security.blockPrivateAddresses = antes;
  }
});

/* ── CS-S3: aislamiento, perfil temporal, sin extensiones ────────────── */

test('argumentos del navegador: aislado salvo en contenedor/root; proxy de salida intacto', () => {
  const conSandbox = browser.argumentosLanzamiento('/tmp/perfil-x', { sandbox: true });
  assert.ok(!conSandbox.includes('--no-sandbox'));
  assert.ok(conSandbox.includes('--disable-extensions'));
  assert.ok(conSandbox.includes('--user-data-dir=/tmp/perfil-x'));
  const sinSandbox = browser.argumentosLanzamiento('/tmp/perfil-x', { sandbox: false });
  assert.ok(sinSandbox.includes('--no-sandbox'));

  const antes = config.outboundProxy;
  config.outboundProxy = 'http://usuario:clave@proxy.ejemplo.test:8888';
  try {
    const conProxy = browser.argumentosLanzamiento('/tmp/perfil-x', { sandbox: false });
    assert.ok(conProxy.includes('--proxy-server=http://proxy.ejemplo.test:8888'));
  } finally {
    config.outboundProxy = antes;
  }

  const forzado = process.env.BROWSER_SANDBOX;
  try {
    process.env.BROWSER_SANDBOX = 'off';
    assert.equal(browser.sinSandbox(), true);
    process.env.BROWSER_SANDBOX = 'on';
    assert.equal(browser.sinSandbox(), false);
  } finally {
    if (forzado === undefined) delete process.env.BROWSER_SANDBOX;
    else process.env.BROWSER_SANDBOX = forzado;
  }
});

/* ── SU-07 / CS-S10 ─────────────────────────────────────────────────── */

test(
  'corregirPermisos: deja 700 en carpetas y 600 en ficheros',
  { skip: process.platform === 'win32' },
  async () => {
    const { corregirPermisos } = require('../src/lib/permisos');
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-permisos-'));
    try {
      fs.mkdirSync(path.join(carpeta, 'respaldos', '2026-11-01'), { recursive: true, mode: 0o755 });
      fs.writeFileSync(path.join(carpeta, 'crew.json'), '{}', { mode: 0o644 });
      fs.writeFileSync(path.join(carpeta, 'respaldos', '2026-11-01', 'crew.json'), '{}', {
        mode: 0o644,
      });
      fs.chmodSync(carpeta, 0o755);
      await corregirPermisos([carpeta]);
      assert.equal(fs.statSync(carpeta).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(carpeta, 'crew.json')).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(carpeta, 'respaldos', '2026-11-01')).mode & 0o777, 0o700);
      assert.equal(
        fs.statSync(path.join(carpeta, 'respaldos', '2026-11-01', 'crew.json')).mode & 0o777,
        0o600
      );
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  }
);

test('copia descargada sin contraseña ni claves; la local, entera', async () => {
  const respaldos = require('../src/services/respaldos');
  const crew = require('../src/services/crew');
  await crew.guardarConexion({
    app: 'clipkeeper',
    url: 'http://192.0.2.7:8096',
    api_key: 'cgc_secreta',
    entrada: 'cgc_la-que-le-dimos',
  });
  const { id } = await respaldos.asegurarDiario({ forzar: true });
  const p = await respaldos.paquete(id);
  const texto = JSON.stringify(p);
  assert.equal(p.sinSecretos, true);
  assert.equal(p.ficheros['crew.json'].acceso, undefined);
  assert.equal(p.ficheros['crew.json'].api_key, undefined);
  assert.doesNotMatch(texto, /cgc_secreta|scrypt\$/);
  assert.equal(p.ficheros['crew.json'].conexiones[0].url, 'http://192.0.2.7:8096');
  const local = fs.readFileSync(path.join(config.datos.dir, 'respaldos', id, 'crew.json'), 'utf8');
  assert.match(local, /cgc_secreta/, 'la copia local sirve para recuperar la instalación');
  if (process.platform !== 'win32') {
    assert.equal(
      fs.statSync(path.join(config.datos.dir, 'respaldos', id, 'crew.json')).mode & 0o777,
      0o600
    );
  }
});
