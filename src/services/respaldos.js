'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { ErrorCrew } = require('./crew');

/**
 * Copias de seguridad de los datos propios (data/*.json): una al día en data/respaldos/AAAA-MM-DD,
 * se conservan `RESPALDOS_DIAS` días. Desde Ajustes se pueden ver, descargar y restaurar.
 *
 * Qué entra: crew.json (clave, conexiones, JDownloader, programadas, filtros, opciones de sitios),
 * profiles.json (los sitios), estadisticas.json y jd-paquetes.json. NO entra busquedas.json: es
 * estado pasajero (se vacía solo en una hora) y el que más pesa.
 *
 * Ojo al descargar: crew.json lleva la clave de API y las de las conexiones. Es lo que hace falta
 * para recuperar la instalación, y por eso mismo la descarga va detrás del acceso de la app.
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
  await fs.mkdir(destino, { recursive: true });
  const copiados = [];
  for (const [nombre, ruta] of Object.entries(ficheros())) {
    if (!(await existe(ruta))) continue;
    await fs.copyFile(ruta, path.join(destino, nombre));
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

/** Todo el respaldo en un JSON (para descargarlo). */
async function paquete(id) {
  const copia = await validar(id);
  const contenido = {};
  for (const { nombre } of copia.ficheros) {
    contenido[nombre] = JSON.parse(
      await fs.readFile(path.join(carpeta(), copia.id, nombre), 'utf8')
    );
  }
  return { clipscout: 'respaldo', version: 1, id: copia.id, ficheros: contenido };
}

/**
 * Vuelve a esa copia. Antes guarda lo actual como «antes-de-restaurar-…», así que restaurar
 * también se puede deshacer. Cada fichero se escribe con temporal + rename.
 */
async function restaurar(id) {
  const copia = await validar(id);
  const previa = `antes-de-restaurar-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copiarA(previa);
  const rutas = ficheros();
  for (const { nombre } of copia.ficheros) {
    const origen = path.join(carpeta(), copia.id, nombre);
    // Que sea JSON válido ANTES de pisar nada.
    const texto = await fs.readFile(origen, 'utf8');
    JSON.parse(texto);
    await fs.mkdir(path.dirname(rutas[nombre]), { recursive: true });
    await fs.writeFile(`${rutas[nombre]}.tmp`, texto, 'utf8');
    await fs.rename(`${rutas[nombre]}.tmp`, rutas[nombre]);
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
  logger.info(`Restaurada la copia ${copia.id} (la anterior quedó en ${previa})`);
  return { ok: true, restaurados: copia.ficheros.map(f => f.nombre), previa };
}

let reloj = null;
function arrancar() {
  if (reloj) return;
  asegurarDiario();
  reloj = setInterval(() => asegurarDiario(), 60 * 60 * 1000);
  reloj.unref?.();
}

module.exports = { asegurarDiario, listar, paquete, restaurar, arrancar, ficheros };
