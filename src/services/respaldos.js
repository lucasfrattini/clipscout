'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { escribirTexto } = require('../lib/ficheroJson');
const { ErrorCrew } = require('./crew');

/**
 * Copias de seguridad de los datos propios (data/*.json): una al día en data/respaldos/AAAA-MM-DD,
 * se conservan `RESPALDOS_DIAS` días. Desde Ajustes se pueden ver, descargar y restaurar.
 *
 * Qué entra: crew.json (clave, conexiones, JDownloader, programadas, filtros, opciones de sitios),
 * profiles.json (los sitios), estadisticas.json, jd-paquetes.json y programadas-enviados.json. NO entra busquedas.json: es
 * estado pasajero (se vacía solo en una hora) y el que más pesa.
 *
 * Las copias locales (data/respaldos, solo el dueño: 700/600) llevan crew.json entero, con el
 * resumen de la contraseña y las claves: es lo que hace falta para recuperar la instalación. La
 * DESCARGA no (CS-S10): sale sin contraseña, sin clave de administración y sin las claves de las
 * conexiones (ver `sinSecretos`). Las sesiones (sesiones.json) no entran en ninguna copia.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const PREVIA = /^antes-de-restaurar-[\dTZ-]+$/;

/** nombre en el respaldo → ruta real. Rutas resueltas en cada llamada (los tests las cambian). */
function ficheros() {
  return {
    'crew.json': config.crew.path,
    'profiles.json': config.profiles.path,
    'estadisticas.json': path.join(config.datos.dir, 'estadisticas.json'),
    'jd-paquetes.json': path.join(config.datos.dir, 'jd-paquetes.json'),
    'programadas-enviados.json': path.join(config.datos.dir, 'programadas-enviados.json'),
  };
}

const carpeta = () => path.join(config.datos.dir, 'respaldos');
const hoy = () => new Date().toISOString().slice(0, 10);

async function existe(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Copia los ficheros que existan a `respaldos/<id>`. Devuelve los nombres copiados. */
async function copiarA(id) {
  const destino = path.join(carpeta(), id);
  await fs.mkdir(destino, { recursive: true, mode: 0o700 });
  const copiados = [];
  for (const [nombre, ruta] of Object.entries(ficheros())) {
    if (!(await existe(ruta))) continue;
    await fs.copyFile(ruta, path.join(destino, nombre));
    await fs.chmod(path.join(destino, nombre), 0o600).catch(() => {});
    copiados.push(nombre);
  }
  return copiados;
}

/** Borra lo que pase de `RESPALDOS_DIAS` copias diarias (y de otras tantas «antes de restaurar»). */
async function podar() {
  const nombres = await fs.readdir(carpeta()).catch(() => []);
  const conservar = Math.max(1, config.respaldos.dias);
  for (const patron of [DIA, PREVIA]) {
    const sobran = nombres
      .filter(n => patron.test(n))
      .sort()
      .reverse()
      .slice(conservar);
    for (const n of sobran) {
      await fs.rm(path.join(carpeta(), n), { recursive: true, force: true });
    }
  }
}

/** La copia de hoy, si no está hecha (o `forzar`: rehacerla). Nunca lanza. */
async function asegurarDiario({ forzar = false } = {}) {
  try {
    const id = hoy();
    if (!forzar && (await existe(path.join(carpeta(), id)))) return { id, hecha: false };
    const copiados = await copiarA(id);
    await podar();
    if (copiados.length) logger.info(`Copia de seguridad ${id}: ${copiados.join(', ')}`);
    return { id, hecha: true, ficheros: copiados };
  } catch (error) {
    logger.warn(`No se pudo hacer la copia de seguridad: ${error.message}`);
    return { hecha: false, error: error.message };
  }
}

async function listar() {
  const nombres = await fs.readdir(carpeta()).catch(() => []);
  const copias = [];
  for (const id of nombres
    .filter(n => DIA.test(n) || PREVIA.test(n))
    .sort()
    .reverse()) {
    const dentro = await fs.readdir(path.join(carpeta(), id)).catch(() => []);
    const lista = [];
    for (const nombre of dentro.filter(n => n in ficheros())) {
      const st = await fs.stat(path.join(carpeta(), id, nombre));
      lista.push({ nombre, bytes: st.size });
    }
    copias.push({ id, previa: PREVIA.test(id), ficheros: lista });
  }
  return copias;
}

/** El id tiene que ser uno de los listados: nunca se construye una ruta con lo que llega. */
async function validar(id) {
  const copia = (await listar()).find(c => c.id === id);
  if (!copia) throw new ErrorCrew('No existe esa copia.', 404);
  return copia;
}

/** crew.json sin lo que abre puertas: contraseña, clave de administración y claves de conexión. */
function sinSecretos(crew) {
  const limpio = { ...crew };
  delete limpio.acceso;
  delete limpio.api_key;
  if (Array.isArray(limpio.conexiones)) {
    limpio.conexiones = limpio.conexiones.map(c => {
      const resto = { ...c };
      delete resto.api_key;
      delete resto.entradas;
      return resto;
    });
  }
  return limpio;
}

/** Todo el respaldo en un JSON (para descargarlo), sin secretos. */
async function paquete(id) {
  const copia = await validar(id);
  const contenido = {};
  for (const { nombre } of copia.ficheros) {
    const datos = JSON.parse(await fs.readFile(path.join(carpeta(), copia.id, nombre), 'utf8'));
    contenido[nombre] = nombre === 'crew.json' ? sinSecretos(datos) : datos;
  }
  return {
    clipscout: 'respaldo',
    version: 2,
    id: copia.id,
    sinSecretos: true,
    ficheros: contenido,
  };
}

/**
 * Al restaurar crew.json, las claves de conexión se quedan como están AHORA: las otras apps ya
 * usan las actuales y una copia de antes las dejaría sin poder llamarnos (y a nosotros sin poder
 * llamarlas). Y lo mismo el usuario y la contraseña (CS-18): antes volvía la contraseña de la
 * copia sin avisar, y quien la había cambiado se quedaba fuera.
 */
function conClavesActuales(restaurado, actual) {
  if (!actual) return restaurado;
  if (actual.acceso) restaurado.acceso = actual.acceso;
  else delete restaurado.acceso;
  // La clave de administración también se queda la de AHORA (los scripts la usan; una copia sin
  // secretos no la trae y se generaría otra).
  if (actual.api_key) restaurado.api_key = actual.api_key;
  for (const c of restaurado.conexiones || []) {
    const ahora = (actual.conexiones || []).find(x => x.url === c.url && x.app === c.app);
    if (!ahora) continue;
    if (String(ahora.api_key || '').startsWith('cgc_')) c.api_key = ahora.api_key;
    if (ahora.entradas) c.entradas = ahora.entradas;
  }
  return restaurado;
}

/**
 * Vuelve a esa copia. Antes guarda lo actual como «antes-de-restaurar-…», así que restaurar
 * también se puede deshacer. Cada fichero se escribe con temporal + rename.
 */
async function restaurar(id) {
  const copia = await validar(id);
  const textos = {};
  for (const { nombre } of copia.ficheros) {
    textos[nombre] = await fs.readFile(path.join(carpeta(), copia.id, nombre), 'utf8');
  }
  const r = await aplicar(textos);
  logger.info(`Restaurada la copia ${copia.id} (la anterior quedó en ${r.previa})`);
  return { ok: true, restaurados: r.restaurados, previa: r.previa };
}

/**
 * Pone estos ficheros ({nombre: texto JSON}) en su sitio: antes guarda lo actual como
 * «antes-de-restaurar-…» (restaurar se puede deshacer) y comprueba que TODOS son JSON válido antes
 * de pisar nada. Lo usan las copias diarias y la copia de la suite (services/copia.js).
 */
async function aplicar(textos) {
  const rutas = ficheros();
  const validos = {};
  for (const [nombre, texto] of Object.entries(textos)) {
    if (!(nombre in rutas)) continue;
    validos[nombre] = { texto, datos: JSON.parse(texto) };
  }
  const previa = `antes-de-restaurar-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copiarA(previa);
  for (const [nombre, { texto, datos }] of Object.entries(validos)) {
    if (nombre === 'crew.json') {
      // Por la cola de cambios de crew.json (CS-18): antes se escribía por fuera y podía pisar,
      // o ser pisado por, un cambio que estuviera guardándose a la vez.
      await require('./crew').cambiar(actual => {
        const nuevo = conClavesActuales(datos, structuredClone(actual));
        for (const k of Object.keys(actual)) delete actual[k];
        Object.assign(actual, nuevo);
      });
      continue;
    }
    await escribirTexto(rutas[nombre], texto);
  }
  await podar();
  // Lo que se tiene en memoria se vuelve a leer del disco.
  await require('./ajustesBusqueda')
    .cargar()
    .catch(() => {});
  await require('./filtrosGlobales')
    .cargar()
    .catch(() => {});
  // La contraseña de Ajustes también vive en crew.json.
  await require('./acceso')
    .cargar({ forzar: true })
    .catch(() => {});
  return { restaurados: Object.keys(validos), previa };
}

let reloj = null;
function arrancar() {
  if (reloj) return;
  asegurarDiario();
  reloj = setInterval(() => asegurarDiario(), 60 * 60 * 1000);
  reloj.unref?.();
}

module.exports = {
  asegurarDiario,
  listar,
  paquete,
  restaurar,
  aplicar,
  arrancar,
  ficheros,
  sinSecretos,
};
