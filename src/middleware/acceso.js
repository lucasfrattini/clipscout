'use strict';

const crypto = require('node:crypto');

const acceso = require('../services/acceso');
const crew = require('../services/crew');

const COOKIE = 'clipscout_sesion';
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
 * Acceso a la interfaz: pantalla de login como en las otras apps de clip crew, con cookie
 * firmada, o HTTP Basic / `X-Api-Key` (la clave de clip crew de esta app) para clientes de API,
 * como en las *arr. Sin contraseña (ni en el entorno ni en Ajustes) todo pasa, como siempre.
 *
 * Libres siempre: el protocolo clip crew (tiene su propia clave), /api/health, /api/auth/* y lo
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
    const [caduca, firma] = par.slice(COOKIE.length + 1).split('.');
    return Number(caduca) > Date.now() && igual(firma, firmar(caduca));
  }

  function basicValido(req) {
    const [tipo, valor] = (req.get('authorization') || '').split(' ');
    if (tipo !== 'Basic' || !valor) return false;
    const [usuario, ...resto] = Buffer.from(valor, 'base64').toString('utf8').split(':');
    return acceso.verificar(usuario, resto.join(':'));
  }

  async function claveApiValida(req) {
    const recibida = req.get('X-Api-Key');
    if (!recibida) return false;
    return crew.claveValida(recibida, (await crew.datos()).api_key);
  }

  async function guardia(req, res, next) {
    try {
      await acceso.cargar();
    } catch {
      // crew.json ilegible: mejor cerrado que abierto si había contraseña; sin datos, abierto
    }
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
    if (sesionValida(req) || basicValido(req)) return next();
    if (req.path.startsWith('/api/') && (await claveApiValida(req))) return next();
    if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
      return res.redirect(302, '/login');
    }
    res.set('WWW-Authenticate', 'Basic realm="clipscout", charset="UTF-8"');
    return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
  }

  const fallos = new Map();

  function ponerSesion(req, res) {
    const caduca = Date.now() + DURACION_MS;
    res.cookie(COOKIE, `${caduca}.${firmar(caduca)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: DURACION_MS,
    });
  }

  async function login(req, res) {
    await acceso.cargar().catch(() => {});
    if (!acceso.activo()) return res.json({ ok: true });
    // La dirección real del socket: el contador no puede depender de una cabecera.
    const ip = req.socket.remoteAddress || '?';
    const previo = fallos.get(ip);
    if (previo && previo.n >= MAX_FALLOS && previo.hasta > Date.now()) {
      res.set('Retry-After', String(Math.ceil((previo.hasta - Date.now()) / 1000)));
      return res.status(429).json({ detail: 'Demasiados intentos: espera unos minutos.' });
    }
    const { usuario = '', contrasena = '' } = req.body || {};
    if (!acceso.verificar(usuario, contrasena)) {
      if (fallos.size >= MAX_IPS) fallos.clear();
      const n = previo && previo.hasta > Date.now() ? previo.n + 1 : 1;
      fallos.set(ip, { n, hasta: Date.now() + BLOQUEO_MS });
      // Como en las otras apps: un fallo tarda un poco, y eso frena los intentos a ciegas.
      await esperar(retrasoFalloMs);
      return res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
    }
    fallos.delete(ip);
    ponerSesion(req, res);
    return res.json({ ok: true });
  }

  function logout(req, res) {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  }

  return { guardia, login, logout, ponerSesion };
}

module.exports = { crearAcceso, COOKIE };
