'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { buscarEnTodos, buscarEnlace } = require('./busqueda');
const filtrosGlobales = require('./filtrosGlobales');
const duraciones = require('./duraciones');
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
 *
 * Y sobreviven a un reinicio (data/busquedas.json, fuera de git como el resto de data/): las que
 * estaban en marcha o en cola se retoman solas al arrancar, solo en los sitios que no habían
 * terminado y con los eventos ya emitidos conservados (mismo `seq`), así que quien vuelve a
 * mirar no nota el corte. Las terminadas siguen visibles hasta su tope de conservación. El
 * fichero lleva lo que se buscó y lo encontrado: se guarda junto a los perfiles, que ya llevan
 * los nombres de los sitios, y se va vaciando solo a medida que caducan las búsquedas.
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
      marcarCambio();
    }
  }
}
setInterval(purgar, 60_000).unref?.();

/* ── Persistencia ──────────────────────────────────────────────────── */

const fichero = () => path.join(config.datos.dir, 'busquedas.json');
let sucio = false;
let relojGuardado = null;
let guardando = Promise.resolve();
// Al apagar se guarda una foto con lo que estaba en marcha y se deja de escribir: lo que pase
// después (el navegador se cierra y las búsquedas fallan) no debe quedar como «terminada».
let congelado = false;

function foto() {
  return {
    version: 1,
    guardadoEn: new Date().toISOString(),
    ultima,
    cola: [...cola],
    busquedas: [...busquedas.values()].map(b => ({
      id: b.id,
      entrada: b.entrada,
      q: b.q,
      terminoRelevancia: b.terminoRelevancia,
      carpeta: b.carpeta,
      origen: b.origen,
      estado: b.estado,
      quitada: b.quitada === true,
      creadaEn: b.creadaEn,
      empezadaEn: b.empezadaEn,
      terminadaEn: b.terminadaEn,
      eventos: b.eventos,
    })),
  };
}

/** Marca cambios; se escriben como mucho cada `persistirMs` (en segundo plano). */
function marcarCambio() {
  if (congelado) return;
  sucio = true;
  if (relojGuardado) return;
  relojGuardado = setTimeout(() => {
    relojGuardado = null;
    guardarAhora().catch(error =>
      logger.warn(`No se pudieron guardar las búsquedas: ${error.message}`)
    );
  }, config.busqueda.persistirMs);
  relojGuardado.unref?.();
}

/** Escribe ya (temporal + rename: un corte a medias no deja un JSON roto). */
function guardarAhora() {
  guardando = guardando.then(async () => {
    if (!sucio || congelado) return;
    sucio = false;
    const destino = fichero();
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    const temporal = `${destino}.tmp`;
    await fs.promises.writeFile(temporal, JSON.stringify(foto()), 'utf8');
    await fs.promises.rename(temporal, destino);
  });
  return guardando;
}

/**
 * Para el apagado (SIGTERM): guarda en el acto, de forma síncrona, y deja de escribir. Las que
 * estaban en marcha quedan como «en curso» en el fichero, que es lo que hace que se retomen.
 */
function guardarAlApagar() {
  if (congelado) return;
  clearTimeout(relojGuardado);
  const destino = fichero();
  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(`${destino}.tmp`, JSON.stringify(foto()), 'utf8');
    fs.renameSync(`${destino}.tmp`, destino);
  } catch (error) {
    logger.warn(`No se pudieron guardar las búsquedas al apagar: ${error.message}`);
  }
  congelado = true;
}

/**
 * Qué falta de una búsqueda que se cortó: la misma entrada, pero solo con los sitios (o enlaces)
 * que no llegaron a terminar. Pura, para poder probarla.
 */
function entradaPendiente(entrada, eventos) {
  const anunciados = eventos.filter(e => e.type === 'sitios').flatMap(e => e.sitios.map(x => x.id));
  // Sin la lista de sitios no había empezado de verdad: se repite entera.
  if (anunciados.length === 0) return entrada;
  const hechos = new Set(eventos.filter(e => e.type === 'sitio_fin').map(e => e.sitio));
  const faltan = [...new Set(anunciados)].filter(id => !hechos.has(id));
  if (entrada.url) {
    const urls = entrada.urls && entrada.urls.length ? entrada.urls : [entrada.url];
    const indices = faltan.filter(id => id <= -2).map(id => -2 - id);
    const pendientes = indices.map(i => urls[i]).filter(Boolean);
    return { ...entrada, url: pendientes[0] || entrada.url, urls: pendientes, indices };
  }
  return {
    ...entrada,
    sitios: faltan.filter(id => id >= 0),
    abierta: Boolean(entrada.abierta) && faltan.includes(-1),
  };
}

/**
 * Al arrancar: lo guardado vuelve a memoria. Las terminadas, tal cual (si no han caducado); las
 * que estaban en marcha vuelven las PRIMERAS de la cola (con lo que les faltaba), y las que
 * esperaban, detrás y en su orden.
 */
async function restaurar() {
  let datos;
  try {
    datos = JSON.parse(await fs.promises.readFile(fichero(), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`busquedas.json ilegible, se ignora: ${error.message}`);
    }
    return { retomadas: 0, terminadas: 0 };
  }
  const ahora = Date.now();
  const enMarcha = [];
  const esperando = [];
  let terminadas = 0;
  for (const g of datos.busquedas || []) {
    if (!g?.id || !g.entrada || busquedas.has(g.id)) continue;
    if (g.terminadaEn && ahora - g.terminadaEn > config.busqueda.fondoConservarMs) continue;
    const b = {
      ...g,
      eventos: Array.isArray(g.eventos) ? g.eventos : [],
      oyentes: new Set(),
      controller: new AbortController(),
    };
    busquedas.set(b.id, b);
    if (b.estado === 'fin') {
      terminadas += 1;
      continue;
    }
    if (b.estado === 'curso') {
      b.reanudar = true;
      enMarcha.push(b.id);
    } else esperando.push(b.id);
    b.estado = 'cola';
  }
  const ordenCola = new Map((datos.cola || []).map((id, i) => [id, i]));
  esperando.sort((a, b) => (ordenCola.get(a) ?? 1e9) - (ordenCola.get(b) ?? 1e9));
  cola.unshift(...enMarcha, ...esperando);
  if (datos.ultima && busquedas.has(datos.ultima)) ultima = datos.ultima;
  if (enMarcha.length + esperando.length > 0) {
    logger.info(
      `Búsquedas retomadas tras el reinicio: ${enMarcha.length} en marcha, ${esperando.length} en cola`
    );
  }
  despachar();
  return { retomadas: enMarcha.length + esperando.length, terminadas };
}

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
  marcarCambio();
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
  marcarCambio();
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
  let entrada = b.entrada;
  let itemsPrevios = [];
  if (b.reanudar) {
    // Tras un reinicio: solo lo que faltaba, y lo ya encontrado entra en la agrupación final.
    b.reanudar = false;
    entrada = entradaPendiente(b.entrada, b.eventos);
    itemsPrevios = b.eventos.filter(e => e.type === 'resultados').flatMap(e => e.items || []);
    publicar(b, { type: 'reanudada' });
  } else publicar(b, { type: 'inicio' });
  marcarCambio();
  // Un sitio que se cortó a medias se recorre de nuevo desde el principio: lo que ya se había
  // encontrado en él no se vuelve a mandar (saldría repetido en la pantalla).
  const yaVistos = new Set(itemsPrevios.map(it => it.url));
  // Lo que llega sin duración se completa después con una petición ligera (evento `duracion`).
  const completador = duraciones.crear({ signal, publicar: evento => publicar(b, evento) });
  const emitir = evento => {
    if (evento.type === 'resultados' && yaVistos.size > 0) {
      const nuevos = (evento.items || []).filter(it => !yaVistos.has(it.url));
      if (nuevos.length === 0) return;
      evento = { ...evento, items: nuevos };
    }
    publicar(b, evento);
    if (evento.type === 'resultados') completador.anotar(evento.items);
  };
  const buscar = entrada.url ? buscarEnlace : buscarEnTodos;
  buscar(entrada, { signal, emit: emitir, itemsPrevios })
    .then(async r => {
      // Las duraciones en vuelo llegan ANTES del fin: quien mira cierra el stream con el `fin`.
      if (!signal.aborted) await completador.esperar();
      publicar(b, { type: 'fin', ...r, cancelada: signal.aborted });
    })
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
  marcarCambio();
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

module.exports = {
  iniciar,
  suscribir,
  parar,
  actual,
  lista,
  marcar,
  restaurar,
  guardarAhora,
  guardarAlApagar,
  entradaPendiente,
};
