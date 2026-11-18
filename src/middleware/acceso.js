'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');

const acceso = require('../services/acceso');
const crew = require('../services/crew');
const sesiones = require('../services/sesiones');
const { isPrivateAddress } = require('../lib/ssrf');
const errores = require('../lib/errores');
const logger = require('../lib/logger');

/**
 * Acceso a clipscout (fase 1 de seguridad, común a las tres apps de Clipgeist: docs/CREW.md).
 *
 * Por orden, en cada petición:
 * 1. Nombre de host permitido (contra la reasignación de DNS): IP, localhost, el nombre del
 *    equipo, CLIPGEIST_HOSTS y los hosts de las URLs de las conexiones y de la propia. Si no, 421.
 * 2. `X-Api-Key`: la de administración abre toda la API (scripts, como en las *arr); una de
 *    conexión (`cgc_…`) solo las rutas del protocolo de `PERMITIDAS_CONEXION`.
 * 3. Sesión: testigo opaco en la cookie `clipgeist_sesion`. Propio → services/sesiones; de otra
 *    app conectada → se le pregunta a ella; cookie firmada de 2.17 → se canjea una vez.
 * 4. Sin usuario creado, solo se atiende al propio equipo (CS-S1); desde fuera, primer arranque.
 * 5. Lo que cambia algo y no viene con clave: tiene que venir de la propia app (Sec-Fetch-Site,
 *    Origin/Referer o, sin ninguna, la cabecera `X-Clipgeist: 1` de la interfaz). Si no, 403.
 *
 * HTTP Basic ya no se acepta: ningún cliente propio lo usaba y se saltaba el formulario.
 */
const COOKIE = 'clipgeist_sesion';
// 8 fallos seguidos desde una misma dirección bloquean el login 5 minutos (como las otras apps).
const MAX_FALLOS = 8;
const BLOQUEO_MS = 5 * 60 * 1000;
const MAX_IPS = 10000;
// Lo mínimo para pintar la pantalla de acceso antes de haber entrado.
// También el asistente de primer arranque (él mismo manda a /login si hay usuario y no sesión).
const LIBRES = new Set([
  '/login',
  '/login.html',
  '/js/login.js',
  '/styles/login.css',
  '/bienvenida',
  '/bienvenida.html',
  '/js/bienvenida.js',
  '/styles/bienvenida.css',
  // El navegador pide el manifiesto sin cookies (SU-14): sin datos, solo nombre e iconos.
  '/manifest.webmanifest',
  // «Compartir» del móvil (CS-N8): solo guarda lo compartido en la pestaña y abre Buscar (que ya
  // pide la sesión); sin datos.
  '/compartir',
  '/compartir.html',
  '/js/compartir.js',
]);
const EXENTAS_HOST = new Set(['/api/health', '/api/salud']);
const CAMBIAN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RUTAS_LANZADOR = new Set(['/api/apagar', '/api/estado-trabajos']);
const CON_SESION_EN_PROTOCOLO = new Set(['/api/crew/v1/copia', '/api/crew/v1/copia/restaurar']);

/**
 * Lo único que puede pedir otra app con una clave de conexión (además de nada fuera de
 * /api/crew/v1/). clipkeeper usa `imagenes`; las tres, `status`, el alta y la renovación de la
 * conexión y las sesiones.
 */
const PERMITIDAS_CONEXION = [
  ['GET', '/api/crew/v1/status'],
  ['GET', '/api/crew/v1/imagenes'],
  ['POST', '/api/crew/v1/conexiones'],
  ['POST', '/api/crew/v1/conexiones/renovar'],
  ['POST', '/api/crew/v1/sesion/validar'],
  ['POST', '/api/crew/v1/sesion/cerrar'],
];
const permitidaConConexion = req =>
  PERMITIDAS_CONEXION.some(
    ([m, ruta]) => (req.method === m || (m === 'GET' && req.method === 'HEAD')) && req.path === ruta
  );

const esperar = ms => new Promise(r => setTimeout(r, ms));

/* ── Utilidades de la petición ───────────────────────────────────────── */

const sinCorchetes = h => h.replace(/^\[|\]$/g, '');

/** El host de la cabecera Host, sin puerto y en minúsculas. */
function hostDe(req) {
  const crudo = String(req.get('host') || '')
    .trim()
    .toLowerCase();
  if (crudo.startsWith('[')) return sinCorchetes(crudo.slice(0, crudo.indexOf(']') + 1));
  return crudo.replace(/:\d*$/, '');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** ¿Viene del propio equipo? Socket de loopback y sin X-Forwarded-For de otra dirección. */
function esLocal(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  const reenviada = req.get('x-forwarded-for');
  if (!reenviada) return true;
  return reenviada
    .split(',')
    .map(x => x.trim())
    .every(x => LOOPBACK.has(x));
}

/** ¿Llega cifrada? X-Forwarded-Proto solo cuenta con CLIPGEIST_PROXY_CONFIABLE=1. */
function esHttps(req) {
  if (req.socket.encrypted) return true;
  return (
    process.env.CLIPGEIST_PROXY_CONFIABLE === '1' &&
    String(req.get('x-forwarded-proto') || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https'
  );
}

/** ¿Desde internet (no privada, ni loopback, ni CGNAT) y sin cifrar? Para el aviso de la interfaz. */
function avisoSinCifrar(req) {
  if (esHttps(req)) return false;
  const ip = String(req.ip || req.socket.remoteAddress || '');
  if (!net.isIP(ip)) return false;
  return !isPrivateAddress(ip);
}

/* ── 1. Nombre de host ───────────────────────────────────────────────── */

function coincide(host, patron) {
  const p = patron.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) return host === p.slice(2) || host.endsWith(p.slice(1));
  return host === p;
}

let conocidos = { hosts: new Set(), hasta: 0 };
async function hostsDeConexiones() {
  if (Date.now() < conocidos.hasta) return conocidos.hosts;
  const hosts = await crew.hostsConocidos().catch(() => conocidos.hosts);
  conocidos = { hosts, hasta: Date.now() + 10 * 1000 };
  return hosts;
}

async function hostPermitido(req) {
  const host = hostDe(req);
  if (!host) return false;
  if (net.isIP(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const equipo = os.hostname().toLowerCase();
  const base = host.replace(/\.(local|lan|home)$/, '');
  if (base === equipo || host === equipo) return true;
  // Un nombre sin punto («servidor», el de un contenedor) o de los dominios reservados para redes
  // privadas solo lo resuelve la red local: un atacante no puede apuntarlo a esta app desde fuera,
  // que es de lo que protege esta lista. (En Docker el nombre del equipo es el del contenedor.)
  if (!host.includes('.') || /\.(local|lan|home|home\.arpa|internal)$/.test(host)) return true;
  const extra = String(process.env.CLIPGEIST_HOSTS || '').split(',');
  if (extra.some(p => coincide(host, p))) return true;
  return (await hostsDeConexiones()).has(host);
}

/* ── 5. Origen ───────────────────────────────────────────────────────── */

/** ¿Esta petición viene de la propia interfaz? (para lo que cambia algo sin clave). */
function origenPropio(req) {
  const sitio = req.get('sec-fetch-site');
  if (sitio) return sitio === 'same-origin' || sitio === 'none';
  const origen = req.get('origin') || req.get('referer');
  if (origen) {
    try {
      return new URL(origen).host.toLowerCase() === String(req.get('host') || '').toLowerCase();
    } catch {
      return false;
    }
  }
  return req.get('x-clipgeist') === '1';
}

/* ── Cookie ──────────────────────────────────────────────────────────── */

function cookieDe(req) {
  const par = (req.get('cookie') || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${COOKIE}=`));
  return par ? decodeURIComponent(par.slice(COOKIE.length + 1)) : '';
}

const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/** Cookie firmada de 2.17 («<caduca>.<hmac>») bien firmada y sin caducar: su caducidad, o null. */
function antiguaValida(valor) {
  const m = /^(\d+)\.([0-9a-f]{64})$/.exec(valor);
  if (!m) return null;
  const caduca = Number(m[1]);
  if (caduca * 1000 <= Date.now()) return null;
  const esperado = crypto
    .createHmac('sha256', acceso.secretoAntiguo())
    .update(String(caduca))
    .digest('hex');
  return igual(m[2], esperado) ? caduca : null;
}

function crearAcceso({ retrasoFalloMs = 600 } = {}) {
  // Fallos de login (y de código de primer arranque) por dirección del socket.
  const fallos = new Map();
  const ipDe = req => req.socket.remoteAddress || '?';

  function frenada(req, res) {
    const previo = fallos.get(ipDe(req));
    if (!previo || previo.n < MAX_FALLOS || previo.hasta <= Date.now()) return false;
    res.set('Retry-After', String(Math.ceil((previo.hasta - Date.now()) / 1000)));
    res.status(429).json({ detail: 'Demasiados intentos: espera unos minutos.' });
    return true;
  }

  async function apuntarFallo(req) {
    const ip = ipDe(req);
    const previo = fallos.get(ip);
    if (fallos.size >= MAX_IPS) fallos.clear();
    const n = previo && previo.hasta > Date.now() ? previo.n + 1 : 1;
    fallos.set(ip, { n, hasta: Date.now() + BLOQUEO_MS });
    await esperar(retrasoFalloMs);
  }

  function opcionesCookie(req, maxAge) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: esHttps(req),
      path: '/',
      ...(maxAge ? { maxAge } : {}),
    };
  }

  function ponerCookie(req, res, testigo) {
    res.cookie(COOKIE, testigo, opcionesCookie(req, sesiones.DURACION_MS));
  }

  /** Sesión nueva para `usuario` y su cookie. Devuelve el testigo. */
  async function abrirSesion(req, res, usuario) {
    const testigo = await sesiones.crear({
      usuario,
      agente: req.get('user-agent'),
      ip: req.ip || req.socket.remoteAddress,
    });
    ponerCookie(req, res, testigo);
    req.sesion = { testigo, propia: true, usuario };
    return testigo;
  }

  /**
   * La sesión de la cookie, o null. Deja en `req.sesion` {testigo, propia, usuario}. Canjea las
   * cookies antiguas (2.17) y alarga las propias que lo necesiten (vuelve a mandar la cookie).
   */
  async function sesionDe(req, res) {
    const valor = cookieDe(req);
    if (!valor) return null;
    const app = sesiones.appDe(valor);
    if (app === sesiones.APP) {
      const s = await sesiones.validar(valor, { ip: req.ip || req.socket.remoteAddress });
      if (!s) return null;
      if (s.renovada) ponerCookie(req, res, valor);
      req.sesion = { testigo: valor, propia: true, usuario: s.usuario };
      return req.sesion;
    }
    if (app) {
      const r = await crew.validarSesionAjena(valor, app);
      if (!r.ok) return null;
      req.sesion = { testigo: valor, propia: false, app, usuario: r.usuario };
      return req.sesion;
    }
    // Cookie firmada de antes: se acepta UNA vez y se cambia por una sesión de verdad.
    const caduca = antiguaValida(valor);
    if (caduca === null) return null;
    const estado = await sesiones.estadoAntigua(valor, caduca);
    if (estado === 'no') return null;
    if (estado === 'canjear') {
      await sesiones.marcarCanjeada(valor, caduca);
      await abrirSesion(req, res, acceso.usuario());
    } else {
      req.sesion = { testigo: null, propia: false, usuario: acceso.usuario() };
    }
    return req.sesion;
  }

  /** Clave de la cabecera: {tipo:'admin'} | {tipo:'conexion', conexion} | {tipo:'mala'} | null. */
  async function claveDe(req) {
    const recibida = req.get('X-Api-Key');
    if (!recibida) return null;
    try {
      if (crew.esClaveConexion(recibida)) {
        const conexion = await crew.conexionPorClave(recibida);
        return conexion ? { tipo: 'conexion', conexion } : { tipo: 'mala' };
      }
      return (await crew.esClaveAdmin(recibida)) ? { tipo: 'admin' } : { tipo: 'mala' };
    } catch {
      return { tipo: 'mala' }; // ajustes ilegibles: sin clave con la que comparar, no pasa
    }
  }

  function cerrada(req, res, error) {
    const detalle = error?.message || 'No se pueden leer los ajustes.';
    if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
      return res.status(503).type('text/plain; charset=utf-8').send(detalle);
    }
    return res.status(503).json({ codigo: 'ajustes_ilegibles', detail: detalle });
  }

  const libre = req =>
    req.path === '/api/health' ||
    req.path === '/api/salud' ||
    req.path.startsWith('/img/') ||
    req.path === '/styles/crew.css' ||
    req.path.startsWith('/api/auth/') ||
    LIBRES.has(req.path);

  async function guardia(req, res, next) {
    try {
      // 1. Host
      if (!EXENTAS_HOST.has(req.path) && !(await hostPermitido(req))) {
        const texto = 'Esta dirección no está permitida. Añádela en CLIPGEIST_HOSTS.';
        // Un navegador ve el texto; un script o la otra app, el error con código (SU-10).
        if ((req.get('accept') || '').includes('text/html')) {
          return res.status(421).type('text/plain; charset=utf-8').send(texto);
        }
        return res.status(421).json({ codigo: 'host_no_permitido', detail: texto });
      }

      let error = null;
      try {
        await acceso.cargar();
      } catch (e) {
        error = e;
      }
      if (error && !acceso.activo() && !EXENTAS_HOST.has(req.path)) return cerrada(req, res, error);

      // 2. Clave
      const clave = await claveDe(req);
      if (clave?.tipo === 'conexion') {
        if (!permitidaConConexion(req)) {
          return res
            .status(403)
            .json({ detail: 'Esta clave de conexión no da acceso a esa ruta.' });
        }
        req.clave = clave;
        return next();
      }
      if (clave?.tipo === 'admin' && req.path.startsWith('/api/')) {
        req.clave = clave;
        return next();
      }
      // El protocolo entre apps solo con clave (su propio 401, con el formato del protocolo). La
      // copia de la suite (SU-20) vale también con sesión: la descarga la interfaz.
      if (req.path.startsWith('/api/crew/v1/') && !CON_SESION_EN_PROTOCOLO.has(req.path)) {
        // `GET /status` sin clave es público, como en clipkeeper y clonbuster (contrato): solo dice
        // qué app es y su versión. Con una clave que no vale, 401 (así «Probar» comprueba la clave).
        if (req.method === 'GET' && req.path === '/api/crew/v1/status' && clave === null) {
          return next();
        }
        return res.status(401).json({
          codigo: 'clave_invalida',
          detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).',
        });
      }

      // 5. Origen (todo lo que sigue va sin clave: cookie, o sin contraseña desde el equipo)
      const sitio = req.get('sec-fetch-site');
      const cruzada = sitio === 'cross-site' || sitio === 'same-site';
      if (
        (CAMBIAN.has(req.method) && !origenPropio(req)) ||
        (cruzada && req.path.startsWith('/api/') && req.path !== '/api/health')
      ) {
        return res
          .status(403)
          .json({ codigo: 'origen_rechazado', detail: 'Petición desde otra web rechazada.' });
      }

      // El lanzador y el instalador (sin sesión) pueden pedir el apagado ordenado y preguntar si
      // hay algo en marcha, solo desde el propio equipo y con la cabecera de la app (una web no
      // puede mandarla sin permiso de CORS, que no se da).
      if (
        RUTAS_LANZADOR.has(req.path) &&
        esLocal(req) &&
        req.get('x-clipgeist') === '1' &&
        !cruzada
      ) {
        return next();
      }

      if (libre(req)) {
        // Las rutas de /api/auth/ quieren saber si hay sesión (estado, salir).
        if (acceso.activo() && req.path.startsWith('/api/auth/')) await sesionDe(req, res);
        return next();
      }

      // 4. Sin usuario: solo el propio equipo
      if (!acceso.activo()) {
        if (esLocal(req)) return next();
        // El asistente de primer arranque (desde otro dispositivo, con el código) necesita los
        // módulos y estilos de la interfaz: son ficheros estáticos sin datos.
        if (req.method === 'GET' && /^\/(js|styles)\//.test(req.path)) return next();
        if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
          return res.redirect(302, '/login');
        }
        return res.status(401).json({
          codigo: 'sin_usuario',
          detail: 'Aún no hay usuario: créalo desde la pantalla de acceso.',
          primer_arranque: true,
        });
      }

      // 3. Sesión
      if (await sesionDe(req, res)) return next();
      if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
        return res.redirect(302, '/login');
      }
      // Con una clave que no vale (y sin sesión), el motivo es la clave, no la sesión.
      if (clave?.tipo === 'mala') {
        return res.status(401).json({
          codigo: 'clave_invalida',
          detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).',
        });
      }
      return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
    } catch (e) {
      return next(e);
    }
  }

  async function login(req, res) {
    try {
      await acceso.cargar();
    } catch (error) {
      if (!acceso.activo()) return cerrada(req, res, error);
    }
    if (!acceso.activo()) {
      return res.status(409).json({
        codigo: 'sin_usuario',
        detail: 'Aún no hay usuario: créalo primero.',
        primer_arranque: true,
      });
    }
    if (frenada(req, res)) return undefined;
    const { usuario = '', contrasena = '' } = req.body || {};
    if (!(await acceso.verificar(usuario, contrasena))) {
      await apuntarFallo(req);
      return res
        .status(401)
        .json({ codigo: 'credenciales_incorrectas', detail: 'Usuario o contraseña incorrectos.' });
    }
    fallos.delete(ipDe(req));
    await abrirSesion(req, res, acceso.usuario());
    return res.json({ ok: true });
  }

  /** Primer usuario: desde el propio equipo o con el código de primer arranque (SU-04). */
  async function primerUsuario(req, res) {
    if (frenada(req, res)) return undefined;
    try {
      await acceso.cargar();
      if (acceso.activo()) {
        return res
          .status(409)
          .json({ codigo: 'ya_hay_usuario', detail: 'Ya hay un usuario: entra con él.' });
      }
      const cuerpo = req.body || {};
      // «Usar la misma cuenta que <app>»: primero el código (desde fuera), para que esto no sirva
      // para probar contraseñas de la otra app; luego se entra en la otra con lo tecleado.
      if (cuerpo.cuentaDe) {
        if (!crew.APPS.includes(cuerpo.cuentaDe) || cuerpo.cuentaDe === crew.APP) {
          return res.status(400).json({ detail: 'App desconocida.' });
        }
        if (!esLocal(req) && !(await acceso.codigoValido(cuerpo.codigo))) {
          await apuntarFallo(req);
          return res.status(403).json({ detail: 'Falta el código de primer arranque.' });
        }
        const valida = await require('../services/asistente').validarCuentaEn(
          cuerpo.cuentaDe,
          String(cuerpo.usuario || '').trim(),
          String(cuerpo.contrasena || '')
        );
        if (!valida) {
          await apuntarFallo(req);
          return res.status(401).json({
            codigo: 'credenciales_incorrectas',
            detail: `Usuario o contraseña incorrectos en ${cuerpo.cuentaDe}.`,
            params: { app: cuerpo.cuentaDe },
          });
        }
      }
      const r = await acceso.configurar(cuerpo, { local: esLocal(req) });
      fallos.delete(ipDe(req));
      await abrirSesion(req, res, acceso.usuario());
      return res.json(r);
    } catch (error) {
      if (error.status === 403) await apuntarFallo(req);
      return errores.responder(req, res, error, logger);
    }
  }

  async function logout(req, res) {
    const valor = cookieDe(req);
    const app = sesiones.appDe(valor);
    if (app === sesiones.APP) await sesiones.cerrar({ testigo: valor }).catch(() => {});
    else if (app) await crew.cerrarSesionAjena(valor, app);
    res.clearCookie(COOKIE, opcionesCookie(req));
    res.json({ ok: true });
  }

  /**
   * Tras poner o cambiar la contraseña: se cierran las demás sesiones y quien la cambió sigue
   * dentro (con su sesión, o una nueva si no tenía una propia).
   */
  async function trasCambiarContrasena(req, res) {
    const actual = req.sesion?.propia ? req.sesion.testigo : null;
    await sesiones.cerrarTodas({ salvo: actual });
    if (!actual && acceso.activo()) await abrirSesion(req, res, acceso.usuario());
  }

  return {
    guardia,
    login,
    logout,
    primerUsuario,
    abrirSesion,
    trasCambiarContrasena,
    sesionDe,
    esLocal,
    avisoSinCifrar,
  };
}

module.exports = {
  crearAcceso,
  COOKIE,
  PERMITIDAS_CONEXION,
  esLocal,
  esHttps,
  avisoSinCifrar,
  origenPropio,
  hostDe,
};
