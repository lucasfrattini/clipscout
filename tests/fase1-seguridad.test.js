'use strict';

/**
 * Fase 1 de seguridad, lado clipscout del contrato común (docs/CREW.md): claves de conexión con
 * lista de permisos, sesiones en el servidor e inicio de sesión único, nombre de host, origen de
 * las peticiones y primer usuario. La otra app es un doble (tests/_appFalsa.js).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-fase1-'));
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.LOGIN_RETRASO_FALLO_MS = '0';
process.env.CLIPGEIST_HOSTS = 'clipscout.ejemplo.test,*.casa.test';
delete process.env.ADMIN_PASSWORD;

const http = require('node:http');
const { createApp } = require('../src/app');
const crew = require('../src/services/crew');
const acceso = require('../src/services/acceso');
const { crearAppFalsa } = require('./_appFalsa');

const crudo = globalThis.fetchSinCabecera;
let servidor;
let base;
let admin;
let sesion;
const otra = crearAppFalsa({ app: 'clipkeeper' });
let urlOtra;

const pedir = (ruta, { metodo = 'GET', cuerpo, cookie, cabeceras = {}, sinCabecera } = {}) =>
  (sinCabecera ? crudo : fetch)(base + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...cabeceras,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
const cookieDe = r => (r.headers.get('set-cookie') || '').split(';')[0];
const login = () =>
  pedir('/api/auth/login', {
    metodo: 'POST',
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
  });

before(async () => {
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  urlOtra = await otra.arrancar();
  // Usuario creado desde el propio equipo (no hace falta código).
  const puesta = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
  });
  assert.equal(puesta.status, 200);
  sesion = cookieDe(puesta);
  admin = (await (await pedir('/api/ajustes/general', { cookie: sesion })).json()).api_key;
});

after(async () => {
  servidor.close();
  await otra.cerrar();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── A. Claves ──────────────────────────────────────────────────────── */

test('alta de otra app con la clave de administración: responde con una clave de conexión', async () => {
  const r = await pedir('/api/crew/v1/conexiones', {
    metodo: 'POST',
    cabeceras: { 'X-Api-Key': admin },
    cuerpo: { app: 'clipkeeper', url: urlOtra, clave: 'cgc_para-llamar-a-la-otra' },
  });
  assert.equal(r.status, 200);
  const { clave } = await r.json();
  assert.match(clave, /^cgc_[A-Za-z0-9_-]{43}$/);
  const guardado = fs.readFileSync(process.env.CREW_PATH, 'utf8');
  assert.doesNotMatch(guardado, new RegExp(clave), 'la clave emitida se guarda solo resumida');
  assert.match(guardado, /cgc_para-llamar-a-la-otra/, 'la de la otra, en claro (hace falta)');

  const conClave = (ruta, opciones = {}) =>
    pedir(ruta, { ...opciones, cabeceras: { 'X-Api-Key': clave }, sinCabecera: true });
  assert.equal((await conClave('/api/crew/v1/status')).status, 200);
  // Fuera de la lista de permisos: nada de la API general ni la administración del protocolo.
  for (const ruta of ['/api/ajustes/general', '/api/buscar/cola', '/api/crew/v1/conexiones']) {
    const fuera = await conClave(ruta);
    assert.equal(fuera.status, 403, ruta);
  }
  assert.equal(
    (await conClave('/api/ajustes/api-key', { metodo: 'POST', cuerpo: {} })).status,
    403
  );
  assert.equal((await conClave('/api/crew/v1/conexiones/1', { metodo: 'DELETE' })).status, 403);

  // Con clave de conexión no se crea ni se redirige una conexión…
  const crear = await conClave('/api/crew/v1/conexiones', {
    metodo: 'POST',
    cuerpo: { app: 'clonbuster', url: 'http://192.0.2.9:8095', clave: 'cgc_x' },
  });
  assert.equal(crear.status, 403);
  const redirigir = await conClave('/api/crew/v1/conexiones', {
    metodo: 'POST',
    cuerpo: { app: 'clipkeeper', url: 'http://192.0.2.9:8096', clave: 'cgc_x' },
  });
  assert.equal(redirigir.status, 403);
  // …pero la «vuelta» a su misma URL sí (le da una clave nueva).
  const vuelta = await conClave('/api/crew/v1/conexiones', {
    metodo: 'POST',
    cuerpo: { app: 'clipkeeper', url: urlOtra, clave: 'cgc_otra-mas-nueva' },
  });
  assert.equal(vuelta.status, 200);
  assert.match((await vuelta.json()).clave, /^cgc_/);

  // Renovar con la clave de conexión: vale, y la anterior sigue valiendo un tiempo (últimas 3).
  const renovar = await conClave('/api/crew/v1/conexiones/renovar', {
    metodo: 'POST',
    cuerpo: { app: 'clipkeeper', url: urlOtra, clave: 'cgc_renovada' },
  });
  assert.equal(renovar.status, 200);
  const otraClave = (await renovar.json()).clave;
  assert.equal(
    (await pedir('/api/crew/v1/status', { cabeceras: { 'X-Api-Key': otraClave } })).status,
    200
  );

  // Revocar desde Ajustes: ninguna de las que le dimos vuelve a valer.
  const [conexion] = await crew.listar();
  assert.equal(conexion.clave_conexion, true);
  assert.equal(conexion.entrada, true);
  const revocar = await pedir(`/api/ajustes/conexiones/${conexion.id}/revocar`, {
    metodo: 'POST',
    cookie: sesion,
  });
  assert.equal(revocar.status, 200);
  assert.equal((await conClave('/api/crew/v1/status')).status, 401);
  assert.equal(
    (await pedir('/api/crew/v1/status', { cabeceras: { 'X-Api-Key': otraClave } })).status,
    401
  );
  await pedir(`/api/ajustes/conexiones/${conexion.id}`, { metodo: 'DELETE', cookie: sesion });
});

test('la clave de administración sigue abriendo toda la API, sin cabeceras de origen', async () => {
  for (const ruta of ['/api/ajustes/general', '/api/buscar/cola', '/api/crew/v1/conexiones']) {
    const r = await pedir(ruta, { cabeceras: { 'X-Api-Key': admin }, sinCabecera: true });
    assert.equal(r.status, 200, ruta);
  }
  const post = await pedir('/api/ajustes/general', {
    metodo: 'PUT',
    cabeceras: { 'X-Api-Key': admin },
    cuerpo: { instancia: 'Buscador', url: '' },
    sinCabecera: true,
  });
  assert.equal(post.status, 200, 'un script con X-Api-Key no necesita X-Clipgeist ni Origin');
});

test('conectar desde Ajustes: se registra en la otra y se queda con SU clave de conexión', async () => {
  const r = await pedir('/api/ajustes/conexiones', {
    metodo: 'POST',
    cookie: sesion,
    cuerpo: { app: 'clipkeeper', url: urlOtra, api_key: otra.estado.admin },
  });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).reciproca, { ok: true });
  const d = JSON.parse(fs.readFileSync(process.env.CREW_PATH, 'utf8'));
  const c = d.conexiones.find(x => x.url === urlOtra);
  assert.match(c.api_key, /^cgc_clipkeeper/, 'la de administración de la otra se olvida');
  assert.ok(otra.estado.entradas.has(c.api_key));
  assert.match(otra.estado.paraLlamar, /^cgc_/, 'a la otra le damos una de conexión');
  // Y con la que le dimos puede llamarnos.
  assert.equal(
    (
      await pedir('/api/crew/v1/status', {
        cabeceras: { 'X-Api-Key': otra.estado.paraLlamar },
      })
    ).status,
    200
  );
});

/* ── B. Sesiones ────────────────────────────────────────────────────── */

test('sesiones en el servidor: lista, salir de verdad y cerrar las demás', async () => {
  const s1 = cookieDe(await login());
  const s2 = cookieDe(await login());
  assert.match(s1, /^clipgeist_sesion=clipscout\./);
  const { sesiones } = await (await pedir('/api/ajustes/sesiones', { cookie: s1 })).json();
  assert.ok(sesiones.length >= 3);
  assert.equal(sesiones.filter(s => s.esta).length, 1);
  assert.ok(sesiones.every(s => /^[0-9a-f]{16}$/.test(s.id) && s.dispositivo));

  // Salir borra la sesión: la cookie copiada deja de valer.
  const salir = await pedir('/api/auth/logout', { metodo: 'POST', cookie: s2 });
  assert.equal(salir.status, 200);
  assert.match(salir.headers.get('set-cookie'), /clipgeist_sesion=;/);
  assert.equal((await pedir('/api/ajustes/general', { cookie: s2 })).status, 401);

  // Cerrar las demás: solo queda la de quien lo pide.
  const demas = await pedir('/api/ajustes/sesiones/cerrar-demas', { metodo: 'POST', cookie: s1 });
  assert.ok((await demas.json()).cerradas >= 1);
  assert.equal((await pedir('/api/ajustes/general', { cookie: sesion })).status, 401);
  assert.equal((await pedir('/api/ajustes/general', { cookie: s1 })).status, 200);
  sesion = s1;

  // Cerrar una por su id.
  const s3 = cookieDe(await login());
  const lista = (await (await pedir('/api/ajustes/sesiones', { cookie: s1 })).json()).sesiones;
  const ajena = lista.find(s => !s.esta);
  assert.equal(
    (await pedir(`/api/ajustes/sesiones/${ajena.id}`, { metodo: 'DELETE', cookie: s1 })).status,
    200
  );
  assert.equal((await pedir('/api/ajustes/general', { cookie: s3 })).status, 401);
});

test('otra app valida y cierra una sesión de clipscout (con su clave de conexión)', async () => {
  const testigo = cookieDe(await login()).split('=')[1];
  const clave = otra.estado.paraLlamar;
  const validar = t =>
    pedir('/api/crew/v1/sesion/validar', {
      metodo: 'POST',
      cabeceras: { 'X-Api-Key': clave },
      cuerpo: { testigo: t },
      sinCabecera: true,
    }).then(r => r.json());
  const ok = await validar(testigo);
  assert.equal(ok.ok, true);
  assert.equal(ok.usuario, 'ana');
  assert.ok(ok.caduca);
  assert.deepEqual(await validar('clipscout.inventado'), { ok: false });
  const cerrar = await pedir('/api/crew/v1/sesion/cerrar', {
    metodo: 'POST',
    cabeceras: { 'X-Api-Key': clave },
    cuerpo: { testigo },
    sinCabecera: true,
  });
  assert.equal(cerrar.status, 200);
  assert.deepEqual(await validar(testigo), { ok: false });
});

test('inicio de sesión único: un testigo de clipkeeper vale si clipkeeper lo valida', async () => {
  const testigo = `clipkeeper.${'A'.repeat(43)}`;
  const cookie = `clipgeist_sesion=${testigo}`;
  assert.equal((await pedir('/api/ajustes/general', { cookie })).status, 401, 'aún no lo conoce');
  otra.estado.sesiones.set(testigo, 'ana');
  const antes = otra.estado.llamadas.length;
  // La caché del «no» dura 60 s: otro testigo para el «sí».
  const testigo2 = `clipkeeper.${'B'.repeat(43)}`;
  otra.estado.sesiones.set(testigo2, 'ana');
  const cookie2 = `clipgeist_sesion=${testigo2}`;
  assert.equal((await pedir('/api/ajustes/general', { cookie: cookie2 })).status, 200);
  assert.equal((await pedir('/api/ajustes/general', { cookie: cookie2 })).status, 200);
  const preguntas = otra.estado.llamadas
    .slice(antes)
    .filter(l => l.ruta === '/api/crew/v1/sesion/validar');
  assert.equal(preguntas.length, 1, 'se recuerda 60 s');
  assert.match(preguntas[0].clave, /^cgc_/, 'se pregunta con la clave de conexión');

  // Si la otra no responde, el último «sí» vale (hasta 5 min).
  otra.estado.caida = true;
  assert.equal((await pedir('/api/ajustes/general', { cookie: cookie2 })).status, 200);
  otra.estado.caida = false;

  // Un testigo de una app NO conectada: 401.
  const deClonbuster = `clipgeist_sesion=clonbuster.${'C'.repeat(43)}`;
  assert.equal((await pedir('/api/ajustes/general', { cookie: deClonbuster })).status, 401);

  // Salir con el testigo ajeno: se le pide a su app que lo borre.
  const salir = await pedir('/api/auth/logout', { metodo: 'POST', cookie: cookie2 });
  assert.equal(salir.status, 200);
  assert.ok(otra.estado.cerradas.includes(testigo2));
});

test('cambiar la contraseña cierra las demás sesiones y deja la actual', async () => {
  const otraSesion = cookieDe(await login());
  const cambio = await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cookie: sesion,
    cuerpo: { usuario: 'ana', contrasena: 'montana-nevada', actual: 'playa-larga-1' },
  });
  assert.equal(cambio.status, 200);
  assert.equal((await pedir('/api/ajustes/general', { cookie: otraSesion })).status, 401);
  assert.equal((await pedir('/api/ajustes/general', { cookie: sesion })).status, 200);
  // Se deja como estaba para el resto.
  await pedir('/api/ajustes/acceso', {
    metodo: 'PUT',
    cookie: sesion,
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1', actual: 'montana-nevada' },
  });
});

/* ── C. Host y origen ───────────────────────────────────────────────── */

test('nombre de host: solo los permitidos (421 con el motivo); health exento', async () => {
  // fetch no deja cambiar la cabecera Host: se hace con http.request.
  const conHost = (host, ruta = '/api/auth/estado', cabeceras = {}) =>
    new Promise((resolver, rechazar) => {
      const r = http.request(
        `${base}${ruta}`,
        { headers: { Host: host, 'X-Clipgeist': '1', ...cabeceras } },
        res => {
          let texto = '';
          res.on('data', c => {
            texto += c;
          });
          res.on('end', () => resolver({ status: res.statusCode, texto }));
        }
      );
      r.on('error', rechazar);
      r.end();
    });
  const mal = await conHost('ataque.ejemplo.test');
  assert.equal(mal.status, 421);
  assert.match(mal.texto, /CLIPGEIST_HOSTS/);
  assert.equal((await conHost('127.0.0.1.ataque.test')).status, 421);
  assert.equal((await conHost('ataque.ejemplo.test', '/api/health')).status, 200);
  for (const bueno of [
    '192.168.1.20:3001',
    '[::1]:3001',
    'localhost:3001',
    'app.localhost',
    `${os.hostname()}.local`,
    'clipscout.ejemplo.test',
    'nas.casa.test',
    'servidor:3001',
    'nas.lan',
    'equipo.home.arpa',
  ]) {
    assert.equal((await conHost(bueno)).status, 200, bueno);
  }
});

test('el host de una app conectada se acepta solo (como la llaman las otras)', async () => {
  await crew.guardarConexion({
    app: 'clonbuster',
    url: 'http://clonbuster-web:8095',
    api_key: 'cgc_y',
  });
  // (en la petición se recuerda la lista 10 s; aquí se mira la lista misma)
  assert.ok((await crew.hostsConocidos()).has('clonbuster-web'));
  assert.ok((await crew.hostsConocidos()).has('127.0.0.1'), 'y las de las demás conexiones');
});

test('origen: lo que cambia algo con cookie tiene que venir de la propia app', async () => {
  const cambiar = cabeceras =>
    pedir('/api/ajustes/general', {
      metodo: 'PUT',
      cookie: sesion,
      cuerpo: { instancia: 'X', url: '' },
      cabeceras,
      sinCabecera: true,
    });
  assert.equal((await cambiar({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await cambiar({ 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await cambiar({ Origin: 'http://ataque.ejemplo.test' })).status, 403);
  assert.equal((await cambiar({ Referer: 'http://ataque.ejemplo.test/x' })).status, 403);
  const rechazo = await cambiar({});
  assert.equal(rechazo.status, 403, 'sin ninguna cabecera hace falta X-Clipgeist');
  assert.match((await rechazo.json()).detail, /otra web/);
  assert.equal((await cambiar({ 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await cambiar({ Origin: base })).status, 200);
  assert.equal((await cambiar({ 'X-Clipgeist': '1' })).status, 200);
  // Una lectura de la API desde otra web tampoco (no arranca trabajo por un <img>).
  const leer = await pedir('/api/buscar/cola', {
    cookie: sesion,
    cabeceras: { 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(leer.status, 403);
  // El login también.
  const loginAjeno = await pedir('/api/auth/login', {
    metodo: 'POST',
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
    cabeceras: { 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(loginAjeno.status, 403);
});

test('la cookie va con HttpOnly, SameSite=Lax y Path=/; Secure solo con proxy de confianza', async () => {
  const r = await login();
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
  assert.doesNotMatch(c, /Secure/);
  const conProto = await pedir('/api/auth/login', {
    metodo: 'POST',
    cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
    cabeceras: { 'X-Forwarded-Proto': 'https' },
  });
  assert.doesNotMatch(
    conProto.headers.get('set-cookie'),
    /Secure/,
    'sin CLIPGEIST_PROXY_CONFIABLE'
  );
  process.env.CLIPGEIST_PROXY_CONFIABLE = '1';
  try {
    const confiable = await pedir('/api/auth/login', {
      metodo: 'POST',
      cuerpo: { usuario: 'ana', contrasena: 'playa-larga-1' },
      cabeceras: { 'X-Forwarded-Proto': 'https' },
    });
    assert.match(confiable.headers.get('set-cookie'), /Secure/);
  } finally {
    delete process.env.CLIPGEIST_PROXY_CONFIABLE;
  }
});

/* ── D. Primer usuario ──────────────────────────────────────────────── */

test('primer usuario: desde fuera del equipo solo con el código de primer arranque', async () => {
  // Se quita la contraseña (pide la actual): la app vuelve a «sin usuario».
  const quitar = await pedir('/api/ajustes/acceso/quitar', {
    metodo: 'POST',
    cookie: sesion,
    cuerpo: { actual: 'playa-larga-1' },
  });
  assert.equal(quitar.status, 200);
  const codigo = fs.readFileSync(acceso.rutaCodigo(), 'utf8').trim();
  assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(acceso.rutaCodigo()).mode & 0o777, 0o600);
  }

  const fuera = { 'X-Forwarded-For': '192.0.2.50' };
  // Sin usuario, desde fuera no se sirve nada: a la pantalla de primer arranque.
  const api = await pedir('/api/ajustes/general', { cabeceras: fuera });
  assert.equal(api.status, 401);
  assert.equal((await api.json()).primer_arranque, true);
  const estado = await (await pedir('/api/auth/estado', { cabeceras: fuera })).json();
  assert.equal(estado.primerArranque, true);
  assert.equal(estado.pideCodigo, true);
  // Desde el propio equipo sí.
  assert.equal((await pedir('/api/ajustes/general')).status, 200);

  const crear = cuerpo =>
    pedir('/api/auth/primer-usuario', { metodo: 'POST', cabeceras: fuera, cuerpo });
  const datos = { usuario: 'ana', contrasena: 'playa-larga-1' };
  assert.equal((await crear(datos)).status, 403);
  assert.equal((await crear({ ...datos, codigo: 'AAAA-BBBB' })).status, 403);
  const bien = await crear({ ...datos, codigo: codigo.toLowerCase().replace('-', '') });
  assert.equal(bien.status, 200);
  assert.match(cookieDe(bien), /^clipgeist_sesion=clipscout\./);
  assert.equal(fs.existsSync(acceso.rutaCodigo()), false, 'el código es de un solo uso');
  assert.equal((await crear({ ...datos, codigo })).status, 409);
  sesion = cookieDe(bien);
});

/* ── E. Aviso sin cifrar ────────────────────────────────────────────── */

test('aviso: desde una IP pública sin HTTPS, sí; desde la red local, no', () => {
  const { avisoSinCifrar } = require('../src/middleware/acceso');
  const req = (ip, extra = {}) => ({
    ip,
    socket: { remoteAddress: ip, encrypted: false, ...extra },
    get: () => undefined,
  });
  assert.equal(avisoSinCifrar(req('203.0.113.9')), true);
  assert.equal(avisoSinCifrar(req('8.8.8.8', { encrypted: true })), false);
  for (const ip of ['192.168.1.4', '10.0.0.2', '127.0.0.1', '100.64.1.1', '::1', 'fd00::1']) {
    assert.equal(avisoSinCifrar(req(ip)), false, ip);
  }
});
