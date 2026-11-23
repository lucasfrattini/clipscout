'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const { renderPage } = require('../../lib/browser');
const { fetchHtml, fetchHtmlWithRetry } = require('../../lib/http');
const { analizarRespuesta, analizarError, combinar } = require('../../lib/blocking');

/**
 * Cómo se descarga una página: con navegador o por HTTP, y observando de paso las señales de
 * bloqueo. Lo usan las dos fases.
 */

/**
 * Renderiza con navegador y, si falla, reintenta por HTTP plano.
 *
 * A diferencia de fetchPage, aquí el error del HTTP se propaga: en la fase 2
 * cada URL tiene su registro de fallo, y tragarse el motivo dejaba al usuario
 * sin saber por qué una página no dio ficheros.
 */
async function renderPageOrFallback(url, { signal, scroll = true }) {
  try {
    return await renderPage(url, { signal, scroll });
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`Navegador falló en ${url}, se reintenta por HTTP`, error.message);
    return fetchHtmlWithRetry(url, { signal, timeout: config.http.fileScanTimeoutMs });
  }
}

/**
 * Descarga una página con el motor elegido, observando señales de bloqueo.
 *
 * El cliente HTTP rechaza los 4xx, así que un bloqueo por código de estado
 * llega dentro del error y nunca por el camino normal: hay que mirar las dos
 * vías. Lo que se observa es SOSPECHA, no diagnóstico; ver lib/blocking.js.
 */
async function fetchPage(url, { useJavaScript, signal, diagnostico = null }) {
  const anotar = observacion => {
    if (diagnostico && observacion?.sospechoso) {
      diagnostico.bloqueo = combinar([diagnostico.bloqueo, observacion]);
    }
  };

  if (useJavaScript) {
    try {
      const html = await renderPage(url, { signal });
      // Un challenge devuelto con 200 se ve igual de bien en el navegador:
      // hay que mirar el contenido, no solo el estado.
      anotar(analizarRespuesta({ html }));
      return html;
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn(`Puppeteer falló en ${url}, usando HTTP directo`, error.message);
    }
  }

  try {
    const html = await fetchHtml(url, { signal });
    anotar(analizarRespuesta({ html }));
    return html;
  } catch (error) {
    anotar(analizarError(error));
    logger.warn(`No se pudo descargar ${url}`, error.message);
    return null;
  }
}

module.exports = { renderPageOrFallback, fetchPage };
