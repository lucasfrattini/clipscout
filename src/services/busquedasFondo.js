'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const logger = require('../lib/logger');
const { buscarEnTodos, buscarEnlace } = require('./busqueda');
const filtrosGlobales = require('./filtrosGlobales');
const { idiomaProbable, bloqueadaPor, relevancia } = require('../lib/filtros');

/**
 * Búsquedas que siguen aunque nadie mire, con COLA.
 *
 * Antes la búsqueda vivía dentro de la conexión SSE: cambiar de pantalla, o que el móvil mandara
 * la pestaña al fondo, cerraba la conexión y con ella se abortaba todo. Ahora la búsqueda es un
 * trabajo del servidor con su propio límite de tiempo; la página solo se SUSCRIBE a sus eventos.
 * Se guardan todos, numerados, así que al volver se reengancha desde el último que vio (o desde
 * el principio, si la página se recargó) y no se pierde nada.
 *
 * Con `fondoMaxActivas` en marcha, la siguiente ya no da 409: queda EN COLA y arranca sola en
 * cuanto se libera un hueco, en el orden en que llegó. Las búsquedas programadas pasan por la
 * misma cola, así que una programada nunca se pierde por coincidir con una búsqueda a mano.
 */

/** @type {Map<string, object>} */
const busquedas = new Map();
/** Ids en espera, en orden de llegada. */
const cola = [];
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

const enCurso = () => [...busquedas.values()].filter(b => b.estado === 'curso').length;

/**
 * Marcas de cada resultado que la pantalla usa para filtrar: idioma probable y palabra bloqueada.
 * Se calculan aquí, una vez, para que Buscar, las programadas y quien se reenganche vean lo mismo.
 * Nada se quita: un resultado bloqueado llega marcado y la pantalla lo cuenta.
 */
function marcar(items, q = '') {
  const prohibidas = filtrosGlobales.bloqueadas();
  return (items || []).map(it => {
    const bloqueada = bloqueadaPor(it, prohibidas);
    // La relevancia solo tiene sentido buscando por palabras: con un enlace pegado no hay término.
    const r = q ? relevancia(it, q) : null;
    return {
      ...it,
      idioma: idiomaProbable(it),
      ...(bloqueada ? { bloqueada } : {}),
      ...(r && r.relevancia !== null ? r : {}),
    };
  });
}

function publicar(b, eventoOriginal) {
  const evento =
    eventoOriginal.type === 'resultados'
      ? { ...eventoOriginal, items: marcar(eventoOriginal.items, b.terminoRelevancia) }
      : eventoOriginal;
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

function cerrar(b) {
  b.estado = 'fin';
  b.terminadaEn = Date.now();
  b.oyentes.clear();
}

/** Arranca la búsqueda `b` (que estaba en cola). */
function arrancar(b) {
  b.estado = 'curso';
  b.empezadaEn = Date.now();
  // Toda búsqueda termina sola, la mire alguien o no. El tope cuenta desde que ARRANCA, no
  // desde que se encoló: si no, una búsqueda que esperó su turno saldría ya medio caducada.
  const signal = AbortSignal.any([
    b.controller.signal,
    AbortSignal.timeout(config.busqueda.fondoMaxMs),
  ]);
  publicar(b, { type: 'inicio' });
  const buscar = b.entrada.url ? buscarEnlace : buscarEnTodos;
  buscar(b.entrada, { signal, emit: evento => publicar(b, evento) })
    .then(r => publicar(b, { type: 'fin', ...r, cancelada: signal.aborted }))
    .catch(error => {
      logger.warn(`Error en la búsqueda: ${error.message}`);
      publicar(b, { type: 'error', message: error.message });
    })
    .finally(() => {
      cerrar(b);
      despachar();
    });
}

/** Arranca las que quepan, por orden de llegada. */
function despachar() {
  while (cola.length > 0 && enCurso() < config.busqueda.fondoMaxActivas) {
    const b = busquedas.get(cola.shift());
    if (b && b.estado === 'cola') arrancar(b);
  }
}

/**
 * Pone una búsqueda en la cola (y la arranca ya si hay hueco). Devuelve su id.
 * `carpeta`: destino propuesto para descargar lo que encuentre (la pantalla lo fija al mirarla).
 */
function iniciar(entrada, { carpeta = '', origen = 'manual' } = {}) {
  purgar();
  if (cola.length >= config.busqueda.fondoMaxEnCola) {
    const error = new Error(
      `Ya hay ${cola.length} búsquedas esperando: quita alguna de la cola o espera a que avancen.`
    );
    error.status = 409;
    throw error;
  }
  const id = crypto.randomUUID();
  const b = {
    id,
    entrada,
    q: entrada.urls ? entrada.urls.join(' ') : entrada.url || entrada.q,
    terminoRelevancia: entrada.url ? '' : entrada.q || '',
    carpeta: String(carpeta || '').slice(0, 200),
    origen,
    estado: 'cola',
    creadaEn: Date.now(),
    empezadaEn: null,
    terminadaEn: null,
    eventos: [],
    oyentes: new Set(),
    controller: new AbortController(),
  };
  busquedas.set(id, b);
  if (origen === 'manual') ultima = id;
  cola.push(id);
  publicar(b, { type: 'en_cola', posicion: cola.length });
  despachar();
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

/** Para una búsqueda en marcha, o la saca de la cola si aún esperaba. */
function parar(id) {
  const b = busquedas.get(id);
  if (!b) return false;
  if (b.estado === 'cola') {
    const i = cola.indexOf(id);
    if (i >= 0) cola.splice(i, 1);
    publicar(b, { type: 'fin', sitios: [], total: 0, cancelada: true, quitada: true });
    b.quitada = true;
    cerrar(b);
    return true;
  }
  b.controller.abort();
  return true;
}

/** La cola y lo reciente, para la pantalla: en marcha, esperando (con su puesto) y terminadas. */
function lista() {
  purgar();
  const orden = { curso: 0, cola: 1, fin: 2 };
  return [...busquedas.values()]
    .map(b => ({
      id: b.id,
      q: b.q,
      carpeta: b.carpeta,
      origen: b.origen,
      estado: b.estado,
      quitada: b.quitada === true,
      posicion: b.estado === 'cola' ? cola.indexOf(b.id) + 1 : null,
      creadaEn: b.creadaEn,
      terminadaEn: b.terminadaEn,
      total: b.eventos
        .filter(e => e.type === 'resultados')
        .reduce((n, e) => n + (e.items?.length || 0), 0),
    }))
    .sort(
      (a, b) =>
        orden[a.estado] - orden[b.estado] ||
        (a.estado === 'cola' ? a.posicion - b.posicion : b.creadaEn - a.creadaEn)
    );
}

/** La última búsqueda lanzada a mano (para reengancharse desde otro dispositivo o tras recargar). */
function actual() {
  const b = ultima ? busquedas.get(ultima) : null;
  return b
    ? { id: b.id, q: b.q, carpeta: b.carpeta, estado: b.estado, terminada: Boolean(b.terminadaEn) }
    : null;
}

module.exports = { iniciar, suscribir, parar, actual, lista, marcar };
