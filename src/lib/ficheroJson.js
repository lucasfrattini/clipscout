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

const temporalDe = destino =>
  `${destino}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

const fechaArchivo = () => new Date().toISOString().replace(/[:.]/g, '-');

async function copiaAnterior(destino) {
  const bak = `${destino}.bak`;
  const temporal = temporalDe(bak);
  try {
    await fsp.copyFile(destino, temporal);
    await fsp.rename(temporal, bak);
  } catch (error) {
    await fsp.rm(temporal, { force: true }).catch(() => {});
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Escribe `texto` en `destino` de forma atómica (y con `.bak` de la anterior si `copia`). */
async function escribirTexto(destino, texto, { copia = false } = {}) {
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  const temporal = temporalDe(destino);
  try {
    await fsp.writeFile(temporal, texto, 'utf8');
    if (copia) await copiaAnterior(destino);
    await fsp.rename(temporal, destino);
  } catch (error) {
    await fsp.rm(temporal, { force: true }).catch(() => {});
    throw error;
  }
}

/** Lo mismo, síncrono (para el apagado, cuando ya no hay tiempo para promesas). */
function escribirTextoSync(destino, texto) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporal = temporalDe(destino);
  try {
    fs.writeFileSync(temporal, texto, 'utf8');
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
  escribirTexto,
  escribirTextoSync,
  escribirJson,
  leerJson,
  ErrorIlegible,
};
