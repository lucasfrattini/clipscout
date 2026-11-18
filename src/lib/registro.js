'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');

/**
 * Registro en fichero con rotación (SU-11). Se escribe además de la consola (que es lo que ve
 * Docker): así Ajustes → Diagnóstico puede enseñar las últimas líneas y el informe llevarlas.
 *
 * `clipscout.log` crece hasta `maxBytes`; entonces pasa a `.1` (y el `.1` a `.2`…): como mucho
 * `ficheros` en total. Escritura síncrona a propósito: el registro es poco (nivel info) y así un
 * fallo justo antes de caer queda escrito y en orden.
 */

const NOMBRE = 'clipscout.log';
let tamano = null;
let roto = false;

const carpeta = () => path.join(config.datos.dir, 'registro');
const ruta = (n = 0) => path.join(carpeta(), n ? `${NOMBRE}.${n}` : NOMBRE);

function rotar() {
  const total = Math.max(1, config.logging.ficheros);
  for (let i = total - 1; i >= 1; i--) {
    const origen = ruta(i - 1);
    if (fs.existsSync(origen)) fs.renameSync(origen, ruta(i));
  }
  tamano = 0;
}

/** Añade una línea. Nunca lanza: si el disco falla, el registro sigue por la consola. */
function escribir(linea) {
  if (!config.logging.fichero || roto) return;
  try {
    if (tamano === null) {
      fs.mkdirSync(carpeta(), { recursive: true, mode: 0o700 });
      tamano = fs.existsSync(ruta()) ? fs.statSync(ruta()).size : 0;
    }
    const texto = `${linea}\n`;
    const bytes = Buffer.byteLength(texto);
    if (tamano > 0 && tamano + bytes > config.logging.maxBytes) rotar();
    fs.appendFileSync(ruta(), texto, { mode: 0o600 });
    tamano += bytes;
  } catch {
    // Sin disco escribible no se insiste en cada línea: el diagnóstico ya lo dirá.
    roto = true;
    setTimeout(() => {
      roto = false;
      tamano = null;
    }, 60 * 1000).unref?.();
  }
}

/** Las últimas `n` líneas (del fichero actual y, si no llegan, de los rotados). */
function ultimas(n = 200) {
  const max = Math.max(1, Math.min(Number(n) || 200, 5000));
  let lineas = [];
  for (let i = 0; i < Math.max(1, config.logging.ficheros) && lineas.length < max; i++) {
    let texto;
    try {
      texto = fs.readFileSync(ruta(i), 'utf8');
    } catch {
      break;
    }
    lineas = texto.split('\n').filter(Boolean).concat(lineas);
  }
  return lineas.slice(-max);
}

/** Para las pruebas: olvidar el tamaño calculado (otra carpeta de datos). */
function _reiniciar() {
  tamano = null;
  roto = false;
}

module.exports = { escribir, ultimas, ruta, _reiniciar };
