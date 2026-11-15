'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const logger = require('./logger');

/**
 * Un fichero JSON propio en la carpeta de datos (paquetes de JDownloader, estadísticas…), con la
 * misma disciplina que data/crew.json: escritura atómica (temporal + rename) y cambios en serie,
 * para que dos peticiones a la vez no se pisen.
 *
 * `ruta` es una función y no un valor: los tests cambian la carpeta de datos por entorno, y la
 * ruta se resuelve en cada lectura.
 */
function crearAlmacen(ruta, defecto = () => ({})) {
  let cola = Promise.resolve();

  async function leer() {
    try {
      return JSON.parse(await fs.readFile(ruta(), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // No se tira: se aparta el ilegible para poder mirarlo, y se empieza de cero.
        logger.warn(`${path.basename(ruta())} ilegible, se aparta: ${error.message}`);
        await fs.rename(ruta(), `${ruta()}.ilegible`).catch(() => {});
      }
      return defecto();
    }
  }

  async function escribir(datos) {
    const destino = ruta();
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const temporal = `${destino}.tmp`;
    await fs.writeFile(temporal, `${JSON.stringify(datos, null, 2)}\n`, 'utf8');
    await fs.rename(temporal, destino);
  }

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
