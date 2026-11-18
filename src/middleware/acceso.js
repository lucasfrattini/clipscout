'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');

const acceso = require('../services/acceso');
const crew = require('../services/crew');
const sesiones = require('../services/sesiones');
const { isPrivateAddress } = require('../lib/ssrf');

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
const LIBRES = new Set(['/login', '/login.html', '/js/login.js', '/styles/login.css']);
const EXENTAS_HOST = new Set(['/api/health', '/api/salud']);
const CAMBIAN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
    return res.status(503).json({ detail: detalle });
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
        return res
          .status(421)
          .type('text/plain; charset=utf-8')
          .send('Esta dirección no está permitida. Añádela en CLIPGEIST_HOSTS.');
      }

      let error = null;
      try {
        await acceso.cargar();
      } catch (e) {
        error = e;
      }
      if (error && !acceso.activo() && req.path !== '/api/health') return cerrada(req, res, error);

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
      // El protocolo entre apps solo con clave (su propio 401, con el formato del protocolo).
      if (req.path.startsWith('/api/crew/v1/')) {
        return res
          .status(401)
          .json({ detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).' });
      }

      // 5. Origen (todo lo que sigue va sin clave: cookie, o sin contraseña desde el equipo)
      const sitio = req.get('sec-fetch-site');
      const cruzada = sitio === 'cross-site' || sitio === 'same-site';
      if (
        (CAMBIAN.has(req.method) && !origenPropio(req)) ||
        (cruzada && req.path.startsWith('/api/') && req.path !== '/api/health')
      ) {
        return res.status(403).json({ detail: 'Petición desde otra web rechazada.' });
      }

      if (libre(req)) {
        // Las rutas de /api/auth/ quieren saber si hay sesión (estado, salir).
        if (acceso.activo() && req.path.startsWith('/api/auth/')) await sesionDe(req, res);
        return next();
      }

      // 4. Sin usuario: solo el propio equipo
      if (!acceso.activo()) {
        if (esLocal(req)) return next();
        if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
          return res.redirect(302, '/login');
        }
        return res.status(401).json({
          detail: 'Aún no hay usuario: créalo desde la pantalla de acceso.',
          primer_arranque: true,
        });
      }

      // 3. Sesión
      if (await sesionDe(req, res)) return next();
      if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
        return res.redirect(302, '/login');
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
      return res
        .status(409)
        .json({ detail: 'Aún no hay usuario: créalo primero.', primer_arranque: true });
    }
    if (frenada(req, res)) return undefined;
    const { usuario = '', contrasena = '' } = req.body || {};
    if (!(await acceso.verificar(usuario, contrasena))) {
      await apuntarFallo(req);
      return res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
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
        return res.status(409).json({ detail: 'Ya hay un usuario: entra con él.' });
      }
      const r = await acceso.configurar(req.body || {}, { local: esLocal(req) });
      fallos.delete(ipDe(req));
      await abrirSesion(req, res, acceso.usuario());
      return res.json(r);
    } catch (error) {
      if (error.status === 403) await apuntarFallo(req);
      return res.status(error.status || 500).json({ detail: error.message });
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
