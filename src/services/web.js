'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { createLinkMatcher, looksLikeRegex } = require('../lib/pattern');

/**
 * Búsqueda «tipo Google» con SearXNG (metabuscador self-hosted, ver README): `site:<sitio> <nombre>`.
 *
 * Sirve para los sitios donde los vídeos se suben con títulos que no dicen el nombre: el buscador
 * web los encuentra igual por la descripción, las etiquetas, el usuario o los comentarios. Devuelve
 * las fichas del sitio que coinciden con su patrón de enlace; la fase 2 del crawl hace el resto.
 *
 * La URL de SearXNG la pone el administrador (SEARXNG_URL, normalmente en la red local), así que se
 * llama con `fetch` directo, sin la protección SSRF del scraping: igual que las conexiones de crew.
 */

/** Dominio del sitio a partir de su dirección de búsqueda guardada (con {q}, {page}…). */
function hostDe(searchUrl) {
  try {
    return new URL(String(searchUrl).replace(/\{[^}]*\}/g, 'x')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** `site:` más preciso si el patrón es un prefijo literal de ruta («/a/», «/video/»). */
function consultaSite(q, searchUrl, linkPattern = '') {
  const host = hostDe(searchUrl);
  const p = String(linkPattern || '').trim();
  const prefijo = p.startsWith('/') && !looksLikeRegex(p) && /^[\w/.-]+$/.test(p) ? p : '';
  return `site:${host}${prefijo} ${q}`;
}

async function buscarEnWeb(q, perfilConfig, { signal } = {}) {
  const base = config.busqueda.searxngUrl;
  if (!base) return [];
  const host = hostDe(perfilConfig.searchUrl);
  if (!host) return [];
  const coincide = createLinkMatcher(perfilConfig.linkPattern || '');
  const consulta = consultaSite(q, perfilConfig.searchUrl, perfilConfig.linkPattern);
  const vistas = new Set();
  for (let pagina = 1; pagina <= config.busqueda.webPaginas; pagina++) {
    if (signal?.aborted) break;
    const url = `${base.replace(/\/+$/, '')}/search?${new URLSearchParams({
      q: consulta,
      format: 'json',
      pageno: String(pagina),
    })}`;
    let datos;
    try {
      const r = await fetch(url, {
        signal: AbortSignal.any([
          AbortSignal.timeout(config.busqueda.webTimeoutMs),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      datos = await r.json();
    } catch (error) {
      logger.warn(`Búsqueda web: SearXNG no respondió (${error.message})`);
      break;
    }
    const antes = vistas.size;
    for (const res of datos.results || []) {
      let u;
      try {
        u = new URL(res.url);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(u.protocol)) continue;
      const h = u.hostname.replace(/^www\./, '');
      if (h !== host && !h.endsWith(`.${host}`)) continue;
      if (!coincide.test(u.href)) continue;
      vistas.add(u.href);
    }
    if (vistas.size === antes) break; // esta página no trajo nada nuevo
  }
  return [...vistas];
}

module.exports = { buscarEnWeb, consultaSite, hostDe };
