'use strict';

const config = require('../config');

/**
 * Caché de fichas: lo que la fase 2 sacó de una ficha (sus ficheros, ya clasificados por
 * relevancia, con duración, título y miniatura) guardado un rato EN MEMORIA y compartido entre
 * búsquedas.
 *
 * Por qué: dos búsquedas parecidas («ana perez» y «ana pérez playa») abren casi las mismas fichas,
 * y abrir cada una con navegador cuesta segundos y una visita más al sitio. Con esto la segunda
 * no vuelve a abrir lo que la primera ya abrió.
 *
 * Lo que se guarda es lo que ya pasó por las reglas de relevancia: un fichero dudoso se guarda SIN
 * duración, igual que salió. Nada de volver a estampar la de la ficha al leer de aquí.
 *
 * En memoria a propósito, como las miniaturas: muere con el proceso y no deja rastro en disco.
 * LRU con tope de entradas y caducidad (`CACHE_FICHAS_TTL_MS`, unas 6 h por defecto): las URLs de
 * fichero de muchos sitios llevan un token que caduca, y para mandar a JDownloader se vuelve a
 * resolver la ficha fresca (ver services/jdownloader.js).
 */

/** @type {Map<string, {guardadaEn: number, clave: string, datos: object}>} */
const entradas = new Map();

/** Lo que cambia el resultado de extraer una ficha: qué extensiones y si con miniaturas. */
function claveDe({ extensions = [], withThumbnails = false } = {}) {
  return `${[...extensions].sort().join(',')}|${withThumbnails ? 1 : 0}`;
}

function vigente(e) {
  return e && Date.now() - e.guardadaEn < config.cacheFichas.ttlMs;
}

/** Lo guardado de esa ficha para esas opciones (o null). */
function get(url, opciones) {
  if (config.cacheFichas.maxEntradas <= 0) return null;
  const e = entradas.get(url);
  if (!vigente(e) || (opciones && e.clave !== claveDe(opciones))) {
    if (e && !vigente(e)) entradas.delete(url);
    return null;
  }
  // LRU: lo usado vuelve al final, así se desaloja lo más viejo
  entradas.delete(url);
  entradas.set(url, e);
  return { ...e.datos, guardadaEn: e.guardadaEn };
}

function set(url, opciones, datos) {
  if (config.cacheFichas.maxEntradas <= 0) return;
  entradas.delete(url);
  entradas.set(url, { guardadaEn: Date.now(), clave: claveDe(opciones), datos });
  while (entradas.size > config.cacheFichas.maxEntradas) {
    entradas.delete(entradas.keys().next().value);
  }
}

/**
 * Completa la duración de un fichero de una ficha ya guardada (la trae después la petición ligera
 * de services/duraciones.js). No toca la fecha de guardado: el dato nuevo no hace más fresca la
 * URL del fichero.
 */
function completarDuracion(url, ficheroUrl, durationSeconds, duration) {
  const e = entradas.get(url);
  if (!vigente(e)) return;
  for (const d of e.datos.detalles || []) {
    if (d.url === ficheroUrl && !d.suspect && !Number.isFinite(d.durationSeconds)) {
      d.durationSeconds = durationSeconds;
      d.duration = duration;
    }
  }
}

function vaciar() {
  entradas.clear();
}

module.exports = {
  get,
  set,
  completarDuracion,
  vaciar,
  claveDe,
  get tamano() {
    return entradas.size;
  },
};
