'use strict';

const cheerio = require('cheerio');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { enviarBusqueda } = require('../lib/browser');
const { tryFetchHtml } = require('../lib/http');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { toAbsoluteUrl, parseExtensionList } = require('../lib/url');
const { detectConfig } = require('./detector');
const { crawl, normalizeCrawlParams } = require('./scraper');

/**
 * Alta de un sitio con solo su dirección.
 *
 * Hasta ahora, sumar un sitio a la búsqueda era trabajo manual: encontrar la dirección de su
 * buscador, deducir la paginación, el patrón de las fichas y el tipo de fichero. Aquí se hace lo
 * mismo que haría una persona, en orden:
 *
 *   1. Encontrar el buscador del sitio: su OpenSearch si lo declara; si no, escribir en la caja de
 *      búsqueda con el navegador y ver a dónde lleva; si no, el formulario del HTML; y por último
 *      las direcciones de búsqueda más habituales.
 *   2. Con una búsqueda real (el término de prueba), proponer paginación, patrón y navegador con el
 *      detector de siempre.
 *   3. PROBARLO: una búsqueda de verdad hasta los ficheros. Un sitio solo se da por bueno si la
 *      prueba encuentra vídeos; si no, se dice por qué y no se guarda nada.
 *
 * El paso 3 es lo que permite ofrecerlo como automático: la propuesta del detector sola acierta
 * casi siempre, no siempre (ver CLAUDE.md), y aquí cada propuesta llega comprobada.
 */

/** Nombres habituales del campo de búsqueda, del más al menos probable. */
const CAMPOS_BUSQUEDA = [
  'q',
  's',
  'search',
  'query',
  'k',
  'keyword',
  'keywords',
  'term',
  'search_query',
];

/** Direcciones de búsqueda habituales, por si el sitio no tiene formulario reconocible. */
const PLANTILLAS_HABITUALES = [
  '/search?q={q}',
  '/search/{q}/',
  '/?s={q}',
  '/search?search={q}',
  '/search?k={q}',
  '/search/?q={q}',
  '/buscar?q={q}',
];

/** Lo que se busca si la configuración detectada no menciona ninguna extensión de vídeo. */
const EXTENSIONES_VIDEO = ['.mp4', '.webm', '.m4v', '.mov', '.mkv', '.m3u8'];

/** «ejemplo.com», «www.ejemplo.com/algo» o una dirección completa → la portada, con esquema. */
function portadaDe(entrada) {
  const texto = String(entrada || '').trim();
  if (!texto) throw new AppError('Escribe la dirección del sitio.', 400, 'SITIO_VACIO');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw new AppError(`«${texto}» no es una dirección válida.`, 400, 'SITIO_INVALIDO');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new AppError('Solo direcciones http o https.', 400, 'SITIO_INVALIDO');
  }
  return `${url.protocol}//${url.host}/`;
}

/** Formas en que el término puede aparecer escrito en una dirección. */
function formasDelTermino(termino) {
  const t = String(termino).trim();
  const formas = new Set([
    encodeURIComponent(t),
    encodeURIComponent(t).replace(/%20/g, '+'),
    t.replace(/\s+/g, '-'),
    t.replace(/\s+/g, '_'),
    t.replace(/\s+/g, '+'),
    t,
  ]);
  const minus = [...formas].map(f => f.toLowerCase());
  return [...new Set([...formas, ...minus])].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * Convierte la dirección de una búsqueda real en plantilla, cambiando el término por {q}.
 * Devuelve null si el término no aparece: entonces no se sabe dónde va, y adivinarlo sería
 * guardar una configuración que busca siempre lo mismo.
 */
function plantillaDesdeUrl(url, termino) {
  for (const forma of formasDelTermino(termino)) {
    const i = url.toLowerCase().indexOf(forma.toLowerCase());
    if (i >= 0) return url.slice(0, i) + '{q}' + url.slice(i + forma.length);
  }
  return null;
}

/** La plantilla de búsqueda que declara el sitio en su OpenSearch (`<link rel="search">`). */
function enlaceOpenSearch(html, base) {
  const $ = cheerio.load(html);
  const href = $('link[rel="search"][type="application/opensearchdescription+xml"]').attr('href');
  return href ? toAbsoluteUrl(href, base) : null;
}

function plantillaOpenSearch(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  let plantilla = null;
  $('Url').each((_, el) => {
    const tipo = $(el).attr('type') || '';
    const t = $(el).attr('template') || '';
    if (!plantilla && /text\/html/i.test(tipo) && t.includes('{searchTerms}')) plantilla = t;
  });
  if (!plantilla) return null;
  // Los parámetros opcionales de OpenSearch ({startPage?}…) no tienen equivalente: fuera.
  return plantilla
    .replace('{searchTerms}', '{q}')
    .replace(/[?&][^=&]+=\{[^}]+\?\}/g, '')
    .replace(/\{[^}]+\?\}/g, '');
}

/**
 * El formulario de búsqueda del HTML, como plantilla. Solo formularios GET: uno POST no tiene una
 * dirección que se pueda guardar.
 */
function plantillaDeFormulario(html, base) {
  const $ = cheerio.load(html);
  let mejor = null;
  $('form').each((_, form) => {
    const $f = $(form);
    if (($f.attr('method') || 'get').toLowerCase() !== 'get') return;
    const campos = $f.find('input[type="search"], input[type="text"], input:not([type])');
    let elegido = null;
    let puntos = -1;
    campos.each((__, input) => {
      const nombre = $(input).attr('name');
      if (!nombre) return;
      const pista = [nombre, $(input).attr('id'), $(input).attr('placeholder'), $f.attr('action')]
        .join(' ')
        .toLowerCase();
      let p = 0;
      const pos = CAMPOS_BUSQUEDA.indexOf(nombre.toLowerCase());
      if (pos >= 0) p += 20 - pos;
      if ($(input).attr('type') === 'search') p += 10;
      if (/search|busca|query/.test(pista)) p += 5;
      if (p > puntos) {
        puntos = p;
        elegido = nombre;
      }
    });
    if (!elegido || puntos <= 0) return;
    const accion = toAbsoluteUrl($f.attr('action') || base, base);
    if (!accion) return;
    const url = new URL(accion);
    $f.find('input[type="hidden"][name]').each((__, h) => {
      url.searchParams.set($(h).attr('name'), $(h).attr('value') || '');
    });
    url.searchParams.set(elegido, '__CLIPSCOUT_Q__');
    if (!mejor || puntos > mejor.puntos) {
      mejor = { puntos, plantilla: url.href.replace('__CLIPSCOUT_Q__', '{q}') };
    }
  });
  return mejor?.plantilla || null;
}

/** Cuenta los enlaces internos distintos de un HTML (un listado de resultados tiene muchos). */
function enlacesInternos(html, base) {
  const $ = cheerio.load(html);
  const host = new URL(base).host;
  const vistos = new Set();
  $('a[href]').each((_, a) => {
    const abs = toAbsoluteUrl($(a).attr('href'), base);
    try {
      if (abs && new URL(abs).host === host) vistos.add(abs.split('#')[0]);
    } catch {
      // enlace roto: no cuenta
    }
  });
  return vistos.size;
}

/** ¿Esta plantilla da una página de resultados de verdad para el término? */
async function plantillaResponde(plantilla, termino, { signal }) {
  const url = plantilla.replace('{q}', encodeURIComponent(termino));
  try {
    await assertUrlIsSafe(url);
  } catch {
    return false;
  }
  const html = await tryFetchHtml(url, { signal });
  if (!html) return false;
  const menciona = html.toLowerCase().includes(String(termino).toLowerCase());
  return menciona && enlacesInternos(html, url) >= config.autoSitio.minEnlaces;
}

/** Paso 1: la dirección del buscador del sitio, como plantilla con {q}. */
async function encontrarBuscador(portada, termino, { signal, emit = () => {} } = {}) {
  const html = await tryFetchHtml(portada, { signal });

  // a) OpenSearch: el propio sitio dice cómo se busca.
  if (html) {
    const os = enlaceOpenSearch(html, portada);
    if (os) {
      const xml = await tryFetchHtml(os, { signal }).catch(() => null);
      const plantilla = xml ? plantillaOpenSearch(xml) : null;
      if (plantilla) return { plantilla, via: 'opensearch' };
    }
  }

  // b) La caja de búsqueda, con el navegador: lo que de verdad pide el sitio.
  if (config.browser.enabled && !signal?.aborted) {
    emit({ type: 'paso', paso: 'caja' });
    try {
      const destino = await enviarBusqueda(portada, termino);
      const plantilla = destino ? plantillaDesdeUrl(destino, termino) : null;
      if (plantilla) return { plantilla, via: 'caja' };
    } catch (error) {
      logger.warn(`Alta de sitio: la caja de búsqueda de ${portada} falló`, error.message);
    }
  }

  // c) El formulario del HTML, sin navegador.
  if (html) {
    const plantilla = plantillaDeFormulario(html, portada);
    if (plantilla && (await plantillaResponde(plantilla, termino, { signal }))) {
      return { plantilla, via: 'formulario' };
    }
  }

  // d) Las direcciones de búsqueda habituales.
  emit({ type: 'paso', paso: 'habituales' });
  for (const ruta of PLANTILLAS_HABITUALES) {
    if (signal?.aborted) break;
    const plantilla = new URL(ruta.replace('{q}', '__Q__'), portada).href.replace('__Q__', '{q}');
    if (await plantillaResponde(plantilla, termino, { signal })) {
      return { plantilla, via: 'habitual' };
    }
  }
  return null;
}

/** Extensiones a buscar: las de vídeo que vio el detector o, si no vio ninguna, las habituales. */
function extensionesDeVideo(propuestas) {
  const vistas = parseExtensionList(propuestas || '')
    .map(e => `.${e}`)
    .filter(e => EXTENSIONES_VIDEO.includes(e));
  return (vistas.length > 0 ? vistas : EXTENSIONES_VIDEO).join(', ');
}

/** La búsqueda de prueba, hasta los ficheros, con unas pocas fichas. */
async function probar(configSitio, termino, { signal }) {
  const params = normalizeCrawlParams({
    ...configSitio,
    searchTerm: termino,
    endPage: Number.parseInt(configSitio.startPage, 10) || 1,
  });
  const r = await crawl(
    {
      ...params,
      extensions: parseExtensionList(configSitio.fileExtensions),
      maxLinks: config.autoSitio.fichasDePrueba,
    },
    { signal, group: false }
  );
  return {
    enlaces: r.totalLinks,
    ficheros: r.totalFiles,
    ejemplos: (r.fileDetails || [])
      .slice(0, 3)
      .map(d => ({ titulo: d.title || null, url: d.url, duracion: d.duration || null })),
    bloqueo: r.diagnostico?.bloqueo?.sospechoso === true,
  };
}

/**
 * Configura un sitio a partir de su dirección. Devuelve `{ ok, nombre, config, prueba, via,
 * motivo }`; con `ok: false` no hay nada que guardar y `motivo` dice en qué paso falló.
 */
async function configurarSitio({ url, termino }, { signal, emit = () => {} } = {}) {
  const portada = portadaDe(url);
  const prueba = String(termino || '').trim();
  if (prueba.length < 2) {
    throw new AppError(
      'Escribe un término de prueba (algo que el sitio tenga).',
      400,
      'SIN_TERMINO'
    );
  }
  await assertUrlIsSafe(portada);
  const host = new URL(portada).hostname.replace(/^www\./, '');
  const fallo = motivo => ({ ok: false, nombre: host, portada, motivo });

  emit({ type: 'paso', paso: 'buscador' });
  const buscador = await encontrarBuscador(portada, prueba, { signal, emit });
  if (!buscador) return fallo('buscador');

  emit({ type: 'paso', paso: 'listado' });
  const urlPrueba = buscador.plantilla.replace('{q}', encodeURIComponent(prueba));
  let det;
  try {
    det = await detectConfig(urlPrueba, { signal });
  } catch (error) {
    logger.warn(`Alta de sitio: no se pudo leer el listado de ${host}`, error.message);
    return fallo('listado');
  }
  const s = det.sugerencia;
  // El detector devuelve la dirección con el término de prueba (y {page} si la encontró).
  const searchUrl = plantillaDesdeUrl(s.searchUrl, prueba) || buscador.plantilla;
  const configSitio = {
    searchUrl,
    pageParam: s.pageParam || '',
    // Sin botonera de páginas, el detector propone scroll; sin navegador eso no puede ir, y
    // entonces se queda en una sola página (sigue sirviendo para la búsqueda rápida).
    paginationMode: s.paginationMode === 'scroll' && config.browser.enabled ? 'scroll' : 'auto',
    linkPattern: s.linkPattern || '',
    fileExtensions: extensionesDeVideo(s.fileExtensions),
    useJavaScript: Boolean(s.useJavaScript),
    startPage: 1,
    endPage: 3,
  };
  if (!configSitio.linkPattern) return { ...fallo('patron'), config: configSitio };

  // Paso 3: la prueba de verdad. Sin ficheros y sin navegador, se repite con él: es lo más
  // frecuente en las fichas que montan el reproductor con JavaScript.
  emit({ type: 'paso', paso: 'prueba' });
  const probarSinRomper = async c => {
    try {
      return await probar(c, prueba, { signal });
    } catch (error) {
      logger.warn(`Alta de sitio: la búsqueda de prueba en ${host} falló`, error.message);
      return { enlaces: 0, ficheros: 0, ejemplos: [], bloqueo: false, error: error.message };
    }
  };
  let resultado = await probarSinRomper(configSitio);
  if (
    resultado.ficheros === 0 &&
    !configSitio.useJavaScript &&
    config.browser.enabled &&
    !signal?.aborted
  ) {
    emit({ type: 'paso', paso: 'prueba_navegador' });
    const conNavegador = { ...configSitio, useJavaScript: true };
    const otra = await probarSinRomper(conNavegador);
    if (otra.ficheros > 0 || otra.enlaces > resultado.enlaces) {
      configSitio.useJavaScript = true;
      resultado = otra;
    }
  }
  const nombre = `${host} — búsqueda`;
  if (resultado.ficheros === 0) {
    return {
      ...fallo(resultado.enlaces === 0 ? 'sin_fichas' : 'sin_ficheros'),
      config: configSitio,
      prueba: resultado,
    };
  }
  return { ok: true, nombre, portada, via: buscador.via, config: configSitio, prueba: resultado };
}

module.exports = {
  configurarSitio,
  encontrarBuscador,
  plantillaDesdeUrl,
  plantillaDeFormulario,
  plantillaOpenSearch,
  enlaceOpenSearch,
  portadaDe,
  extensionesDeVideo,
};
