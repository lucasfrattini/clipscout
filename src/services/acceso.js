'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const crew = require('./crew');

/**
 * Usuario y contraseña de la interfaz, como en clipkeeper y clonbuster: se ponen y se cambian
 * desde Ajustes → Acceso y se guardan en data/crew.json (`acceso`) con scrypt, nunca en claro.
 *
 * `ADMIN_PASSWORD` (y `ADMIN_USER`) en el entorno siguen valiendo y MANDAN: con ellas, Ajustes
 * no deja cambiar nada (se dice de dónde viene). Sin ninguna de las dos, no hay contraseña, que es
 * como ha funcionado siempre clipscout y sigue siendo una opción explícita («Quitar la
 * contraseña»): a diferencia de las otras dos apps, no se obliga a crear un usuario al arrancar,
 * para no dejar fuera de golpe a una instalación que ya funcionaba abierta en su red.
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
    cargado = crew.datos().then(d => {
      guardado = d.acceso?.hash ? { usuario: d.acceso.usuario, hash: d.acceso.hash } : null;
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
 * Secreto con el que se firman las sesiones. Sale de la contraseña (o de su hash), así que
 * cambiarla invalida todas las sesiones abiertas: lo mismo que «cerrar las demás sesiones» de
 * las otras apps, sin guardar sesiones en ningún sitio.
 */
function secreto() {
  const base = delEntorno() ? config.security.adminPassword : guardado?.hash || '';
  return claveFirma(usuario(), base);
}

/**
 * Igual que clipkeeper y clonbuster: con el mismo usuario y la misma contraseña, la sesión
 * abierta en una app vale en las tres. Token: «<caduca en segundos>.<hmac-sha256 hex>».
 */
const claveFirma = (u, hash) =>
  crypto
    .createHash('sha256')
    .update(`clipgeist-sesion|${String(u).toLowerCase()}|${hash}`)
    .digest();
const firmarSesion = (u, hash, caduca) =>
  `${caduca}.${crypto.createHmac('sha256', claveFirma(u, hash)).update(String(caduca)).digest('hex')}`;

// Verificar con scrypt cuesta ~50 ms: con HTTP Basic sería en CADA petición. Se recuerda el
// resultado (por huella, nunca la contraseña) hasta que cambie lo guardado.
const verificadas = new Map();

/** ¿Usuario y contraseña correctos? El usuario no distingue mayúsculas; la contraseña sí. */
function verificar(u, contrasena) {
  if (!activo()) return false;
  const usuarioBien = igualTiempo(String(u).trim().toLowerCase(), usuario().toLowerCase());
  if (delEntorno()) {
    return igualTiempo(contrasena, config.security.adminPassword) && usuarioBien;
  }
  const huella = crypto
    .createHash('sha256')
    .update(`${guardado.hash}\n${u}\n${contrasena}`)
    .digest('hex');
  if (verificadas.has(huella)) return verificadas.get(huella);
  const [, sal, esperado] = guardado.hash.split('$');
  const bien = igualTiempo(derivar(contrasena, Buffer.from(sal, 'hex')), esperado) && usuarioBien;
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
async function configurar({ usuario: nuevoUsuario = '', contrasena = '', actual = '' } = {}) {
  await cargar();
  if (delEntorno()) {
    throw new crew.ErrorCrew(
      'La contraseña viene de ADMIN_PASSWORD (entorno): se cambia allí.',
      409
    );
  }
  if (guardado && !verificar(guardado.usuario, actual)) {
    throw new crew.ErrorCrew('La contraseña actual no es correcta.', 400);
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
  guardado = nuevo;
  verificadas.clear();
  return estado();
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
  if (!verificar(guardado.usuario, actual)) {
    throw new crew.ErrorCrew('La contraseña actual no es correcta.', 400);
  }
  await crew.cambiar(d => {
    delete d.acceso;
  });
  guardado = null;
  verificadas.clear();
  return estado();
}

module.exports = {
  cargar,
  activo,
  usuario,
  secreto,
  firmarSesion,
  verificar,
  estado,
  configurar,
  quitar,
  MIN_LONGITUD,
};
