'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { escribirTexto } = require('../lib/ficheroJson');
const crew = require('./crew');

/**
 * Usuario y contraseña de la interfaz, como en clipkeeper y clonbuster: se ponen y se cambian
 * desde Ajustes → Seguridad y se guardan en data/crew.json (`acceso`) con scrypt, nunca en claro.
 *
 * `ADMIN_PASSWORD` (y `ADMIN_USER`) en el entorno siguen valiendo y MANDAN: con ellas, Ajustes
 * no deja cambiar nada (se dice de dónde viene). De esa contraseña solo se guarda en memoria su
 * resumen; las sesiones ya no se firman con nada derivado de ella (ver services/sesiones.js).
 *
 * Sin usuario, la app solo atiende al propio equipo (CS-S1): para crearlo desde otro dispositivo
 * hace falta el código de primer arranque que se escribe en el registro al arrancar.
 */

const MIN_LONGITUD = 8;
const PARAMS = { N: 16384, r: 8, p: 1 };

let guardado = null; // { usuario, hash } de data/crew.json
let cargado = null;

const derivar = (contrasena, sal) =>
  crypto.scryptSync(String(contrasena), sal, 32, PARAMS).toString('hex');

function hashDe(contrasena) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `scrypt$${sal}$${derivar(contrasena, Buffer.from(sal, 'hex'))}`;
}

const igualTiempo = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/** Lee lo guardado una vez (las peticiones esperan a esto antes de decidir si pasan). */
function cargar({ forzar = false } = {}) {
  if (!cargado || forzar) {
    const intento = crew.datos().then(d => {
      guardado = d.acceso?.hash ? { usuario: d.acceso.usuario, hash: d.acceso.hash } : null;
    });
    cargado = intento;
    // Un fallo (crew.json ilegible) no se queda guardado: la próxima petición vuelve a probar,
    // y en cuanto se arregla el fichero la app se abre sola, sin reiniciar.
    intento.catch(() => {
      if (cargado === intento) cargado = null;
    });
  }
  return cargado;
}

const delEntorno = () => Boolean(config.security.adminPassword);

/** ¿Hay contraseña? (entorno o Ajustes). Síncrono: solo tras `cargar()`. */
function activo() {
  return delEntorno() || Boolean(guardado);
}

function usuario() {
  return delEntorno() ? config.security.adminUser : guardado?.usuario || '';
}

/**
 * Firma de las cookies de 2.17 y anteriores («<caduca en s>.<hmac>»). Solo sirve para reconocer
 * una cookie antigua y canjearla UNA vez por una sesión nueva (middleware/acceso.js).
 */
function secretoAntiguo() {
  const base = delEntorno() ? config.security.adminPassword : guardado?.hash || '';
  return claveFirma(usuario(), base);
}

const claveFirma = (u, hash) =>
  crypto
    .createHash('sha256')
    .update(`clipgeist-sesion|${String(u).toLowerCase()}|${hash}`)
    .digest();
const firmarSesion = (u, hash, caduca) =>
  `${caduca}.${crypto.createHmac('sha256', claveFirma(u, hash)).update(String(caduca)).digest('hex')}`;

// Verificar con scrypt cuesta ~50 ms de CPU. Se hace fuera del hilo principal (crypto.scrypt
// asíncrono), para que adivinar contraseñas no congele el servidor, y se recuerda el resultado
// (por huella, nunca la contraseña) hasta que cambie lo guardado: con HTTP Basic llega en CADA
// petición.
const verificadas = new Map();
// De ADMIN_PASSWORD se calcula el resumen una vez y se compara contra él, como con la de Ajustes.
let entorno = null;
function hashEntorno() {
  const de = crypto.createHash('sha256').update(config.security.adminPassword).digest('hex');
  if (!entorno || entorno.de !== de) {
    entorno = { de, hash: hashDe(config.security.adminPassword) };
  }
  return entorno.hash;
}
const scrypt = (contrasena, sal) =>
  new Promise((resolver, rechazar) =>
    crypto.scrypt(String(contrasena), sal, 32, PARAMS, (error, clave) =>
      error ? rechazar(error) : resolver(clave.toString('hex'))
    )
  );

/** ¿Usuario y contraseña correctos? El usuario no distingue mayúsculas; la contraseña sí. */
async function verificar(u, contrasena) {
  if (!activo()) return false;
  const usuarioBien = igualTiempo(String(u).trim().toLowerCase(), usuario().toLowerCase());
  const hash = delEntorno() ? hashEntorno() : guardado.hash;
  const huella = crypto.createHash('sha256').update(`${hash}\n${u}\n${contrasena}`).digest('hex');
  if (verificadas.has(huella)) return verificadas.get(huella);
  const [, sal, esperado] = hash.split('$');
  const bien =
    igualTiempo(await scrypt(contrasena, Buffer.from(sal, 'hex')), esperado) && usuarioBien;
  if (verificadas.size > 100) verificadas.clear();
  verificadas.set(huella, bien);
  return bien;
}

function estado() {
  return { protegido: activo(), delEntorno: delEntorno(), usuario: activo() ? usuario() : '' };
}

/**
 * Poner o cambiar usuario y contraseña. Si ya había, hace falta la actual (`actual`).
 */
async function configurar(
  { usuario: nuevoUsuario = '', contrasena = '', actual = '', codigo = '' } = {},
  { local = false } = {}
) {
  await cargar();
  if (delEntorno()) {
    throw new crew.ErrorCrew(
      'La contraseña viene de ADMIN_PASSWORD (entorno): se cambia allí.',
      409
    );
  }
  if (guardado && !(await verificar(guardado.usuario, actual))) {
    throw new crew.ErrorCrew('La contraseña actual no es correcta.', 400);
  }
  // Primer usuario (SU-04): desde el propio equipo, o con el código de primer arranque.
  if (!guardado && !local && !(await codigoValido(codigo))) {
    throw new crew.ErrorCrew(
      'Para crear el usuario desde otro dispositivo hace falta el código de primer arranque ' +
        '(está en el registro de la app: «Código para crear el usuario»).',
      403
    );
  }
  const u = String(nuevoUsuario).trim().slice(0, 80);
  if (!u || String(contrasena).length < MIN_LONGITUD) {
    throw new crew.ErrorCrew(
      `Elige un usuario y una contraseña de al menos ${MIN_LONGITUD} caracteres.`,
      400
    );
  }
  const nuevo = { usuario: u, hash: hashDe(contrasena) };
  await crew.cambiar(d => {
    d.acceso = nuevo;
  });
  const eraPrimero = !guardado;
  guardado = nuevo;
  verificadas.clear();
  if (eraPrimero) await borrarCodigo();
  return estado();
}

/* ── Código de primer arranque (SU-04) ──────────────────────────────── */

// Sin 0/O, 1/l/I: que se lea bien en una consola.
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rutaCodigo = () => path.join(config.datos.dir, 'codigo-primer-arranque.txt');

function codigoNuevo() {
  const bytes = crypto.randomBytes(8);
  const c = [...bytes].map(b => LETRAS[b % LETRAS.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

const normalizarCodigo = c =>
  String(c || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

async function leerCodigo() {
  try {
    return (await fs.readFile(rutaCodigo(), 'utf8')).trim();
  } catch {
    return '';
  }
}

async function codigoValido(codigo) {
  const guardadoCodigo = await leerCodigo();
  const recibido = normalizarCodigo(codigo);
  return (
    Boolean(guardadoCodigo && recibido) && igualTiempo(recibido, normalizarCodigo(guardadoCodigo))
  );
}

async function borrarCodigo() {
  await fs.rm(rutaCodigo(), { force: true }).catch(() => {});
}

/**
 * Al arrancar (y al quitar la contraseña): si no hay usuario, deja un código en la carpeta de
 * datos (600) y lo escribe en el registro, bien visible. Se reutiliza el que hubiera.
 */
async function prepararPrimerArranque() {
  try {
    await cargar();
  } catch {
    return null; // ajustes ilegibles: la app está cerrada de todos modos
  }
  if (activo()) {
    await borrarCodigo();
    return null;
  }
  let codigo = await leerCodigo();
  if (!codigo) {
    codigo = codigoNuevo();
    await escribirTexto(rutaCodigo(), `${codigo}\n`);
  }
  const linea = '='.repeat(56);
  logger.warn(
    `\n${linea}\n  clipscout no tiene usuario todavía.\n  Código para crear el usuario: ${codigo}\n` +
      `  (desde este mismo equipo no hace falta)\n${linea}`
  );
  return codigo;
}

/** Volver a «sin contraseña». Pide la actual. */
async function quitar({ actual = '' } = {}) {
  await cargar();
  if (delEntorno()) {
    throw new crew.ErrorCrew(
      'La contraseña viene de ADMIN_PASSWORD (entorno): se quita allí.',
      409
    );
  }
  if (!guardado) return estado();
  if (!(await verificar(guardado.usuario, actual))) {
    throw new crew.ErrorCrew('La contraseña actual no es correcta.', 400);
  }
  await crew.cambiar(d => {
    delete d.acceso;
  });
  guardado = null;
  verificadas.clear();
  await prepararPrimerArranque();
  return estado();
}

module.exports = {
  cargar,
  activo,
  usuario,
  secretoAntiguo,
  firmarSesion,
  prepararPrimerArranque,
  codigoValido,
  rutaCodigo,
  verificar,
  estado,
  configurar,
  quitar,
  MIN_LONGITUD,
};
