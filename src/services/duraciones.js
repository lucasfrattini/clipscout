'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { fetchHtml } = require('../lib/http');
const { asDocument } = require('../lib/document');
const { extractDurationSeconds, extractFileDurations, formatDuration } = require('../lib/media');
const cacheFichas = require('./cacheFichas');

/**
 * Duración que falta: cuando un resultado llega sin duración, se pide después la ficha con una
 * petición LIGERA (HTTP, sin navegador; con el throttle por dominio de lib/http.js) y, si la
 * declara, se actualiza el resultado con un evento `duracion`.
 *
 * Por qué hace falta: con navegador, la fase 2 lee el DOM ya pintado, y hay sitios que dejan la
 * duración solo en el HTML de origen (metadatos `video:duration`, JSON-LD) y la quitan al pintar.
 *
 * Las reglas de relevancia NO se relajan: a un fichero dudoso no se le busca duración, y la de la
 * página solo vale si la ficha tiene UN fichero (con varios, un álbum, solo la que se asocia a
 * cada fichero). En segundo plano, de pocas en pocas y con tope por búsqueda.
 */

/** ¿A este resultado le falta una duración que se pueda buscar? */
function leFalta(it) {
  return (
    it &&
    !Number.isFinite(it.durationSeconds) &&
    !it.suspect &&
    typeof it.sourceUrl === 'string' &&
    /^https?:\/\//i.test(it.sourceUrl) &&
    it.sourceUrl !== it.url
  );
}

/**
 * Un completador por búsqueda. `publicar(evento)` recibe `{ type: 'duracion', items: [...] }`.
 * `anotar(items)` encola las fichas a las que les falta; `esperar()` espera a lo encolado (con
 * tope) para que el evento `fin` llegue después de las últimas duraciones.
 */
function crear({ signal, publicar, buscar = fetchHtml } = {}) {
  const fichasVistas = new Set();
  const ficherosPorFicha = new Map(); // ficha → Set de ficheros hallados en ESTA búsqueda
  const dudosos = new Set(); // ficheros marcados como dudosos: cuentan, pero nunca reciben duración
  const pendientes = [];
  let enVuelo = 0;
  let lanzadas = 0;
  let alTerminar = [];

  const avisarSiAcabo = () => {
    if (pendientes.length === 0 && enVuelo === 0) {
      const esperando = alTerminar;
      alTerminar = [];
      esperando.forEach(fn => fn());
    }
  };

  async function completar(ficha) {
    const html = await buscar(ficha, { signal, timeout: config.duraciones.timeoutMs });
    const doc = asDocument(html);
    // Cuántos ficheros tiene la ficha: lo que sabe la caché (la ficha entera) o lo visto aquí.
    // (Los dudosos cuentan para saber si es un álbum, igual que en la fase 2.)
    const enCache = cacheFichas.get(ficha);
    const ficheros = enCache?.detalles?.length
      ? enCache.detalles.map(d => d.url)
      : [...(ficherosPorFicha.get(ficha) || [])];
    const porFichero = extractFileDurations(doc, ficha);
    const unico = ficheros.length === 1 ? extractDurationSeconds(doc) : null;
    const items = [];
    for (const url of ficherosPorFicha.get(ficha) || []) {
      if (dudosos.has(url)) continue;
      const segundos = porFichero.get(url) ?? (ficheros.length === 1 ? unico : null);
      if (!Number.isFinite(segundos) || segundos <= 0) continue;
      items.push({
        url,
        sourceUrl: ficha,
        durationSeconds: segundos,
        duration: formatDuration(segundos),
      });
      cacheFichas.completarDuracion(ficha, url, segundos, formatDuration(segundos));
    }
    if (items.length > 0) publicar({ type: 'duracion', items });
  }

  function siguiente() {
    while (enVuelo < config.duraciones.aLaVez && pendientes.length > 0) {
      if (signal?.aborted) {
        pendientes.length = 0;
        break;
      }
      const ficha = pendientes.shift();
      enVuelo += 1;
      completar(ficha)
        .catch(error => logger.debug(`Duración de ${ficha}: ${error.message}`))
        .finally(() => {
          enVuelo -= 1;
          siguiente();
          avisarSiAcabo();
        });
    }
    avisarSiAcabo();
  }

  function anotar(items) {
    for (const it of items || []) {
      if (!it?.sourceUrl) continue;
      if (!ficherosPorFicha.has(it.sourceUrl)) ficherosPorFicha.set(it.sourceUrl, new Set());
      ficherosPorFicha.get(it.sourceUrl).add(it.url);
      if (it.suspect) dudosos.add(it.url);
      if (!leFalta(it) || fichasVistas.has(it.sourceUrl)) continue;
      if (lanzadas >= config.duraciones.maxPorBusqueda) continue;
      fichasVistas.add(it.sourceUrl);
      lanzadas += 1;
      pendientes.push(it.sourceUrl);
    }
    siguiente();
  }

  /** Espera a lo pendiente, como mucho `maxMs`. Nunca falla. */
  function esperar(maxMs = config.duraciones.esperaFinalMs) {
    if (pendientes.length === 0 && enVuelo === 0) return Promise.resolve();
    return new Promise(resolver => {
      const tope = setTimeout(resolver, maxMs);
      tope.unref?.();
      alTerminar.push(() => {
        clearTimeout(tope);
        resolver();
      });
    });
  }

  return {
    anotar,
    esperar,
    get lanzadas() {
      return lanzadas;
    },
  };
}

module.exports = { crear, leFalta };
