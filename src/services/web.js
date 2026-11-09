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

/** Minúsculas, sin acentos ni nada que no sea letra o número. */
function plano(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Una página de resultados de SearXNG en JSON, o null si no responde. */
async function consultar(consulta, pagina, { signal } = {}) {
  const base = config.busqueda.searxngUrl;
  if (!base) return null;
  const params = new URLSearchParams({ q: consulta, format: 'json', pageno: String(pagina) });
  if (config.busqueda.webMotores) params.set('engines', config.busqueda.webMotores);
  const url = `${base.replace(/\/+$/, '')}/search?${params}`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.any([
        AbortSignal.timeout(config.busqueda.webTimeoutMs),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (error) {
    logger.warn(`Búsqueda web: SearXNG no respondió (${error.message})`);
    return null;
  }
}

/**
 * Devuelve `{ fichas, listados }`:
 * - fichas: páginas de vídeo del sitio (coinciden con su patrón de enlace);
 * - listados: otras páginas del MISMO sitio cuya ruta nombra lo buscado (perfil de la modelo,
 *   etiqueta, canal…): se recorren como una búsqueda más para sacar sus fichas.
 */
async function buscarEnWeb(q, perfilConfig, { signal } = {}) {
  const vacio = { fichas: [], listados: [] };
  const base = config.busqueda.searxngUrl;
  if (!base) return vacio;
  const host = hostDe(perfilConfig.searchUrl);
  if (!host) return vacio;
  const termino = plano(q);
  let canonico = host;
  try {
    canonico = new URL(String(perfilConfig.searchUrl).replace(/\{[^}]*\}/g, 'x')).hostname;
  } catch {
    // se queda el dominio sin www
  }
  const listados = new Set();
  const coincide = createLinkMatcher(perfilConfig.linkPattern || '');
  const consulta = consultaSite(q, perfilConfig.searchUrl, perfilConfig.linkPattern);
  const vistas = new Set();
  for (let pagina = 1; pagina <= config.busqueda.webPaginas; pagina++) {
    if (signal?.aborted) break;
    const datos = await consultar(consulta, pagina, { signal });
    if (!datos) break;
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
      // es.sitio.com, de.sitio.com… son la misma ficha: se usa el dominio de la configuración.
      u.hostname = canonico;
      if (coincide.test(u.href)) vistas.add(u.href);
      else if (termino.length >= 4 && plano(decodeURIComponent(u.pathname)).includes(termino)) {
        listados.add(u.href);
      }
    }
    if (vistas.size === antes) break; // esta página no trajo nada nuevo
  }
  return { fichas: [...vistas], listados: [...listados].slice(0, config.busqueda.webListados) };
}

/** Rutas que nunca son la página de un vídeo (portadas, buscadores, perfiles de redes…). */
const NO_ES_FICHA = /^\/?$|^\/(?:search|tag|tags|category|categories|login|signup)(?:\/|$)/i;

/**
 * «En toda la web»: lo que el buscador encuentra con ese nombre en CUALQUIER sitio, quitando los
 * que ya están configurados (esos ya se buscan por su cuenta). Devuelve las páginas a abrir,
 * limitadas por dominio para que un solo sitio no se lleve toda la búsqueda, y en el orden del
 * buscador (lo más relevante primero).
 */
async function buscarEnLaWebAbierta(q, { excluir = new Set(), signal } = {}) {
  if (!config.busqueda.searxngUrl) return [];
  const porDominio = new Map();
  const elegidas = [];
  const vistas = new Set();
  for (let pagina = 1; pagina <= config.busqueda.webPaginas; pagina++) {
    if (signal?.aborted || elegidas.length >= config.busqueda.webAbiertoFichas) break;
    const datos = await consultar(`${q} video`, pagina, { signal });
    if (!datos) break;
    const antes = vistas.size;
    for (const res of datos.results || []) {
      let u;
      try {
        u = new URL(res.url);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(u.protocol) || vistas.has(u.href)) continue;
      vistas.add(u.href);
      const host = u.hostname.replace(/^www\./, '');
      if ([...excluir].some(h => host === h || host.endsWith(`.${h}`))) continue;
      if (NO_ES_FICHA.test(u.pathname)) continue;
      const n = porDominio.get(host) || 0;
      if (n >= config.busqueda.webAbiertoPorDominio) continue;
      porDominio.set(host, n + 1);
      elegidas.push(u.href);
      if (elegidas.length >= config.busqueda.webAbiertoFichas) break;
    }
    if (vistas.size === antes) break;
  }
  return elegidas;
}

module.exports = { buscarEnWeb, buscarEnLaWebAbierta, consultaSite, hostDe };
