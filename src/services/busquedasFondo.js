'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const logger = require('../lib/logger');
const { buscarEnTodos, buscarEnlace } = require('./busqueda');

/**
 * Búsquedas que siguen aunque nadie mire.
 *
 * Antes la búsqueda vivía dentro de la conexión SSE: cambiar de pantalla, o que el móvil mandara
 * la pestaña al fondo, cerraba la conexión y con ella se abortaba todo. Ahora la búsqueda es un
 * trabajo del servidor con su propio límite de tiempo; la página solo se SUSCRIBE a sus eventos.
 * Se guardan todos, numerados, así que al volver se reengancha desde el último que vio (o desde
 * el principio, si la página se recargó) y no se pierde nada.
 *
 * En memoria, como el resto del estado de la app: si el proceso se reinicia, se pierde.
 */

/** @type {Map<string, object>} */
const busquedas = new Map();
let ultima = null;

function purgar() {
  const ahora = Date.now();
  for (const [id, b] of busquedas) {
    if (b.terminadaEn && ahora - b.terminadaEn > config.busqueda.fondoConservarMs) {
      busquedas.delete(id);
    }
  }
}
setInterval(purgar, 60_000).unref?.();

const activas = () => [...busquedas.values()].filter(b => !b.terminadaEn).length;

function publicar(b, evento) {
  const conNumero = { ...evento, seq: b.eventos.length };
  b.eventos.push(conNumero);
  for (const oyente of b.oyentes) {
    try {
      oyente(conNumero);
    } catch {
      // un oyente roto (conexión que se cerró a medias) no corta la búsqueda
    }
  }
}

/** Arranca una búsqueda en segundo plano y devuelve su id. */
function iniciar(entrada) {
  purgar();
  if (activas() >= config.busqueda.fondoMaxActivas) {
    const error = new Error('Ya hay búsquedas en marcha: espera a que terminen o páralas.');
    error.status = 409;
    throw error;
  }
  const id = crypto.randomUUID();
  const controller = new AbortController();
  // Toda búsqueda termina sola, la mire alguien o no.
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(config.busqueda.fondoMaxMs),
  ]);
  const b = {
    id,
    q: entrada.urls ? entrada.urls.join(' ') : entrada.url || entrada.q,
    creadaEn: Date.now(),
    terminadaEn: null,
    eventos: [],
    oyentes: new Set(),
    controller,
  };
  busquedas.set(id, b);
  ultima = id;

  // Un enlace pegado se analiza él solo; un nombre o una palabra, en todos los sitios.
  const buscar = entrada.url ? buscarEnlace : buscarEnTodos;
  buscar(entrada, { signal, emit: evento => publicar(b, evento) })
    .then(r => publicar(b, { type: 'fin', ...r, cancelada: signal.aborted }))
    .catch(error => {
      logger.warn(`Error en la búsqueda: ${error.message}`);
      publicar(b, { type: 'error', message: error.message });
    })
    .finally(() => {
      b.terminadaEn = Date.now();
      b.oyentes.clear();
    });
  return id;
}

/**
 * Manda a `oyente` los eventos desde `desde` (los ya ocurridos, de golpe) y después los nuevos.
 * Devuelve la función para darse de baja, o null si la búsqueda no existe.
 */
function suscribir(id, desde, oyente) {
  const b = busquedas.get(id);
  if (!b) return null;
  for (const e of b.eventos.slice(Math.max(0, desde))) oyente(e);
  if (b.terminadaEn) return () => {};
  b.oyentes.add(oyente);
  return () => b.oyentes.delete(oyente);
}

function parar(id) {
  const b = busquedas.get(id);
  if (!b) return false;
  b.controller.abort();
  return true;
}

/** La última búsqueda lanzada (para reengancharse desde otro dispositivo o tras recargar). */
function actual() {
  const b = ultima ? busquedas.get(ultima) : null;
  return b ? { id: b.id, q: b.q, terminada: Boolean(b.terminadaEn) } : null;
}

module.exports = { iniciar, suscribir, parar, actual };
