'use strict';

const logger = require('../../lib/logger');
const { createLinkMatcher } = require('../../lib/pattern');
const { findExtension } = require('../extensions');
const { resolveMode, ESTRATEGIAS } = require('../pagination');
const { fetchPage } = require('./descarga');

/** FASE 1: recorrer el listado y juntar los enlaces a las fichas. */

/** Lo que lee el HTML vive en scraper.js, que arma el motor y lo pasa aquí. */
module.exports = function crear({ extractMatchingLinks, nuevoDiagnostico, prefijosMasFrecuentes }) {
  /**
   * FASE 1 — recorre el listado y acumula links.
   *
   * El recorrido en sí vive en `services/pagination.js`, una función por modo.
   * Aquí se resuelve lo que comparten todas: qué motor descarga, qué patrón
   * filtra y qué topes se aplican.
   *
   * Corta si: se acaban las páginas, una página no devuelve links, se supera el
   * tope de links, o el cliente cancela.
   */
  async function collectLinks(options) {
    const {
      searchUrl,
      pageParam,
      linkPattern,
      paginationMode,
      startPage,
      endPage,
      useJavaScript,
      signal,
      onProgress,
    } = options;

    // El patrón se compila UNA vez para toda la exploración: si fuese una vez
    // por página, cada una empezaría con el presupuesto de tiempo a cero y la
    // protección contra ReDoS no serviría de nada.
    const matcher = createLinkMatcher(linkPattern);

    // Diagnóstico de la fase 1: cuántos enlaces se vieron, qué prefijos son los
    // más frecuentes y si el sitio parece estar bloqueando. No influye en lo
    // que se descarga; sirve para poder explicar un resultado vacío.
    const diagnostico = nuevoDiagnostico();

    const modo = resolveMode({ paginationMode, searchUrl, pageParam });
    const estrategia = ESTRATEGIAS[modo];

    // Extensión por sitio, si alguna reclama esta URL. Sustituye solo al "de
    // dónde salen los enlaces de una página": el recorrido lo sigue llevando
    // la estrategia del modo, sin duplicar el bucle ni los topes.
    const extension = findExtension(searchUrl);
    if (extension?.listar) {
      logger.info(`Usando la extensión "${extension.name}" para listar ${searchUrl}`);
    }

    const resultado = await estrategia({
      searchUrl,
      pageParam,
      startPage,
      endPage,
      signal,
      onProgress,
      fetchPage: url => fetchPage(url, { useJavaScript, signal, diagnostico }),
      extract: (html, baseUrl) => extractMatchingLinks(html, baseUrl, matcher, diagnostico),
      listar: extension?.listar ? extension.listar.bind(extension) : null,
    });

    return {
      ...resultado,
      paginationMode: modo,
      extension: extension?.name || null,
      diagnostico: {
        enlacesVistos: diagnostico.enlacesVistos,
        prefijos: prefijosMasFrecuentes(diagnostico),
        bloqueo: diagnostico.bloqueo,
      },
    };
  }

  return { collectLinks };
};
