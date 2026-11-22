'use strict';

const config = require('../config');
const { asDocument } = require('../lib/document');
const { applySearchTerm, buildPageUrl } = require('../lib/url');
const { mapLimit } = require('../lib/concurrency');
const { normalizar } = require('../lib/filtros');

/**
 * NU-8 «Huecos por persona» (contrato C7): cuántos resultados dice tener cada sitio para un término
 * («de Ana Pérez tienes 67; el sitio tiene 140»). Mejor esfuerzo: se lee el número que la propia
 * página de resultados enseña («1.234 resultados», «Videos (140)»…); si no lo enseña o no
 * responde, `null`. Sin abrir fichas ni navegador: una petición por sitio. Se recuerda 24 h.
 */

const cache = new Map(); // término normalizado → { en, valor }
const MAX_CACHE = 500;

// «1.234 resultados», «140 videos», «Results: 87», «Vídeos (140)», «of 2,310 results».
const PATRONES = [
  /(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(?:results?|resultados?|videos?|vídeos?|clips?|items?|matches|coincidencias|títulos)\b/i,
  /(?:results?|resultados?|videos?|vídeos?|total)\s*[:(]\s*(\d{1,3}(?:[.,\s]\d{3})+|\d+)/i,
];

/** El total que enseña una página de resultados, o null. Pura. */
function totalDeHtml(html) {
  const $ = asDocument(html);
  $('script, style, noscript').remove();
  const zonas = [
    $('h1, h2, h3, .count, .total, .results, [class*="count"], [class*="result"]').text(),
    $('title').text(),
    $('body').text(),
  ];
  for (const zona of zonas) {
    const t = String(zona || '').replace(/\s+/g, ' ');
    for (const p of PATRONES) {
      const m = t.match(p);
      if (m) {
        const n = Number(m[1].replace(/[.,\s]/g, ''));
        if (Number.isFinite(n) && n >= 0 && n < 1e8) return n;
      }
    }
  }
  return null;
}

async function totalDelSitio(sitio, termino) {
  const c = sitio.perfil.config;
  const url = buildPageUrl(
    applySearchTerm(c.searchUrl, termino),
    c.pageParam || '',
    Number.parseInt(c.startPage, 10) || 1
  );
  try {
    const html = await require('../lib/http').fetchHtml(url, {
      timeout: config.recuento.timeoutMs,
    });
    return totalDeHtml(html);
  } catch {
    return null;
  }
}

async function recuento(termino) {
  const q = String(termino || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!q) {
    const error = new Error('Falta el término.');
    error.status = 400;
    throw error;
  }
  const k = normalizar(q).trim();
  const previo = cache.get(k);
  if (previo && Date.now() - previo.en < config.recuento.cacheMs) return previo.valor;
  const { listarSitios } = require('./busqueda');
  const sitios = await listarSitios();
  const totales = await mapLimit(sitios, config.busqueda.sitiosALaVez, async s => ({
    sitio: s.nombre,
    total: await totalDelSitio(s, q),
  }));
  const conDato = totales.filter(x => x.total !== null);
  const valor = {
    termino: q,
    total: conDato.length ? conDato.reduce((n, x) => n + x.total, 0) : null,
    sitios: totales,
    fecha: new Date().toISOString(),
  };
  cache.set(k, { en: Date.now(), valor });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return valor;
}

const olvidar = () => cache.clear();

module.exports = { recuento, totalDeHtml, olvidar };
