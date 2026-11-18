'use strict';

const crypto = require('node:crypto');

/**
 * Errores con código (SU-10, contrato común de Clipgeist: docs/CREW.md).
 *
 * Toda respuesta de error lleva `{codigo, detail, params}`: `codigo` en snake_case (la interfaz
 * traduce por él), `detail` en el idioma de la petición (`Accept-Language`; español por defecto) y
 * `params` con los huecos. `detail` se mantiene SIEMPRE: los scripts lo leen. Los campos de antes
 * (`error`, `code`) siguen ahí para quien los leyera.
 *
 * En vez de reescribir los ~70 sitios que contestan un error, `formatoErrores` envuelve `res.json`:
 * cualquier respuesta con estado ≥ 400 y `detail`/`error` sale normalizada. Los sitios donde el
 * estado no basta para saber el código lo dicen ellos (`codigo` en el cuerpo o en el error).
 */

/** Los comunes a las tres apps (mismo nombre en clipkeeper y clonbuster). */
const COMUNES = [
  'sin_sesion',
  'clave_invalida',
  'prohibido',
  'no_encontrado',
  'ocupado',
  'apagando',
  'host_no_permitido',
  'origen_rechazado',
  'demasiados_intentos',
  'datos_invalidos',
  'disco_no_responde',
  'en_uso',
  'error_interno',
];

/** Código por estado HTTP cuando nadie dijo otro. */
const POR_ESTADO = {
  400: 'datos_invalidos',
  401: 'sin_sesion',
  403: 'prohibido',
  404: 'no_encontrado',
  409: 'ocupado',
  413: 'datos_invalidos',
  415: 'datos_invalidos',
  421: 'host_no_permitido',
  423: 'en_uso',
  429: 'demasiados_intentos',
  499: 'cancelado',
  502: 'remoto_no_responde',
  503: 'no_disponible',
  504: 'remoto_no_responde',
};

/** Los códigos de AppError de antes (MAYÚSCULAS) que tienen equivalente común. */
const DE_ANTES = {
  INTERNAL_ERROR: 'error_interno',
  NOT_FOUND: 'no_encontrado',
  URL_REQUIRED: 'datos_invalidos',
  URL_INVALID: 'datos_invalidos',
  URL_NO_HOST: 'datos_invalidos',
  URL_TOO_LONG: 'datos_invalidos',
  PROTOCOL_NOT_ALLOWED: 'datos_invalidos',
  SEARCH_URL_REQUIRED: 'datos_invalidos',
  JOB_ID_REQUIRED: 'datos_invalidos',
  INVALID_PROFILES: 'datos_invalidos',
  SIN_SITIOS: 'datos_invalidos',
  SITIO_VACIO: 'datos_invalidos',
  SITIO_INVALIDO: 'datos_invalidos',
  HOST_NOT_ALLOWED: 'direccion_bloqueada',
  PRIVATE_ADDRESS_BLOCKED: 'direccion_bloqueada',
  PROXY_NO_FIRMADO: 'prohibido',
  RATE_LIMITED: 'demasiadas_peticiones',
  ABORTED: 'cancelado',
  APAGANDO: 'apagando',
  HTTP_ERROR: 'remoto_no_responde',
};

/** `detail` genérico en inglés por código (cuando la frase concreta no está traducida). */
const GENERICO_EN = {
  sin_sesion: 'You need to sign in.',
  clave_invalida: 'Wrong or missing API key (X-Api-Key header).',
  prohibido: 'Not allowed.',
  no_encontrado: 'Not found.',
  ocupado: 'Busy: there is already a job running.',
  apagando: 'The app is shutting down.',
  host_no_permitido: 'This address is not allowed. Add it to CLIPGEIST_HOSTS.',
  origen_rechazado: 'Request from another website rejected.',
  demasiados_intentos: 'Too many attempts: wait a few minutes.',
  datos_invalidos: 'Invalid data.',
  disco_no_responde: 'The disk is not responding.',
  en_uso: 'In use.',
  error_interno: 'Internal error (ref. {id}).',
  cancelado: 'Cancelled.',
  remoto_no_responde: 'The remote server did not respond properly.',
  no_disponible: 'Not available right now.',
  direccion_bloqueada: 'Access to that address is blocked.',
  demasiadas_peticiones: 'Too many requests. Try again in a moment.',
  ajustes_ilegibles: 'The settings file cannot be read.',
  ya_hay_usuario: 'There is already a user: sign in with it.',
  sin_usuario: 'There is no user yet: create it from the sign-in screen.',
  proxy_caido: 'The outbound proxy is not responding.',
  version_mas_nueva: 'This backup comes from a newer version ({version}): update first.',
  copia_invalida: 'This is not a valid clipscout backup.',
};

/** Las frases concretas más vistas, en inglés (la clave es el texto en español). */
const FRASES_EN = {
  'Hace falta usuario y contraseña.': 'Username and password required.',
  'Clave de API incorrecta o ausente (cabecera X-Api-Key).':
    'Wrong or missing API key (X-Api-Key header).',
  'Hace falta la clave de administración.': 'The admin API key is required.',
  'Esta clave de conexión no da acceso a esa ruta.':
    'This connection key does not give access to that route.',
  'Petición desde otra web rechazada.': 'Request from another website rejected.',
  'Demasiados intentos: espera unos minutos.': 'Too many attempts: wait a few minutes.',
  'Usuario o contraseña incorrectos.': 'Wrong username or password.',
  'Ya hay un usuario: entra con él.': 'There is already a user: sign in with it.',
  'Aún no hay usuario: créalo primero.': 'There is no user yet: create it first.',
  'Aún no hay usuario: créalo desde la pantalla de acceso.':
    'There is no user yet: create it from the sign-in screen.',
  'Falta el código de primer arranque.': 'The first-start code is missing.',
  'App desconocida.': 'Unknown app.',
  'La app se está cerrando.': 'The app is shutting down.',
  'No existe esa sesión.': 'That session does not exist.',
  'No existe esa conexión.': 'That connection does not exist.',
  'No existe esa copia.': 'That backup does not exist.',
  'No existe esa búsqueda programada.': 'That scheduled search does not exist.',
  'Ya hay una búsqueda programada en marcha.': 'A scheduled search is already running.',
  'No está en esta instalación.': 'Not part of this installation.',
  'No hay búsquedas.': 'No searches.',
  'No hay sitios para guardar.': 'No sites to save.',
  'Escribe la dirección del sitio.': "Type the site's address.",
  'Escribe qué buscar.': 'Type what to search for.',
  'Falta qué buscar.': 'Nothing to search for.',
  'La contraseña actual no es correcta.': 'The current password is not correct.',
  'Se requiere una URL': 'A URL is required',
  'La URL no tiene un formato válido': 'The URL is not valid',
  'Acceso a direcciones locales bloqueado': 'Access to local addresses is blocked',
  'Acceso a direcciones privadas bloqueado': 'Access to private addresses is blocked',
  'Las miniaturas están desactivadas': 'Thumbnails are disabled',
  'Esa imagen no la entregó este servidor': 'That image was not issued by this server',
  'Ese vídeo no lo entregó este servidor': 'That video was not issued by this server',
  'Búsqueda parada': 'Search stopped',
  'Operación cancelada': 'Operation cancelled',
};

/** «es» o «en» según `Accept-Language` (el primero que sepamos hablar; español por defecto). */
function idiomaDe(req) {
  const cabecera = String(req?.get?.('accept-language') || '');
  for (const parte of cabecera.split(',')) {
    const base = parte.split(';')[0].trim().toLowerCase().split('-')[0];
    if (base === 'es' || base === 'en') return base;
  }
  return 'es';
}

const rellenar = (plantilla, params = {}) =>
  plantilla.replace(/\{(\w+)\}/g, (crudo, k) => (k in params ? String(params[k]) : crudo));

/** El código que toca: el que venga dicho, el de antes traducido o el del estado. */
function codigoPara({ status = 500, codigo, code } = {}) {
  if (codigo) return codigo;
  if (code) return DE_ANTES[code] || String(code).toLowerCase();
  return POR_ESTADO[status] || (status >= 500 ? 'error_interno' : 'datos_invalidos');
}

/** `detail` en el idioma pedido: la frase concreta, o la genérica del código, o la original. */
function traducir(detalle, codigo, params, idioma) {
  if (idioma !== 'en') return detalle;
  if (FRASES_EN[detalle]) return FRASES_EN[detalle];
  if (GENERICO_EN[codigo]) return rellenar(GENERICO_EN[codigo], params);
  return detalle;
}

/** El cuerpo de error normalizado (sin perder lo que ya llevaba). */
function normalizar(cuerpo, status, idioma) {
  const codigo = codigoPara({ status, codigo: cuerpo.codigo, code: cuerpo.code });
  const params =
    cuerpo.params && typeof cuerpo.params === 'object' && !Array.isArray(cuerpo.params)
      ? cuerpo.params
      : {};
  const original = String(cuerpo.detail || cuerpo.error || '');
  const detail = traducir(original, codigo, params, idioma) || GENERICO_EN[codigo] || codigo;
  return { ...cuerpo, codigo, detail, params, ...(cuerpo.error ? {} : { error: detail }) };
}

/** Middleware: lo primero de la app, para que valga también para la guardia de acceso. */
function formatoErrores(req, res, next) {
  const json = res.json.bind(res);
  res.json = cuerpo => {
    if (
      res.statusCode >= 400 &&
      cuerpo &&
      typeof cuerpo === 'object' &&
      !Array.isArray(cuerpo) &&
      (cuerpo.detail !== undefined || cuerpo.error !== undefined || cuerpo.codigo)
    ) {
      return json(normalizar(cuerpo, res.statusCode, idiomaDe(req)));
    }
    return json(cuerpo);
  };
  next();
}

/** Identificador corto de un error interno: aparece en la respuesta y en el registro. */
const nuevoId = () => crypto.randomBytes(4).toString('hex');

/** Los últimos errores internos (para el diagnóstico): {fecha, codigo, id}. */
const ULTIMOS = [];
const MAX_ULTIMOS = 50;
function apuntar(codigo, id) {
  ULTIMOS.push({ fecha: new Date().toISOString(), codigo, id });
  if (ULTIMOS.length > MAX_ULTIMOS) ULTIMOS.splice(0, ULTIMOS.length - MAX_ULTIMOS);
}
const ultimos = () => ULTIMOS.slice().reverse();

/**
 * Responde un error capturado a mano en una ruta: si trae estado < 500 se contesta con su mensaje;
 * si no, error interno con identificador (el detalle real solo va al registro).
 */
function responder(req, res, error, logger) {
  const status = Number(error?.status || error?.statusCode) || 500;
  // Un 502/503/504 con su frase es un fallo previsto (la otra app no responde): se cuenta tal cual.
  if (status !== 500) {
    return res.status(status).json({
      detail: error.message,
      ...(error.codigo ? { codigo: error.codigo } : {}),
      ...(error.params ? { params: error.params } : {}),
    });
  }
  const id = nuevoId();
  apuntar('error_interno', id);
  logger?.error(`[${id}] ${req.method} ${req.path} → ${status}`, error);
  return res
    .status(500)
    .json({ codigo: 'error_interno', detail: `Error interno (ref. ${id}).`, params: { id } });
}

module.exports = {
  COMUNES,
  formatoErrores,
  normalizar,
  codigoPara,
  idiomaDe,
  nuevoId,
  apuntar,
  ultimos,
  responder,
};
