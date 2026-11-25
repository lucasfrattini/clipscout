'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { escribirTexto, escribirTextoSync } = require('../lib/ficheroJson');
const { buscarEnTodos, buscarEnlace, clavesDeIds } = require('./busqueda');
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
 * Y sobreviven a un reinicio (data/busquedas.json + data/busquedas/<id>.jsonl, ver
 * «Persistencia»; fuera de git como el resto de data/): las que
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
      pendientes.delete(id);
      porBorrar.add(id);
      marcarCambio();
    }
  }
}
setInterval(purgar, 60_000).unref?.();

/* ── Persistencia ──────────────────────────────────────────────────── */

/*
 * CS-01. Antes (formato 1) se reescribía `busquedas.json` ENTERO cada 3 s mientras había
 * búsquedas: todas las de la última hora con todos sus resultados (varios MB cada vez, decenas
 * de MB por minuto y una pausa del servidor que crecía con lo encontrado). Ahora (formato 2):
 *
 * - `busquedas.json` es solo el ÍNDICE: qué búsquedas hay, su estado y la cola (unos pocos KB).
 *   Se reescribe (temporal + rename) solo cuando cambia algo de eso, no con cada resultado.
 * - Los eventos de cada búsqueda (lo encontrado incluido) van a `busquedas/<id>.jsonl`, una línea
 *   por evento, y se AÑADEN al final por tandas: cada resultado se escribe una sola vez.
 * - Al arrancar se leen las líneas; una última línea cortada (apagón a mitad de escritura) se
 *   descarta y el fichero se reescribe limpio antes de seguir añadiendo.
 * - El formato 1 se migra solo al arrancar (sin perder la cola ni lo ya encontrado).
 */
const fichero = () => path.join(config.datos.dir, 'busquedas.json');
const carpetaEventos = () => path.join(config.datos.dir, 'busquedas');
/** Nombre de fichero seguro para un id (los nuevos son UUID; uno raro se resume). */
const nombreEventos = id =>
  /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? `${id}.jsonl`
    : `${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32)}.jsonl`;
const ficheroEventos = id => path.join(carpetaEventos(), nombreEventos(id));
const MODO = 0o600;

let indiceSucio = false;
/** id → líneas de eventos aún sin escribir (en orden). */
const pendientes = new Map();
/** Eventos que un guardado asíncrono sacó de `pendientes` y aún no escribió (id → líneas). */
const enVuelo = new Map();
/** Búsquedas caducadas cuyo fichero de eventos hay que borrar. */
const porBorrar = new Set();
let relojGuardado = null;
let guardando = Promise.resolve();
// Al apagar se guarda lo pendiente y se deja de escribir: lo que pase después (el navegador se
// cierra y las búsquedas fallan) no debe quedar como «terminada».
let congelado = false;

/** El índice (formato 2): todo menos los eventos. */
function foto() {
  return {
    version: 2,
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
      // Retomada que aún espera hueco: si se reinicia otra vez antes de arrancar, sigue siendo
      // una búsqueda a medias (sin esto volvía a empezar de cero y repetía lo ya encontrado).
      ...(b.reanudar ? { reanudar: true } : {}),
      creadaEn: b.creadaEn,
      empezadaEn: b.empezadaEn,
      terminadaEn: b.terminadaEn,
      eventos: b.eventos.length,
    })),
  };
}

function programarGuardado() {
  if (congelado || relojGuardado) return;
  relojGuardado = setTimeout(() => {
    relojGuardado = null;
    guardarAhora().catch(error =>
      logger.warn(`No se pudieron guardar las búsquedas: ${error.message}`)
    );
  }, config.busqueda.persistirMs);
  relojGuardado.unref?.();
}

/** Cambió el índice (estado, cola, alta o baja de una búsqueda). */
function marcarCambio() {
  if (congelado) return;
  indiceSucio = true;
  programarGuardado();
}

/** Un evento nuevo: solo se añade su línea (el índice no cambia por cada resultado). */
function anotarEvento(b, evento) {
  if (congelado) return;
  const lineas = pendientes.get(b.id) || [];
  lineas.push(`${JSON.stringify(evento)}\n`);
  pendientes.set(b.id, lineas);
  programarGuardado();
}

/** Escribe lo pendiente: primero los eventos (añadiendo) y luego el índice si cambió. */
function guardarAhora() {
  guardando = guardando.then(async () => {
    if (congelado) return;
    const lote = [...pendientes];
    pendientes.clear();
    // En vuelo hasta escribirse: si llega el apagado entremedias, `guardarAlApagar` los escribe él.
    for (const [id, lineas] of lote) enVuelo.set(id, [...(enVuelo.get(id) || []), ...lineas]);
    if (lote.length) {
      await fs.promises.mkdir(carpetaEventos(), { recursive: true, mode: 0o700 });
    }
    for (const [id] of lote) {
      if (congelado) return; // el apagado ya lo escribió todo
      const lineas = enVuelo.get(id);
      enVuelo.delete(id);
      if (!lineas || !busquedas.has(id)) continue; // caducó mientras esperaba
      await fs.promises.appendFile(ficheroEventos(id), lineas.join(''), {
        encoding: 'utf8',
        mode: MODO,
      });
    }
    if (indiceSucio) {
      indiceSucio = false;
      await escribirTexto(fichero(), JSON.stringify(foto()));
    }
    for (const id of [...porBorrar]) {
      porBorrar.delete(id);
      await fs.promises.rm(ficheroEventos(id), { force: true }).catch(() => {});
    }
  });
  return guardando;
}

/**
 * Para el apagado (SIGTERM): guarda en el acto, de forma síncrona, y deja de escribir. Las que
 * estaban en marcha quedan como «en curso» en el índice, que es lo que hace que se retomen.
 */
function guardarAlApagar() {
  if (congelado) return;
  clearTimeout(relojGuardado);
  try {
    // Primero lo que un guardado asíncrono tenía en vuelo (va antes en el orden), luego lo pendiente.
    const todo = new Map(enVuelo);
    for (const [id, lineas] of pendientes) todo.set(id, [...(todo.get(id) || []), ...lineas]);
    if (todo.size) fs.mkdirSync(carpetaEventos(), { recursive: true, mode: 0o700 });
    for (const [id, lineas] of todo) {
      if (busquedas.has(id)) {
        fs.appendFileSync(ficheroEventos(id), lineas.join(''), { encoding: 'utf8', mode: MODO });
      }
    }
    enVuelo.clear();
    pendientes.clear();
    escribirTextoSync(fichero(), JSON.stringify(foto()));
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
  // CS-07: la clave estable de cada sitio anunciado (desde 2.22): con ella se retoman los mismos
  // sitios aunque entretanto se hayan borrado o reordenado otros.
  const claveDe = new Map(
    eventos
      .filter(e => e.type === 'sitios')
      .flatMap(e => e.sitios)
      .filter(x => x.clave)
      .map(x => [x.id, x.clave])
  );
  if (entrada.url) {
    const urls = entrada.urls && entrada.urls.length ? entrada.urls : [entrada.url];
    const indices = faltan.filter(id => id <= -2).map(id => -2 - id);
    const pendientesUrls = indices.map(i => urls[i]).filter(Boolean);
    return { ...entrada, url: pendientesUrls[0] || entrada.url, urls: pendientesUrls, indices };
  }
  const sitios = faltan.filter(id => id >= 0);
  const claves = sitios.map(id => claveDe.get(id));
  const retomar = fichasPendientes(eventos, claves.filter(Boolean));
  return {
    ...entrada,
    sitios,
    ...(claves.every(Boolean) ? { claves } : {}),
    ...(retomar ? { retomar } : {}),
    abierta: Boolean(entrada.abierta) && faltan.includes(-1),
  };
}

/**
 * CS-09: de cada sitio a medias (por su clave estable), las fichas que faltaban: la lista que dio
 * su listado (`sitio_enlaces`) menos las ya terminadas (`sitio_hechas`, de esta vuelta y de las
 * anteriores). Así se sigue por donde iba en vez de repetir sus páginas. null si no hay ninguno.
 */
function fichasPendientes(eventos, claves) {
  const retomar = {};
  for (const clave of claves) {
    const lista = eventos.findLast(e => e.type === 'sitio_enlaces' && e.clave === clave);
    if (!lista || !Array.isArray(lista.enlaces)) continue;
    const hechas = new Set(
      eventos.filter(e => e.type === 'sitio_hechas' && e.clave === clave).flatMap(e => e.urls)
    );
    retomar[clave] = lista.enlaces.filter(u => !hechas.has(u));
  }
  return Object.keys(retomar).length ? retomar : null;
}

/**
 * Eventos solo para retomar (CS-09): se guardan con la búsqueda pero no se mandan a quien mira.
 */
const INTERNOS = new Set(['sitio_enlaces', 'sitio_hechas']);
const esInterno = e => INTERNOS.has(e.type);

/**
 * Los eventos guardados de una búsqueda (formato 2). Una línea que no se entiende (la última,
 * cortada por un apagón) se descarta, y el fichero se reescribe sin ella para poder seguir
 * añadiendo detrás.
 */
async function leerEventos(id) {
  let texto;
  try {
    texto = await fs.promises.readFile(ficheroEventos(id), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn(`Eventos de la búsqueda ilegibles: ${error.message}`);
    return [];
  }
  const eventos = [];
  let malas = 0;
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try {
      eventos.push(JSON.parse(linea));
    } catch {
      malas += 1;
    }
  }
  if (malas > 0 || (texto && !texto.endsWith('\n'))) {
    await escribirTexto(ficheroEventos(id), eventos.map(e => `${JSON.stringify(e)}\n`).join(''));
  }
  return eventos;
}

/**
 * CS-02: un índice que no se puede leer no se ignora en silencio para pisarlo después: se aparta
 * como `busquedas.json.corrupto-<fecha>` (se arranca sin búsquedas guardadas).
 */
async function apartarIlegible(error) {
  const destino = `${fichero()}.corrupto-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    await fs.promises.rename(fichero(), destino);
    logger.warn(
      `busquedas.json ilegible (${error.message}): apartado como ${path.basename(destino)}`
    );
  } catch {
    logger.warn(`busquedas.json ilegible, se ignora: ${error.message}`);
  }
}

/** Borra los ficheros de eventos que ya no son de ninguna búsqueda. */
async function limpiarHuerfanos() {
  let nombres;
  try {
    nombres = await fs.promises.readdir(carpetaEventos());
  } catch {
    return;
  }
  const vivos = new Set([...busquedas.keys()].map(nombreEventos));
  for (const n of nombres) {
    if (!vivos.has(n)) await fs.promises.rm(path.join(carpetaEventos(), n), { force: true });
  }
}

/**
 * Al arrancar: lo guardado vuelve a memoria. Las terminadas, tal cual (si no han caducado); las
 * que estaban en marcha vuelven las PRIMERAS de la cola (con lo que les faltaba), y las que
 * esperaban, detrás y en su orden. Un fichero del formato 1 (hasta 2.21) se pasa al 2.
 */
let promesaRestaurar = Promise.resolve();
/** Se resuelve cuando ya se leyó lo guardado (para quien depende de ello, p. ej. programadas). */
const restaurado = () => promesaRestaurar.catch(() => {});

function restaurar() {
  promesaRestaurar = restaurarAhora();
  return promesaRestaurar;
}

async function restaurarAhora() {
  let datos;
  try {
    datos = JSON.parse(await fs.promises.readFile(fichero(), 'utf8'));
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
      throw new Error('no contiene un objeto JSON');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') await apartarIlegible(error);
    return { retomadas: 0, terminadas: 0 };
  }
  const formatoViejo = datos.version !== 2;
  const ahora = Date.now();
  const enMarcha = [];
  const esperando = [];
  let terminadas = 0;
  for (const g of datos.busquedas || []) {
    if (!g?.id || !g.entrada || busquedas.has(g.id)) continue;
    if (g.terminadaEn && ahora - g.terminadaEn > config.busqueda.fondoConservarMs) continue;
    const eventos = formatoViejo
      ? Array.isArray(g.eventos)
        ? g.eventos
        : []
      : await leerEventos(g.id);
    const b = {
      ...g,
      eventos,
      oyentes: new Set(),
      controller: new AbortController(),
    };
    busquedas.set(b.id, b);
    if (b.estado === 'fin') {
      terminadas += 1;
      continue;
    }
    if (b.estado === 'curso' || b.reanudar === true) {
      b.reanudar = true;
      enMarcha.push(b.id);
    } else esperando.push(b.id);
    b.estado = 'cola';
  }
  const ordenCola = new Map((datos.cola || []).map((id, i) => [id, i]));
  esperando.sort((a, b) => (ordenCola.get(a) ?? 1e9) - (ordenCola.get(b) ?? 1e9));
  cola.unshift(...enMarcha, ...esperando);
  if (datos.ultima && busquedas.has(datos.ultima)) ultima = datos.ultima;
  if (formatoViejo) await migrarAlFormato2();
  else await limpiarHuerfanos();
  if (enMarcha.length + esperando.length > 0) {
    logger.info(
      `Búsquedas retomadas tras el reinicio: ${enMarcha.length} en marcha, ${esperando.length} en cola`
    );
  }
  despachar();
  return { retomadas: enMarcha.length + esperando.length, terminadas };
}

/**
 * Del formato 1 (todo en busquedas.json) al 2: primero cada búsqueda a su `.jsonl` y después el
 * índice nuevo encima del viejo (rename atómico). Si se corta a medias, el viejo sigue entero y
 * se vuelve a migrar en el siguiente arranque.
 */
async function migrarAlFormato2() {
  await fs.promises.mkdir(carpetaEventos(), { recursive: true, mode: 0o700 });
  for (const b of busquedas.values()) {
    await escribirTexto(
      ficheroEventos(b.id),
      b.eventos.map(e => `${JSON.stringify(e)}\n`).join('')
    );
  }
  await escribirTexto(fichero(), JSON.stringify(foto()));
  logger.info(`busquedas.json pasado al formato 2 (${busquedas.size} búsquedas)`);
}

// Una parada cuyas peticiones aún se están cortando sigue ocupando su hueco.
const enCurso = () =>
  [...busquedas.values()].filter(b => b.estado === 'curso' || b.cortando).length;

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
  anotarEvento(b, conNumero);
  if (esInterno(conNumero)) return;
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
    if (b.parada) return; // parada: lo que aún llegue de peticiones a medio cortar no cuenta
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
      if (!b.parada) publicar(b, { type: 'fin', ...r, cancelada: signal.aborted });
    })
    .catch(error => {
      if (b.parada) return;
      logger.warn(`Error en la búsqueda: ${error.message}`);
      publicar(b, { type: 'error', message: error.message });
    })
    .finally(() => {
      const yaCerrada = Boolean(b.terminadaEn);
      if (!b.terminadaEn) cerrar(b);
      b.cortando = false;
      avisarSiFueLarga(b, yaCerrada);
      despachar();
    });
}

/**
 * CS-N5: una búsqueda a mano larga (se suele dejar de mirar) avisa al terminar, con cuántos
 * resultados. Las programadas avisan por su cuenta; una parada a mano, no.
 */
function avisarSiFueLarga(b, parada) {
  if (parada || b.parada || b.origen === 'programada' || !b.empezadaEn) return;
  if (Date.now() - b.empezadaEn < config.avisos.busquedaLargaMs) return;
  const total = b.eventos
    .filter(e => e.type === 'resultados')
    .reduce((n, e) => n + (e.items?.length || 0), 0);
  require('./avisos').anotar('busqueda_terminada', { q: b.q || '', total, id: b.id });
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
  // CS-07: los sitios elegidos por posición se guardan también por su clave estable: si la
  // búsqueda espera en la cola (o se retoma tras un reinicio) y entretanto se borra o se reordena
  // un sitio, sigue buscando en los mismos.
  if (Array.isArray(entrada.sitios) && !entrada.claves) {
    const claves = clavesDeIds(entrada.sitios);
    if (claves) entrada = { ...entrada, claves };
  }
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
 * CS-12: lo ya ocurrido de una búsqueda, RESUMIDO, para quien la abre desde el principio («Ver»,
 * recargar). Antes se le mandaban todos los eventos tal cual: cada progreso de cada ficha, cada
 * tanda de duraciones y cada agrupación de repetidos, varios MB por el móvil cada vez. El
 * resumen deja lo que la pantalla necesita para quedar igual: los sitios, el último estado de
 * cada uno, UN `resultados` por sitio (con las duraciones que llegaron después ya puestas), la
 * agrupación de repetidos al día y el fin. Ningún evento del resumen lleva `seq`; al final va
 * `{type: 'resumen', seq}` con el número del último evento resumido, para seguir desde ahí.
 * Pura, para poder probarla.
 */
const sinSeq = e => {
  const copia = { ...e };
  delete copia.seq;
  return copia;
};

function resumirEventos(eventos) {
  if (eventos.length === 0) return [];
  const salida = [];
  const ultimoDe = tipo => eventos.findLast(e => e.type === tipo);
  const arranque = eventos.findLast(e => e.type === 'inicio' || e.type === 'reanudada');
  if (arranque) salida.push({ type: arranque.type });
  else if (ultimoDe('en_cola')) {
    salida.push({ type: 'en_cola', posicion: ultimoDe('en_cola').posicion });
  }

  const sitios = new Map();
  for (const e of eventos.filter(x => x.type === 'sitios')) {
    for (const s of e.sitios || []) sitios.set(s.id, { ...sitios.get(s.id), ...s });
  }
  if (sitios.size) salida.push({ type: 'sitios', sitios: [...sitios.values()] });

  const duracion = new Map();
  for (const e of eventos.filter(x => x.type === 'duracion')) {
    for (const d of e.items || []) duracion.set(d.url, d);
  }
  const porSitio = new Map(); // id → { inicio, progreso, items, fin }
  const de = id => {
    if (!porSitio.has(id)) {
      porSitio.set(id, { inicio: false, progreso: null, items: [], fin: null });
    }
    return porSitio.get(id);
  };
  for (const e of eventos) {
    if (e.type === 'sitio_inicio') de(e.sitio).inicio = true;
    else if (e.type === 'sitio_progreso') {
      const p = de(e.sitio);
      p.progreso = { ...p.progreso, ...sinSeq(e) };
    } else if (e.type === 'resultados') {
      for (const it of e.items || []) {
        const d = duracion.get(it.url);
        de(e.sitio).items.push(
          d && !Number.isFinite(it.durationSeconds)
            ? { ...it, durationSeconds: d.durationSeconds, duration: d.duration }
            : it
        );
      }
    } else if (e.type === 'sitio_fin') {
      de(e.sitio).fin = sinSeq(e);
    }
  }
  for (const [id, p] of porSitio) {
    if (p.inicio) salida.push({ type: 'sitio_inicio', sitio: id });
    if (p.progreso && !p.fin) salida.push(p.progreso);
    if (p.items.length) salida.push({ type: 'resultados', sitio: id, items: p.items });
    if (p.fin) salida.push(p.fin);
  }

  for (const e of eventos.filter(x => x.type === 'listado_disponible')) salida.push(sinSeq(e));
  for (const tipo of ['sitios_sugeridos', 'proxy_caido']) {
    const e = ultimoDe(tipo);
    if (e) salida.push(sinSeq(e));
  }
  // Repetidos: la última agrupación completa más lo que añadieron las parciales posteriores.
  const grupoDe = new Map();
  let hayGrupos = false;
  for (const e of eventos.filter(x => x.type === 'duplicados')) {
    hayGrupos = true;
    if (!e.parcial) grupoDe.clear();
    for (const g of e.grupos || []) for (const u of g.miembros) grupoDe.set(u, g);
  }
  if (hayGrupos) salida.push({ type: 'duplicados', grupos: [...new Set(grupoDe.values())] });

  const ultimo = eventos.at(-1);
  salida.push({ type: 'resumen', seq: ultimo.seq });
  const final = eventos.findLast(e => e.type === 'fin' || e.type === 'error');
  if (final) salida.push(sinSeq(final));
  return salida;
}

/**
 * Manda a `oyente` los eventos desde `desde` (los ya ocurridos, de golpe) y después los nuevos.
 * Con `resumen` y desde 0, lo ya ocurrido va resumido (CS-12, ver `resumirEventos`).
 * Devuelve la función para darse de baja, o null si la búsqueda no existe.
 */
function suscribir(id, desde, oyente, { resumen = false } = {}) {
  const b = busquedas.get(id);
  if (!b) return null;
  if (resumen && desde <= 0) for (const e of resumirEventos(b.eventos)) oyente(e);
  else for (const e of b.eventos.slice(Math.max(0, desde))) if (!esInterno(e)) oyente(e);
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
  if (b.estado !== 'curso' || b.parada) return true;
  // Parada AL INSTANTE para quien mira: se publica el fin ya, aunque las peticiones en vuelo
  // (un sitio que no responde puede tardar su tope entero) tarden un poco más en cortarse. Lo
  // que llegue después se descarta; la siguiente de la cola arranca cuando acaben de cortarse.
  b.parada = true;
  b.cortando = true;
  b.controller.abort();
  const total = b.eventos
    .filter(e => e.type === 'resultados')
    .reduce((n, e) => n + (e.items?.length || 0), 0);
  publicar(b, { type: 'fin', total, cancelada: true, parada: true });
  cerrar(b);
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

/** Cuántas hay en marcha y en cola (para «¿hay algo en marcha?» del apagado). */
function contar() {
  let curso = 0;
  for (const b of busquedas.values()) if (b.estado === 'curso') curso += 1;
  return { curso, cola: cola.length };
}

/**
 * Apagado ordenado: corta las que están en marcha. Va DESPUÉS de `guardarAlApagar`, con el
 * fichero ya congelado, así que en disco siguen «en curso» y se retoman al volver a arrancar.
 */
function cancelarTodas() {
  cola.length = 0;
  for (const b of busquedas.values()) if (b.estado === 'curso') b.controller.abort();
}

/** La última búsqueda lanzada a mano (para reengancharse desde otro dispositivo o tras recargar). */
function actual() {
  const b = ultima ? busquedas.get(ultima) : null;
  return b
    ? { id: b.id, q: b.q, carpeta: b.carpeta, estado: b.estado, terminada: Boolean(b.terminadaEn) }
    : null;
}

/** «Limpiar» en Buscar: la pantalla deja de reengancharse a la última búsqueda (que sigue en
 *  Actividad, y en marcha si lo estaba). */
function olvidarActual() {
  if (ultima === null) return false;
  ultima = null;
  marcarCambio();
  return true;
}

/** «Limpiar» en Actividad: borra las búsquedas terminadas (las en marcha y en cola siguen). */
function borrarTerminadas() {
  let n = 0;
  for (const [id, b] of busquedas) {
    if (b.estado !== 'fin') continue;
    busquedas.delete(id);
    pendientes.delete(id);
    porBorrar.add(id);
    if (ultima === id) ultima = null;
    n += 1;
  }
  if (n) marcarCambio();
  return n;
}

module.exports = {
  borrarTerminadas,
  olvidarActual,
  iniciar,
  suscribir,
  parar,
  actual,
  lista,
  marcar,
  restaurar,
  restaurado,
  guardarAhora,
  guardarAlApagar,
  entradaPendiente,
  resumirEventos,
  contar,
  cancelarTodas,
};
