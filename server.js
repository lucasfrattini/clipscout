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

// CS-26: con DATA_DIR, crew.json y profiles.json van dentro. Si el data/ del programa tiene unos
// y la carpeta nueva no, solo se avisa (nunca se copia ni se mueve nada solo).
for (const aviso of config.avisosMigracionDatos()) logger.warn(aviso);

// La carpeta de datos solo para el dueño (700) y los ficheros 600, también los que ya había.
const path = require('node:path');
require('./src/lib/permisos')
  .corregirPermisos([config.datos.dir, path.dirname(config.crew.path)])
  .catch(() => {});

// Sin usuario todavía: código de primer arranque en el registro (para crearlo desde otro equipo).
require('./src/services/acceso')
  .prepararPrimerArranque()
  .catch(error => logger.warn('Primer arranque', error.message));

// Lo guardado en Ajustes (búsqueda web, sitios sin VPN) pasa a la configuración en memoria.
require('./src/services/ajustesBusqueda')
  .cargar()
  .catch(error => logger.warn('No se pudieron cargar los ajustes de búsqueda', error.message));

// Palabras siempre bloqueadas (Ajustes): se tienen en memoria para no leer el fichero por tanda.
require('./src/services/filtrosGlobales')
  .cargar()
  .catch(error => logger.warn('No se pudieron cargar los filtros', error.message));

// ¿Responde el proxy de salida? Se mira ya y luego cada minuto (si hay proxy).
require('./src/services/proxySalida').vigilar();

// Búsquedas que estaban en marcha o en cola antes del reinicio: se retoman solas.
const fondo = require('./src/services/busquedasFondo');
fondo
  .restaurar()
  .catch(error => logger.warn('No se pudieron retomar las búsquedas', error.message));

// Paquetes mandados a JDownloader que seguían sin terminar: se siguen vigilando.
require('./src/services/paquetesJd').arrancar();

// Copia de seguridad diaria de data/*.json (la de hoy, si falta, y luego cada hora se mira).
require('./src/services/respaldos').arrancar();

// Instalación conjunta de Clipgeist: con CLIPGEIST_CLAVE y las URLs en el entorno, se conecta sola
// con las otras apps (y reintenta unos minutos si aún no responden). Sin ellas, nada.
require('./src/services/crew')
  .autoconectar()
  .catch(error => logger.warn('Clipgeist: autoconexión', error.message));

// Conexiones de antes de 2.18 (con la clave de administración de la otra app): se pasan solas a
// claves de conexión, al arrancar y luego cada hora hasta conseguirlo.
require('./src/services/crew').arrancarMigracion({
  esperaMs: Number(process.env.CLIPGEIST_MIGRACION_ESPERA_MS) || 20000,
});

// Búsquedas programadas: se mira cada pocos minutos si toca alguna (empieza sin ninguna).
require('./src/services/programadas').arrancar();

const escuchar = () =>
  logger.info(`clipscout escuchando en http://${config.host || 'localhost'}:${config.port}`);
const server = config.host
  ? app.listen(config.port, config.host, escuchar)
  : app.listen(config.port, escuchar);

// Apagado ordenado (services/apagado.js): lo mismo por POST /api/apagar (lanzador, instalador)
// que por SIGTERM/SIGINT (Docker, systemd, Ctrl+C). Con una señal se espera menos a lo que esté
// guardando: Docker mata a los 10 s.
const apagado = require('./src/services/apagado');
apagado.configurar({
  server,
  cerrarNavegador: () => pool.close(),
  salir: codigo => process.exit(codigo),
});
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    logger.info(`Recibido ${senal}, cerrando...`);
    apagado.apagar({ motivo: senal, esperaMaxMs: 7000, forzarMs: 9500 });
  });
}

process.on('unhandledRejection', reason => {
  logger.error('Promesa rechazada sin manejar', reason);
});

module.exports = { app, server };
