'use strict';

const fs = require('node:fs/promises');

const logger = require('../lib/logger');
const zip = require('../lib/zip');
const respaldos = require('./respaldos');
const { ErrorCrew } = require('./crew');
const { version } = require('../../package.json');

/**
 * Copia de la suite (SU-20, contrato común: docs/CREW.md). Un zip con lo necesario para llevarse
 * clipscout a otro equipo y un `manifiesto.json` `{app, version, esquema, fecha, contenido}`.
 *
 * Qué entra: los mismos ficheros que las copias diarias (crew.json, profiles.json,
 * estadisticas.json, jd-paquetes.json, programadas-enviados.json). crew.json va SIN secretos: ni
 * la contraseña, ni la clave de administración, ni las claves de las conexiones, ni sesiones
 * (sesiones.json no entra nunca). clipscout no guarda miniaturas en disco, así que
 * `?miniaturas=1` no añade nada (el manifiesto lo dice).
 *
 * Restaurar: comprueba manifiesto y versión (una copia de una versión MÁS NUEVA no se restaura),
 * guarda lo actual como «antes-de-restaurar-…» y pone los ficheros. La contraseña, la clave de
 * administración y las claves de las conexiones que ya existan se quedan las de ahora; una
 * conexión que llega sin clave queda desactivada hasta volver a conectarla (no se borra nada).
 */

const ESQUEMA = 1;
const MANIFIESTO = 'manifiesto.json';

/** «2.10.0» > «2.9.3». Partes que no son número cuentan como 0. */
function compararVersiones(a, b) {
  const pa = String(a || '0')
    .split(/[.+-]/)
    .slice(0, 3)
    .map(n => Number.parseInt(n, 10) || 0);
  const pb = String(b || '0')
    .split(/[.+-]/)
    .slice(0, 3)
    .map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function crear({ miniaturas = false } = {}) {
  const entradas = [];
  const contenido = [];
  for (const [nombre, ruta] of Object.entries(respaldos.ficheros())) {
    let texto;
    try {
      texto = await fs.readFile(ruta, 'utf8');
    } catch {
      continue; // aún no existe en esta instalación
    }
    let datos = JSON.parse(texto);
    if (nombre === 'crew.json') datos = respaldos.sinSecretos(datos);
    entradas.push({ nombre, datos: Buffer.from(JSON.stringify(datos, null, 2)) });
    contenido.push(nombre);
  }
  const manifiesto = {
    app: 'clipscout',
    version,
    esquema: ESQUEMA,
    fecha: new Date().toISOString(),
    contenido,
    sin_secretos: true,
    ...(miniaturas ? { miniaturas: 'no_aplica' } : {}),
  };
  entradas.unshift({ nombre: MANIFIESTO, datos: Buffer.from(JSON.stringify(manifiesto, null, 2)) });
  return { zip: zip.crear(entradas), manifiesto };
}

function invalida(detalle, params) {
  const e = new ErrorCrew(detalle, 400);
  e.codigo = 'copia_invalida';
  if (params) e.params = params;
  return e;
}

/** Lee y comprueba el zip; devuelve {manifiesto, textos} sin tocar nada. */
function comprobar(buffer) {
  let ficheros;
  try {
    ficheros = zip.leer(buffer, { maxFicheros: 50, maxBytes: 100 * 1024 * 1024 });
  } catch (error) {
    throw invalida(`No es una copia válida: ${error.message}`);
  }
  if (!ficheros.has(MANIFIESTO)) throw invalida('No es una copia válida: falta manifiesto.json.');
  let manifiesto;
  try {
    manifiesto = JSON.parse(ficheros.get(MANIFIESTO).toString('utf8'));
  } catch {
    throw invalida('No es una copia válida: manifiesto.json ilegible.');
  }
  if (manifiesto?.app !== 'clipscout') {
    throw invalida(`Esta copia es de ${manifiesto?.app || 'otra app'}, no de clipscout.`, {
      app: String(manifiesto?.app || ''),
    });
  }
  if (compararVersiones(manifiesto.version, version) > 0) {
    const e = new ErrorCrew(
      `Esta copia es de una versión más nueva (${manifiesto.version}): actualiza clipscout antes.`,
      409
    );
    e.codigo = 'version_mas_nueva';
    e.params = { version: String(manifiesto.version), actual: version };
    throw e;
  }
  if (Number(manifiesto.esquema) > ESQUEMA) {
    const e = new ErrorCrew(
      'Esta copia tiene un formato más nuevo: actualiza clipscout antes.',
      409
    );
    e.codigo = 'version_mas_nueva';
    e.params = { version: String(manifiesto.version), actual: version };
    throw e;
  }
  const permitidos = respaldos.ficheros();
  const textos = {};
  for (const [nombre, datos] of ficheros) {
    if (nombre === MANIFIESTO || !(nombre in permitidos)) continue;
    const texto = datos.toString('utf8');
    try {
      JSON.parse(texto);
    } catch {
      throw invalida(`No es una copia válida: ${nombre} está dañado.`, { fichero: nombre });
    }
    textos[nombre] = texto;
  }
  return { manifiesto, textos };
}

/**
 * Conexiones que llegan sin clave (la copia no las lleva) y que no existen aquí (si existen, se
 * quedan con la clave de ahora): desactivadas, no borradas.
 */
async function prepararCrew(texto) {
  const datos = JSON.parse(texto);
  const actuales =
    (
      await require('./crew')
        .leer()
        .catch(() => ({}))
    ).conexiones || [];
  for (const c of datos.conexiones || []) {
    const aqui = actuales.find(x => x.url === c.url && x.app === c.app && x.api_key);
    if (!c.api_key && !aqui) {
      c.activa = false;
      c.sin_clave = true;
    }
  }
  return JSON.stringify(datos, null, 2);
}

async function restaurar(buffer) {
  const { manifiesto, textos } = comprobar(buffer);
  if (textos['crew.json']) textos['crew.json'] = await prepararCrew(textos['crew.json']);
  const r = await respaldos.aplicar(textos);
  logger.info(
    `Restaurada una copia de clipscout ${manifiesto.version} del ${manifiesto.fecha} ` +
      `(lo anterior quedó en respaldos/${r.previa})`
  );
  return {
    ok: true,
    restaurados: r.restaurados,
    previa: r.previa,
    de: { version: manifiesto.version, fecha: manifiesto.fecha },
    // Las programadas y los paquetes vigilados se leen al arrancar: mejor reiniciar.
    reiniciar: true,
  };
}

module.exports = { crear, restaurar, comprobar, compararVersiones, ESQUEMA };
