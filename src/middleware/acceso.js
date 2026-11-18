'use strict';

const crypto = require('node:crypto');

const acceso = require('../services/acceso');
const crew = require('../services/crew');

// Sesión común de Clipgeist: misma cookie y mismo formato («<caduca en s>.<hmac>») en las tres
// apps. Las cookies no distinguen puertos: la que pone una app la reciben las otras del mismo
// servidor, y cualquiera la comprueba porque la firma sale del usuario y del hash de la
// contraseña, iguales en las tres (ver acceso.secreto()).
const COOKIE = 'clipgeist_sesion';
// Igual que clipkeeper y clonbuster: sesión de 30 días, y 8 fallos seguidos desde una misma
// dirección bloquean el login 5 minutos.
const DURACION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FALLOS = 8;
const BLOQUEO_MS = 5 * 60 * 1000;
const MAX_IPS = 10000;
// Lo mínimo para pintar la pantalla de acceso antes de haber entrado.
const LIBRES = new Set(['/login', '/login.html', '/js/login.js', '/styles/login.css']);

const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * Acceso a la interfaz: pantalla de login como en las otras apps de Clipgeist, con cookie
 * firmada, o HTTP Basic / `X-Api-Key` (la clave de Clipgeist de esta app) para clientes de API,
 * como en las *arr. Sin contraseña (ni en el entorno ni en Ajustes) todo pasa, como siempre.
 *
 * Libres siempre: el protocolo Clipgeist (tiene su propia clave), /api/health, /api/auth/* y lo
 * que necesita la pantalla de acceso. La firma sale de la contraseña: cambiarla cierra todas las
 * sesiones.
 */
function crearAcceso({ retrasoFalloMs = 600 } = {}) {
  const firmar = caduca =>
    crypto.createHmac('sha256', acceso.secreto()).update(String(caduca)).digest('hex');

  function sesionValida(req) {
    const par = (req.get('cookie') || '')
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(`${COOKIE}=`));
    if (!par) return false;
    const [caduca, firma, ...sobra] = par.slice(COOKIE.length + 1).split('.');
    if (sobra.length || !/^\d+$/.test(caduca || '')) return false;
    return Number(caduca) * 1000 > Date.now() && igual(firma, firmar(caduca));
  }

  /** Usuario y contraseña de una cabecera HTTP Basic, o null si no la trae. */
  function credencialesBasic(req) {
    const [tipo, valor] = (req.get('authorization') || '').split(' ');
    if (tipo !== 'Basic' || !valor) return null;
    const [usuario, ...resto] = Buffer.from(valor, 'base64').toString('utf8').split(':');
    return { usuario, contrasena: resto.join(':') };
  }

  async function claveApiValida(req) {
    const recibida = req.get('X-Api-Key');
    if (!recibida) return false;
    // Ajustes ilegibles: sin clave con la que comparar, no pasa.
    const propia = await crew.datos().then(
      d => d.api_key,
      () => null
    );
    return crew.claveValida(recibida, propia);
  }

  // Fallos por dirección: UN contador para las dos vías (formulario y HTTP Basic). Antes Basic no
  // contaba, y permitía probar contraseñas sin límite.
  const fallos = new Map();
  // La dirección real del socket: el contador no puede depender de una cabecera.
  const ipDe = req => req.socket.remoteAddress || '?';

  /** Si esa dirección está bloqueada, responde 429 y devuelve true. */
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
    // Como en las otras apps: un fallo tarda un poco, y eso frena los intentos a ciegas.
    await esperar(retrasoFalloMs);
  }

  /** Ajustes ilegibles (crew.json dañado y sin copia buena): todo cerrado, con el motivo. */
  function cerrada(req, res, error) {
    const detalle = error?.message || 'No se pueden leer los ajustes.';
    if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
      return res.status(503).type('text/plain; charset=utf-8').send(detalle);
    }
    return res.status(503).json({ detail: detalle });
  }

  async function guardia(req, res, next) {
    let error = null;
    try {
      await acceso.cargar();
    } catch (e) {
      error = e;
    }
    // crew.json ilegible: si la contraseña no viene del entorno, no se sabe si había una, así que
    // CERRADO (nunca abierto). Solo pasa la ruta de salud.
    if (error && !acceso.activo() && req.path !== '/api/health') return cerrada(req, res, error);
    if (
      !acceso.activo() ||
      req.path === '/api/health' ||
      req.path.startsWith('/api/crew/v1/') ||
      req.path.startsWith('/img/') ||
      req.path === '/styles/crew.css' ||
      req.path.startsWith('/api/auth/') ||
      LIBRES.has(req.path)
    ) {
      return next();
    }
    if (sesionValida(req)) return next();
    const basic = credencialesBasic(req);
    if (basic) {
      if (frenada(req, res)) return undefined;
      if (await acceso.verificar(basic.usuario, basic.contrasena)) {
        fallos.delete(ipDe(req));
        return next();
      }
      await apuntarFallo(req);
    }
    if (req.path.startsWith('/api/') && (await claveApiValida(req))) return next();
    if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
      return res.redirect(302, '/login');
    }
    res.set('WWW-Authenticate', 'Basic realm="clipscout", charset="UTF-8"');
    return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
  }

  function ponerSesion(req, res) {
    const caduca = Math.floor((Date.now() + DURACION_MS) / 1000);
    res.cookie(COOKIE, `${caduca}.${firmar(caduca)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: DURACION_MS,
    });
  }

  async function login(req, res) {
    try {
      await acceso.cargar();
    } catch (error) {
      if (!acceso.activo()) return cerrada(req, res, error);
    }
    if (!acceso.activo()) return res.json({ ok: true });
    if (frenada(req, res)) return undefined;
    const { usuario = '', contrasena = '' } = req.body || {};
    if (!(await acceso.verificar(usuario, contrasena))) {
      await apuntarFallo(req);
      return res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
    }
    fallos.delete(ipDe(req));
    ponerSesion(req, res);
    return res.json({ ok: true });
  }

  function logout(req, res) {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  }

  return { guardia, login, logout, ponerSesion, sesionValida };
}

module.exports = { crearAcceso, COOKIE };
