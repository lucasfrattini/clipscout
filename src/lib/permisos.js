'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const logger = require('./logger');
const { MODO_FICHERO, MODO_CARPETA } = require('./ficheroJson');

/**
 * Al arrancar: la carpeta de datos (y sus subcarpetas, como respaldos/) solo para el dueño (700)
 * y cada fichero de dentro 600. Los de instalaciones anteriores se crearon con 644: llevan el
 * resumen de la contraseña, las claves y las sesiones. En Windows no se hace nada (los permisos
 * POSIX no aplican). Nunca lanza: un fichero que no se deja cambiar solo se avisa.
 */
async function corregirPermisos(carpetas) {
  if (process.platform === 'win32') return { cambiados: 0 };
  let cambiados = 0;
  const ajustar = async (ruta, modo) => {
    try {
      const st = await fs.lstat(ruta);
      if (st.isSymbolicLink()) return;
      if ((st.mode & 0o777) !== modo) {
        await fs.chmod(ruta, modo);
        cambiados += 1;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn(`No se pudieron ajustar los permisos de ${ruta}`);
    }
  };
  const recorrer = async (carpeta, profundidad) => {
    await ajustar(carpeta, MODO_CARPETA);
    let entradas = [];
    try {
      entradas = await fs.readdir(carpeta, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const ruta = path.join(carpeta, e.name);
      if (e.isDirectory() && profundidad < 3) await recorrer(ruta, profundidad + 1);
      else if (e.isFile()) await ajustar(ruta, MODO_FICHERO);
    }
  };
  for (const c of new Set(carpetas.filter(Boolean))) await recorrer(c, 0);
  if (cambiados) logger.info(`Permisos de la carpeta de datos ajustados (${cambiados})`);
  return { cambiados };
}

module.exports = { corregirPermisos };
