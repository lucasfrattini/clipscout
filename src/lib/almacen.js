'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const logger = require('./logger');
const { escribirJson, leerJson, ErrorIlegible } = require('./ficheroJson');

/**
 * Un fichero JSON propio en la carpeta de datos (paquetes de JDownloader, estadísticas…), con la
 * misma disciplina que data/crew.json (lib/ficheroJson.js): escritura atómica (temporal único +
 * rename), copia `.bak` de la versión anterior (salvo `copia: false`) con la que se recupera un
 * fichero dañado, y cambios en serie, para que dos peticiones a la vez no se pisen.
 *
 * `ruta` es una función y no un valor: los tests cambian la carpeta de datos por entorno, y la
 * ruta se resuelve en cada lectura.
 */
function crearAlmacen(ruta, defecto = () => ({}), { copia = true } = {}) {
  let cola = Promise.resolve();

  async function leer() {
    try {
      const r = await leerJson(ruta());
      if (r.recuperado) {
        logger.warn(
          `${path.basename(ruta())} estaba dañado (${r.causa.message}): se recuperó la copia ` +
            `anterior; el dañado quedó en ${path.basename(r.apartado)}`
        );
      }
      return r.datos || defecto();
    } catch (error) {
      if (!(error instanceof ErrorIlegible)) throw error;
      // Sin copia buena. Son datos de servicio (estadísticas, paquetes…), no de acceso: se aparta
      // el ilegible para poder mirarlo (nunca se pisa) y se empieza de cero.
      logger.warn(
        `${path.basename(ruta())} ilegible y sin copia buena, se aparta: ${error.message}`
      );
      const apartado = `${ruta()}.corrupto-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.rename(ruta(), apartado).catch(() => {});
      return defecto();
    }
  }

  const escribir = datos => escribirJson(ruta(), datos, { copia });

  /** Lee, aplica `fn` (que puede cambiar los datos en sitio) y escribe, en serie. */
  function cambiar(fn) {
    const paso = cola.then(async () => {
      const datos = await leer();
      const resultado = await fn(datos);
      await escribir(datos);
      return resultado;
    });
    cola = paso.catch(() => {});
    return paso;
  }

  return { leer, cambiar, ruta };
}

module.exports = { crearAlmacen };
