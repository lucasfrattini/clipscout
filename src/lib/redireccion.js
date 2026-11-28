'use strict';

/**
 * Enlaces de redirección («/out/?l=…», «/go?url=…»): algunos agregadores no enlazan la ficha del
 * vídeo sino un salto por su propio servidor, con la dirección de verdad metida dentro del enlace
 * (en claro o en base64). El gestor de descargas no sabe abrirlos —a menudo hay una comprobación
 * anti-robots delante— y el envío se perdía sin avisar: el paquete quedaba «terminado» y vacío.
 *
 * `desenvolver()` saca la dirección de dentro sin pedir nada a la red. Solo actúa cuando el enlace
 * tiene forma de salto (ruta o parámetro típicos) y lo de dentro es una dirección http(s) de OTRO
 * sitio; si no, devuelve el enlace tal cual.
 */

// Rutas y parámetros con los que se suelen hacer los saltos.
const RUTA_SALTO =
  /\/(out|go|goto|redirect|redir|r|click|away|exit|link|jump|track|visit|external)(\/|\.php|$|\?)/i;
const PARAMETROS_SALTO = new Set([
  'url',
  'u',
  'l',
  'link',
  'to',
  'target',
  'dest',
  'destination',
  'redirect',
  'redirect_url',
  'goto',
  'out',
  'href',
  'q',
]);
// Parámetros de seguimiento que no forman parte de la ficha.
const SEGUIMIENTO = /^(utm_[a-z]+|ref|fbclid|gclid)$/i;
const MAX_ANIDADOS = 3;

function base64AUtf8(valor) {
  const limpio = valor.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  if (limpio.length < 16 || !/^[A-Za-z0-9+/]+=*$/.test(limpio)) return '';
  try {
    return Buffer.from(limpio, 'base64').toString('latin1');
  } catch {
    return '';
  }
}

/** La primera dirección http(s) que aparezca en un texto (corta en lo que no sea imprimible). */
function primeraUrl(texto) {
  const m = /https?:\/\/[\x21-\x7e]+/.exec(texto || '');
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    for (const k of [...u.searchParams.keys()]) if (SEGUIMIENTO.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return null;
  }
}

/** Lo que hay dentro de un valor de parámetro: en claro, codificado como URL o en base64. */
function urlDentro(valor) {
  if (!valor) return null;
  let claro = valor;
  try {
    claro = decodeURIComponent(valor);
  } catch {
    /* tal cual */
  }
  if (/^https?:\/\//i.test(claro.trim())) return primeraUrl(claro.trim());
  return primeraUrl(base64AUtf8(claro));
}

function hostSinWww(u) {
  return u.hostname.replace(/^www\./i, '').toLowerCase();
}

/** Un paso: la dirección de dentro, o null si este enlace no es un salto. */
function unPaso(enlace) {
  let u;
  try {
    u = new URL(enlace);
  } catch {
    return null;
  }
  const rutaSalto = RUTA_SALTO.test(u.pathname);
  for (const [k, v] of u.searchParams) {
    if (!rutaSalto && !PARAMETROS_SALTO.has(k.toLowerCase())) continue;
    const dentro = urlDentro(v);
    if (!dentro) continue;
    let d;
    try {
      d = new URL(dentro);
    } catch {
      continue;
    }
    // Un parámetro que apunta al mismo sitio (paginación, «volver a») no es un salto.
    if (hostSinWww(d) === hostSinWww(u)) continue;
    // `q` solo cuenta en una ruta de salto: en una búsqueda normal es el término.
    if (k.toLowerCase() === 'q' && !rutaSalto) continue;
    return d.href;
  }
  return null;
}

/** La dirección final de un enlace de salto (hasta 3 saltos anidados), o el mismo enlace. */
function desenvolver(enlace) {
  let actual = String(enlace || '');
  for (let i = 0; i < MAX_ANIDADOS; i += 1) {
    const siguiente = unPaso(actual);
    if (!siguiente) break;
    actual = siguiente;
  }
  return actual;
}

module.exports = { desenvolver };
