'use strict';

const logger = require('../lib/logger');

/**
 * Apagado ordenado (CS-20, común a las tres apps de Clipgeist: POST /api/apagar).
 *
 * El lanzador de escritorio y el instalador de Windows ya no matan el proceso: piden esto y
 * esperan. Lo mismo hace SIGTERM (Docker, systemd). Por orden:
 *
 * 1. Deja de aceptar trabajos nuevos: lo que cambia algo y lo pesado responde 503.
 * 2. Espera (60 s como mucho) a que acaben las peticiones que estaban guardando algo (un envío a
 *    JDownloader, un cambio de ajustes…): nunca se corta una escritura a medias. clipscout no
 *    mueve ficheros, así que no hay «fichero en curso» que esperar más allá de eso.
 * 3. Guarda la foto de las búsquedas en marcha y en cola (se retoman al volver a arrancar) y
 *    cancela lo demás: exploraciones y análisis en vivo se cortan y el navegador interno se cierra.
 * 4. Cierra el servidor HTTP y sale con código 0.
 */

const CAMBIAN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Lo largo, que se cancela en vez de esperarlo (stream de progreso o trabajo de minutos).
const PESADAS = ['/api/scrape', '/api/video', '/api/buscar/stream', '/api/sitios/auto'];
// Lo que puede pedir el lanzador incluso durante el apagado.
const RUTAS_APAGADO = new Set(['/api/apagar', '/api/estado-trabajos']);

const esPesada = ruta => PESADAS.some(p => ruta === p || ruta.startsWith(`${p}/`));

const estado = {
  apagando: false,
  pesadas: 0,
  escrituras: 0,
  promesa: null,
};

// Lo que pone server.js: sin esto (tests que crean la app sin servidor) «apagar» solo deja de
// aceptar trabajo; nunca termina el proceso de pruebas.
let entorno = null;

function configurar(opciones) {
  entorno = opciones;
}

/** Middleware: cuenta lo que hay en vuelo y, apagando, rechaza lo nuevo. */
function middleware(req, res, next) {
  const ruta = req.path;
  if (RUTAS_APAGADO.has(ruta)) return next();
  const pesada = esPesada(ruta);
  const escritura = !pesada && CAMBIAN.has(req.method);
  if (estado.apagando && (pesada || escritura)) {
    res.set('Connection', 'close');
    return res.status(503).json({ detail: 'La app se está cerrando.', code: 'APAGANDO' });
  }
  if (pesada || escritura) {
    const campo = pesada ? 'pesadas' : 'escrituras';
    estado[campo] += 1;
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      estado[campo] -= 1;
    };
    res.on('finish', fin);
    res.on('close', fin);
  }
  return next();
}

/**
 * ¿Hay algo en marcha? `que` es un código corto que la interfaz o el lanzador traducen:
 * 'guardando' | 'busqueda' | 'cola' | 'programada' | 'exploracion' | null.
 */
function estadoTrabajos() {
  const fondo = require('./busquedasFondo');
  const programadas = require('./programadas');
  const { curso, cola } = fondo.contar();
  const programada = programadas.enMarcha();
  let que = null;
  if (estado.escrituras > 0) que = 'guardando';
  else if (curso > 0) que = 'busqueda';
  else if (programada) que = 'programada';
  else if (estado.pesadas > 0) que = 'exploracion';
  else if (cola > 0) que = 'cola';
  return {
    ocupado: que !== null,
    que,
    apagando: estado.apagando,
    busquedas: curso,
    enCola: cola,
    exploraciones: estado.pesadas,
    escrituras: estado.escrituras,
  };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function esperarEscrituras(maxMs) {
  const hasta = Date.now() + maxMs;
  while (estado.escrituras > 0 && Date.now() < hasta) await esperar(100);
  return estado.escrituras === 0;
}

/**
 * Apaga. Idempotente: una segunda llamada (otra señal, el lanzador que insiste) devuelve la misma
 * promesa. `esperaMaxMs`: lo que se espera a las escrituras en vuelo; `forzarMs`: si algo se
 * cuelga, se sale igual (con 1) pasado ese tiempo.
 */
function apagar({ motivo = 'apagar', esperaMaxMs = 60000, forzarMs = 70000 } = {}) {
  if (estado.promesa) return estado.promesa;
  estado.apagando = true;
  logger.info(`Apagado ordenado (${motivo}): no se aceptan trabajos nuevos`);
  if (!entorno) {
    estado.promesa = Promise.resolve({ salido: false });
    return estado.promesa;
  }
  const { server, cerrarNavegador, salir } = entorno;
  const forzar = setTimeout(() => {
    logger.warn('Cierre forzado: el apagado ordenado no terminó a tiempo');
    salir(1);
  }, forzarMs);
  forzar.unref?.();

  estado.promesa = (async () => {
    // Nada de programadas nuevas mientras se apaga.
    require('./programadas').detener();
    if (!(await esperarEscrituras(esperaMaxMs))) {
      logger.warn(`Apagado: ${estado.escrituras} escritura(s) seguían en vuelo tras la espera`);
    }
    // La foto de las búsquedas ANTES de cerrar nada: cerrar el navegador las haría fallar y
    // quedarían como terminadas. Así quedan «en curso» y se retoman al arrancar.
    const fondo = require('./busquedasFondo');
    fondo.guardarAlApagar();
    fondo.cancelarTodas();
    // Ajustes que se estuvieran escribiendo en ese instante (crew.json va en serie).
    await require('./crew')
      .esperarEscrituras()
      .catch(() => {});
    if (server) {
      server.close(() => logger.info('Servidor HTTP cerrado'));
      // Los streams de progreso (SSE) no se cierran solos.
      server.closeAllConnections?.();
    }
    if (cerrarNavegador) {
      await cerrarNavegador().catch(error =>
        logger.warn('Error cerrando el navegador', error.message)
      );
    }
    clearTimeout(forzar);
    logger.info('Apagado terminado');
    salir(0);
    return { salido: true };
  })();
  return estado.promesa;
}

/** Solo para los tests: vuelve al estado inicial. */
function _reiniciar() {
  estado.apagando = false;
  estado.pesadas = 0;
  estado.escrituras = 0;
  estado.promesa = null;
  entorno = null;
}

module.exports = {
  configurar,
  middleware,
  estadoTrabajos,
  apagar,
  apagando: () => estado.apagando,
  RUTAS_APAGADO,
  _reiniciar,
};
