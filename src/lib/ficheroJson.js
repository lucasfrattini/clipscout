'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Escritura y lectura segura de los ficheros de datos (data/*.json). Una sola disciplina para
 * todos:
 *
 * - Escribir: temporal con nombre ÚNICO (dos escrituras a la vez no comparten temporal) y
 *   `rename`, que es atómico: un corte a medias deja el fichero anterior entero, nunca uno roto.
 * - `copia: true`: antes de sustituirlo, la versión anterior queda en `<fichero>.bak` (también
 *   con temporal + rename). Es la «última copia buena» con la que se recupera un fichero dañado.
 * - Leer: si el fichero no se puede interpretar, se prueba con `.bak`. El dañado NUNCA se pisa:
 *   se aparta como `<fichero>.corrupto-<fecha>` solo cuando hay con qué sustituirlo.
 */

// Solo el dueño: los ficheros de datos llevan secretos (resumen de la contraseña, claves, sesiones).
// En Windows `mode` no aplica y se ignora.
const MODO_FICHERO = 0o600;
const MODO_CARPETA = 0o700;

const temporalDe = destino =>
  `${destino}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

const fechaArchivo = () => new Date().toISOString().replace(/[:.]/g, '-');

const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * `rename` con reintentos: en Windows falla con EPERM/EBUSY/EACCES si otro proceso (antivirus,
 * indexador) tiene el destino abierto un instante. En Linux y macOS sale a la primera.
 */
async function renombrar(origen, destino) {
  for (let intento = 0; ; intento += 1) {
    try {
      return await fsp.rename(origen, destino);
    } catch (error) {
      if (intento >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await esperar(50 * (intento + 1));
    }
  }
}

async function copiaAnterior(destino) {
  const bak = `${destino}.bak`;
  const temporal = temporalDe(bak);
  try {
    await fsp.copyFile(destino, temporal);
    await fsp.chmod(temporal, MODO_FICHERO).catch(() => {});
    await renombrar(temporal, bak);
  } catch (error) {
    await fsp.rm(temporal, { force: true }).catch(() => {});
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Escribe `texto` en `destino` de forma atómica (y con `.bak` de la anterior si `copia`). */
async function escribirTexto(destino, texto, { copia = false } = {}) {
  await fsp.mkdir(path.dirname(destino), { recursive: true, mode: MODO_CARPETA });
  const temporal = temporalDe(destino);
  try {
    await fsp.writeFile(temporal, texto, { encoding: 'utf8', mode: MODO_FICHERO });
    if (copia) await copiaAnterior(destino);
    await renombrar(temporal, destino);
  } catch (error) {
    await fsp.rm(temporal, { force: true }).catch(() => {});
    throw error;
  }
}

/** Lo mismo, síncrono (para el apagado, cuando ya no hay tiempo para promesas). */
function escribirTextoSync(destino, texto) {
  fs.mkdirSync(path.dirname(destino), { recursive: true, mode: MODO_CARPETA });
  const temporal = temporalDe(destino);
  try {
    fs.writeFileSync(temporal, texto, { encoding: 'utf8', mode: MODO_FICHERO });
    fs.renameSync(temporal, destino);
  } catch (error) {
    fs.rmSync(temporal, { force: true });
    throw error;
  }
}

function escribirJson(destino, datos, opciones) {
  return escribirTexto(destino, `${JSON.stringify(datos, null, 2)}\n`, opciones);
}

/** Error de lectura que NO es «no existe»: el fichero está, pero no se puede usar. */
class ErrorIlegible extends Error {
  constructor(ruta, causa) {
    super(`${path.basename(ruta)} no se puede leer: ${causa.message}`);
    this.ruta = ruta;
    this.causa = causa;
  }
}

/** Un objeto JSON, o lanza. Un `null`, un número o una lista tampoco valen como datos. */
async function leerObjeto(ruta) {
  const texto = await fsp.readFile(ruta, 'utf8');
  const datos = JSON.parse(texto);
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new Error('no contiene un objeto JSON');
  }
  return datos;
}

/**
 * Lee un fichero JSON de datos.
 *
 * - No existe → `{ datos: null }` (quien llama decide qué es «vacío»).
 * - Se lee bien → `{ datos }`.
 * - Está dañado y hay `.bak` legible → el dañado se aparta como `.corrupto-<fecha>`, el `.bak` se
 *   vuelve a poner como fichero principal y se devuelve `{ datos, recuperado: true, apartado }`.
 * - Dañado y sin copia buena → lanza `ErrorIlegible`, SIN tocar nada en disco.
 */
async function leerJson(ruta) {
  try {
    return { datos: await leerObjeto(ruta) };
  } catch (error) {
    if (error.code === 'ENOENT') return { datos: null };
    let copia;
    try {
      copia = await leerObjeto(`${ruta}.bak`);
    } catch {
      throw new ErrorIlegible(ruta, error);
    }
    // Se COPIA (no se mueve) y luego se sustituye con rename: el fichero principal no desaparece
    // ni un instante, así que otra lectura a la vez nunca lo ve como «no existe» (= vacío).
    const apartado = `${ruta}.corrupto-${fechaArchivo()}`;
    try {
      await fsp.copyFile(ruta, apartado);
    } catch {
      throw new ErrorIlegible(ruta, error);
    }
    await escribirJson(ruta, copia);
    return { datos: copia, recuperado: true, apartado, causa: error };
  }
}

module.exports = {
  MODO_FICHERO,
  MODO_CARPETA,
  escribirTexto,
  escribirTextoSync,
  escribirJson,
  leerJson,
  ErrorIlegible,
};
