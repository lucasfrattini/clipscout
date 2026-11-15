'use strict';

/**
 * El motor de exploración.
 *
 * Aquí vive lo que LEE el HTML (enlaces que casan con el patrón, ficheros de una ficha,
 * diagnóstico) y lo que valida los parámetros que llegan por la API. El resto está partido por
 * fases en src/services/crawl/ y se arma al final de este fichero:
 *
 *   descarga.js     bajar una página (navegador o HTTP) observando señales de bloqueo
 *   fase1.js        recorrer el listado (la estrategia de cada modo vive en pagination.js)
 *   fase2.js        abrir cada ficha: ficheros, relevancia, duración, miniatura, peso, caché
 *   orquestacion.js crawl y crawlMany: las dos fases, duplicados, frenar y continuar
 *
 * Cada fase recibe de aquí lo que usa (lectura del HTML, comprobación SSRF), así que este
 * fichero sigue siendo la única puerta: quien hacía `require('./scraper')` sigue igual.
 */

const config = require('../config');
const { AppError } = require('../lib/errors');
const { assertUrlIsSafe, isUrlSafe } = require('../lib/ssrf');
const {
  toAbsoluteUrl,
  hasExtension,
  hasPageTemplate,
  hasSearchTemplate,
  applySearchTerm,
} = require('../lib/url');
const {
  alojamientoGratuito,
  alojamientosEnHtml,
  soloConCuenta,
  buscaVideo,
} = require('../lib/alojamientos');
const { asDocument } = require('../lib/document');
const { createLinkMatcher } = require('../lib/pattern');
const { MODOS } = require('./pagination');

/** Selectores donde puede aparecer una referencia a un fichero. */
const FILE_SELECTORS =
  'a[href], img[src], video[src], audio[src], source[src], embed[src], object[data]';

/**
 * Extrae los links de un HTML que coinciden con `pattern`.
 *
 * Modos de `pattern`, según cómo esté escrito:
 *   - vacío             → todos los links
 *   - "/^\/videos\/\d+/" → expresión regular (barras + algún metacarácter)
 *   - "/..."            → se compara contra el href ORIGINAL del documento
 *   - "http..."         → se compara con startsWith sobre la URL absoluta
 *   - otra cosa         → se compara con includes sobre la URL absoluta
 *
 * Acepta un matcher ya compilado como tercer argumento. Compilar una vez por
 * exploración y no una por enlace no es solo cuestión de velocidad: es parte
 * de la defensa contra ReDoS, porque el presupuesto de tiempo se acumula en
 * el propio matcher a lo largo de toda la exploración.
 */
function extractMatchingLinks(html, baseUrl, pattern, diagnostico = null) {
  const $ = asDocument(html);
  const links = new Set();
  // Compatible con las llamadas que aún pasan la cadena del patrón
  const matcher =
    typeof pattern === 'object' && pattern !== null ? pattern : createLinkMatcher(pattern);

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href');
    const absolute = toAbsoluteUrl(rawHref, baseUrl);
    if (!absolute) return;

    // DIAGNÓSTICO (QW-D): se cuenta TODO enlace resoluble, case o no. Es lo
    // que luego permite decir "había 240 enlaces y ninguno casaba", en vez
    // de devolver una lista vacía sin explicación. No cambia lo que se
    // descarga ni lo que se devuelve: solo se apunta.
    if (diagnostico) {
      diagnostico.enlacesVistos += 1;
      anotarPrefijo(diagnostico, absolute);
    }

    if (matcher.test(rawHref, absolute)) links.add(absolute);
  });

  return [...links];
}

/**
 * Apunta el primer segmento de la ruta de un enlace.
 *
 * Sirve para proponer pistas cuando el patrón no casa con nada: los prefijos
 * más repetidos de la página son, casi siempre, el patrón que el usuario
 * buscaba. Se guarda solo el primer segmento porque es lo que se parece a un
 * patrón escribible ("/videos/"), no la ruta entera.
 */
function anotarPrefijo(diagnostico, absolute) {
  try {
    const { pathname } = new URL(absolute);
    const segmento = pathname.split('/').filter(Boolean)[0];
    if (!segmento) return;
    const prefijo = `/${segmento}/`;
    diagnostico.prefijos.set(prefijo, (diagnostico.prefijos.get(prefijo) || 0) + 1);
  } catch {
    // Una URL que no se puede parsear no aporta pista
  }
}

/** Estructura vacía de diagnóstico de la fase 1. */
function nuevoDiagnostico() {
  return {
    enlacesVistos: 0,
    prefijos: new Map(),
    bloqueo: { sospechoso: false, motivos: [] },
  };
}

/** Los `n` prefijos más frecuentes, como pista para el usuario. */
function prefijosMasFrecuentes(diagnostico, n = 3) {
  return [...diagnostico.prefijos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([prefijo, veces]) => ({ prefijo, veces }));
}

/** Busca en un HTML las URLs cuya extensión real esté en `extensions`. */
function extractFilesFromHtml(html, baseUrl, extensions) {
  const $ = asDocument(html);
  const files = new Set();
  const gratuitos = new Set();
  const conVideo = buscaVideo(extensions);

  $(FILE_SELECTORS).each((_, element) => {
    const $el = $(element);
    const raw = $el.attr('href') || $el.attr('src') || $el.attr('data');
    const absolute = toAbsoluteUrl(raw, baseUrl);
    if (!absolute) return;
    const alojado = conVideo ? alojamientoGratuito(absolute) : null;
    if (alojado) gratuitos.add(alojado);
    else if (hasExtension(absolute, extensions)) files.add(absolute);
  });

  if (conVideo) for (const url of alojamientosEnHtml($.html())) gratuitos.add(url);

  // Con una alternativa gratuita en la ficha, fuera los alojamientos que piden cuenta de pago:
  // el gestor de descargas se quedaría esperando una cuenta que no hay.
  if (gratuitos.size === 0) return [...files];
  return [...gratuitos, ...[...files].filter(f => !soloConCuenta(f))];
}

/* ── El motor, armado por fases (src/services/crawl/) ─────────────────── */

const { collectLinks } = require('./crawl/fase1')({
  extractMatchingLinks,
  nuevoDiagnostico,
  prefijosMasFrecuentes,
});
const { findFiles } = require('./crawl/fase2')({ extractFilesFromHtml, isUrlSafe });
const { crawl, crawlMany } = require('./crawl/orquestacion')({
  assertUrlIsSafe,
  collectLinks,
  findFiles,
});

/**
 * Resuelve la lista de direcciones a explorar a partir de la entrada cruda.
 *
 * Acepta, en este orden, las formas con las que puede llegar:
 *   - `searchUrls` como array (POST con cuerpo JSON).
 *   - `searchUrls` como string JSON de un array (GET del SSE).
 *   - `searchUrl` repetido, que Express entrega como array (GET del SSE).
 *   - `searchUrl` como string único: retrocompatible con los enlaces
 *     compartidos y los perfiles guardados, que siguen mandando `searchUrl`.
 *
 * Devuelve strings sin espacios, sin vacíos y sin repetidos, en el orden en
 * que llegaron.
 */
function resolverSearchUrls(input = {}) {
  let candidatos = [];

  if (Array.isArray(input.searchUrls)) {
    candidatos = input.searchUrls;
  } else if (typeof input.searchUrls === 'string' && input.searchUrls.trim() !== '') {
    try {
      const parsed = JSON.parse(input.searchUrls);
      if (Array.isArray(parsed)) candidatos = parsed;
    } catch {
      // Un JSON inválido no es una lista: se cae a `searchUrl` más abajo.
    }
  }

  if (candidatos.length === 0) {
    if (Array.isArray(input.searchUrl)) candidatos = input.searchUrl;
    else if (typeof input.searchUrl === 'string') candidatos = [input.searchUrl];
  }

  const vistas = new Set();
  const urls = [];
  for (const item of candidatos) {
    if (typeof item !== 'string') continue;
    const limpio = item.trim();
    if (limpio === '' || vistas.has(limpio)) continue;
    vistas.add(limpio);
    urls.push(limpio);
  }
  return urls;
}

/**
 * Normaliza los parámetros de un lote de una o varias direcciones.
 *
 * La configuración (patrón, extensiones, paginación, rango…) es COMPARTIDA:
 * cada dirección pasa por `normalizeCrawlParams` con esa misma configuración,
 * reutilizando toda la validación de una sola URL (término de búsqueda, tope
 * de páginas) sin duplicarla. Devuelve un array de parámetros por URL; con una
 * sola dirección, ese único elemento es idéntico a `normalizeCrawlParams`.
 */
function normalizeCrawlParamsList(input = {}) {
  const urls = resolverSearchUrls(input);
  if (urls.length === 0) {
    throw new AppError('Se requiere searchUrl', 400, 'SEARCH_URL_REQUIRED');
  }
  if (urls.length > config.crawl.maxUrls) {
    throw new AppError(
      `Se pidieron ${urls.length} direcciones y el máximo es ${config.crawl.maxUrls}`,
      400,
      'TOO_MANY_URLS'
    );
  }
  return urls.map(url => normalizeCrawlParams({ ...input, searchUrl: url }));
}

/** Valida y normaliza los parámetros de crawl que llegan por la API. */
function normalizeCrawlParams(input) {
  const rawUrl = typeof input.searchUrl === 'string' ? input.searchUrl.trim() : '';
  if (!rawUrl) {
    throw new AppError('Se requiere searchUrl', 400, 'SEARCH_URL_REQUIRED');
  }

  const searchTerm = typeof input.searchTerm === 'string' ? input.searchTerm.trim() : '';

  // El término se sustituye antes que nada, para que el resto del flujo
  // (incluida la validación SSRF) trabaje ya con la URL definitiva.
  if (hasSearchTemplate(rawUrl) && searchTerm === '') {
    throw new AppError(
      'La URL usa {q} pero no se indicó ningún término de búsqueda',
      400,
      'SEARCH_TERM_REQUIRED'
    );
  }
  const searchUrl = applySearchTerm(rawUrl, searchTerm);

  const startPage = Math.max(1, Number.parseInt(input.startPage, 10) || 1);
  const requestedEnd = Number.parseInt(input.endPage, 10) || 10;
  const endPage = Math.max(startPage, requestedEnd);

  const pageParam = typeof input.pageParam === 'string' ? input.pageParam.trim() : '';

  const paginationMode = MODOS.includes(input.paginationMode) ? input.paginationMode : 'auto';

  // En modo scroll no hay URLs por página: "Hasta" pasa a ser el número de
  // cargas, y el tope de páginas no aplica.
  const usePagination =
    paginationMode !== 'scroll' && (hasPageTemplate(searchUrl) || pageParam !== '');

  // El tope solo tiene sentido si de verdad se van a recorrer páginas. Sin
  // pageParam se descarga UNA sola, así que rechazar endPage=51 era gratuito:
  // devolvía un 400 por un rango que nunca se iba a usar.
  if (usePagination && endPage - startPage + 1 > config.crawl.maxPages) {
    throw new AppError(
      `El rango pedido es de ${endPage - startPage + 1} páginas y el máximo es ${config.crawl.maxPages}`,
      400,
      'PAGE_RANGE_TOO_LARGE'
    );
  }

  const rawConcurrency = Number.parseInt(input.concurrency, 10);
  const concurrency = Number.isFinite(rawConcurrency)
    ? Math.min(Math.max(1, rawConcurrency), config.crawl.maxConcurrency)
    : config.crawl.defaultConcurrency;

  return {
    searchUrl,
    searchTerm,
    pageParam,
    paginationMode,
    linkPattern: typeof input.linkPattern === 'string' ? input.linkPattern.trim() : '',
    startPage,
    // Sin paginación solo se pide una página; normalizar endPage evita que el
    // resumen diga "1 a 51" cuando en realidad se recorrió una.
    endPage: usePagination || paginationMode === 'scroll' ? endPage : startPage,
    useJavaScript: input.useJavaScript === true || input.useJavaScript === 'true',
    concurrency,
    // Solo dos valores: 'off' (todo) y 'open-only' (solo licencia abierta)
    licenseFilter: input.licenseFilter === 'open-only' ? 'open-only' : 'off',
    withSizes: input.withSizes === true || input.withSizes === 'true',
    withThumbnails: input.withThumbnails === true || input.withThumbnails === 'true',
  };
}

module.exports = {
  crawl,
  crawlMany,
  collectLinks,
  findFiles,
  extractMatchingLinks,
  extractFilesFromHtml,
  normalizeCrawlParams,
  normalizeCrawlParamsList,
  resolverSearchUrls,
};
