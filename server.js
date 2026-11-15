'use strict';

/**
 * Punto de entrada de clipscout.
 *
 * Toda la lógica vive en src/. Este fichero solo arranca el servidor y
 * gestiona el apagado ordenado.
 */

const config = require('./src/config');
const logger = require('./src/lib/logger');
const { createApp } = require('./src/app');
const { pool } = require('./src/lib/browser');

const app = createApp();

// Lo guardado en Ajustes (búsqueda web, sitios sin VPN) pasa a la configuración en memoria.
require('./src/services/ajustesBusqueda')
  .cargar()
  .catch(error => logger.warn('No se pudieron cargar los ajustes de búsqueda', error.message));

// Palabras siempre bloqueadas (Ajustes): se tienen en memoria para no leer el fichero por tanda.
require('./src/services/filtrosGlobales')
  .cargar()
  .catch(error => logger.warn('No se pudieron cargar los filtros', error.message));

// Búsquedas que estaban en marcha o en cola antes del reinicio: se retoman solas.
const fondo = require('./src/services/busquedasFondo');
fondo
  .restaurar()
  .catch(error => logger.warn('No se pudieron retomar las búsquedas', error.message));

// Paquetes mandados a JDownloader que seguían sin terminar: se siguen vigilando.
require('./src/services/paquetesJd').arrancar();

// Búsquedas programadas: se mira cada pocos minutos si toca alguna (empieza sin ninguna).
require('./src/services/programadas').arrancar();

const server = app.listen(config.port, () => {
  logger.info(`clipscout escuchando en http://localhost:${config.port}`);
});

/** Apagado ordenado: cierra el servidor HTTP y el navegador del pool. */
async function shutdown(signal) {
  logger.info(`Recibido ${signal}, cerrando...`);

  const forceExit = setTimeout(() => {
    logger.warn('Cierre forzado tras el timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref?.();

  // Lo primero: la foto de las búsquedas en marcha, antes de que cerrar nada las haga fallar.
  fondo.guardarAlApagar();
  server.close(() => logger.info('Servidor HTTP cerrado'));
  await pool.close().catch(error => logger.warn('Error cerrando el navegador', error.message));
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  logger.error('Promesa rechazada sin manejar', reason);
});

module.exports = { app, server };
