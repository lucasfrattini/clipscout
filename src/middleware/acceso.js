'use strict';

const crypto = require('node:crypto');

const COOKIE = 'clipscout_sesion';
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

/**
 * Acceso opcional (ADMIN_PASSWORD): pantalla de login como en las otras apps de clip crew, con
 * cookie firmada, o HTTP Basic para clientes de API. Libres: el protocolo clip crew (tiene su
 * propia clave), /api/health y lo que necesita la pantalla de acceso. La firma deriva de la
 * contraseña, así que cambiarla cierra todas las sesiones.
 */
function crearAcceso({ adminUser, adminPassword }) {
  const clave = crypto.createHash('sha256').update(`clipscout-sesion:${adminPassword}`).digest();
  const firmar = caduca => crypto.createHmac('sha256', clave).update(String(caduca)).digest('hex');
  const usuarioBien = u => igual(String(u).trim().toLowerCase(), String(adminUser).toLowerCase());

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
    return usuarioBien(usuario) && igual(resto.join(':'), adminPassword);
  }

  function guardia(req, res, next) {
    if (
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
    if (req.method === 'GET' && (req.get('accept') || '').includes('text/html')) {
      return res.redirect(302, '/login');
    }
    res.set('WWW-Authenticate', 'Basic realm="clipscout", charset="UTF-8"');
    return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
  }

  const fallos = new Map();

  function login(req, res) {
    // La dirección real del socket: el contador no puede depender de una cabecera.
    const ip = req.socket.remoteAddress || '?';
    const previo = fallos.get(ip);
    if (previo && previo.n >= MAX_FALLOS && previo.hasta > Date.now()) {
      res.set('Retry-After', String(Math.ceil((previo.hasta - Date.now()) / 1000)));
      return res.status(429).json({ detail: 'Demasiados intentos: espera unos minutos.' });
    }
    const { usuario = '', contrasena = '' } = req.body || {};
    if (!usuarioBien(usuario) || !igual(contrasena, adminPassword)) {
      if (fallos.size >= MAX_IPS) fallos.clear();
      const n = previo && previo.hasta > Date.now() ? previo.n + 1 : 1;
      fallos.set(ip, { n, hasta: Date.now() + BLOQUEO_MS });
      return res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
    }
    fallos.delete(ip);
    const caduca = Date.now() + DURACION_MS;
    res.cookie(COOKIE, `${caduca}.${firmar(caduca)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: DURACION_MS,
    });
    return res.json({ ok: true });
  }

  function logout(req, res) {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  }

  return { guardia, login, logout };
}

module.exports = { crearAcceso };
