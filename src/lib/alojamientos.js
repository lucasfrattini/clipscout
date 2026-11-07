'use strict';

/**
 * Servicios de alojamiento de vídeo que publican el fichero sin extensión en la URL.
 *
 * Muchas fichas no enlazan un `.mp4` directo sino la página de un servicio de alojamiento. El
 * gestor de descargas (JDownloader) sabe bajar de varios de ellos GRATIS, pero solo si recibe un
 * dominio que reconoce: por eso cada uno se normaliza a su dominio canónico. Otros solo dejan
 * bajar con cuenta de pago: si en la misma ficha hay una alternativa gratuita, esos se descartan
 * para no mandar al gestor enlaces que se quedan esperando una cuenta.
 */

const GRATUITOS = [
  {
    nombre: 'mixdrop',
    // Ese servicio cambia de dominio a menudo; el identificador es lo que importa.
    patron:
      /^https?:\/\/(?:www\.)?(?:mxdrop|mixdrop|m1xdrop|mixdroop)\.[a-z]{2,6}\/(?:e|f)\/([a-z0-9]+)/i,
    normalizar: id => `https://mixdrop.ag/f/${id}`,
  },
];

const SOLO_CON_CUENTA =
  /^https?:\/\/(?:www\.)?(?:nitroflare\.(?:com|net)|nitro\.download|rapidgator\.net|rg\.to|katfile\.com|fikper\.com)\//i;

const EXTENSIONES_VIDEO = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'flv', 'ts', 'm3u8']);

/** URL canónica si es un alojamiento gratuito conocido; null si no. */
function alojamientoGratuito(url) {
  for (const a of GRATUITOS) {
    const m = a.patron.exec(String(url || ''));
    if (m) return a.normalizar(m[1]);
  }
  return null;
}

const soloConCuenta = url => SOLO_CON_CUENTA.test(String(url || ''));

/** ¿Se están buscando vídeos? (solo entonces tiene sentido mirar alojamientos). */
const buscaVideo = extensions =>
  (extensions || []).some(e => EXTENSIONES_VIDEO.has(String(e).replace(/^\./, '').toLowerCase()));

/**
 * Todos los alojamientos gratuitos que aparecen en el HTML, estén donde estén: el enlace suele ir
 * en `og:video`, en un `data-embed-src` que monta el reproductor al pulsar o dentro de un
 * `<noscript>`, no en un `<a>` normal.
 */
function alojamientosEnHtml(html) {
  const vistos = new Set();
  for (const m of String(html || '').matchAll(/https?:\/\/[^\s"'<>()\\]+/gi)) {
    const url = alojamientoGratuito(m[0]);
    if (url) vistos.add(url);
  }
  return [...vistos];
}

module.exports = { alojamientoGratuito, alojamientosEnHtml, soloConCuenta, buscaVideo };
