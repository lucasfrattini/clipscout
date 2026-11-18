'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const logger = require('./logger');

/**
 * CS-S8: el servidor hace de intermediario de miniaturas (/api/thumbnail) y vídeo (/api/media)
 * para que el navegador no hable con los CDN de los sitios. Sin más, servía cualquier dirección
 * con nuestra salida. Ahora solo las que entregó él mismo: al mandar resultados (Buscar, la
 * búsqueda avanzada, el análisis de vídeo) cada dirección de imagen o vídeo va con su firma
 * (`thumbnailFirma`, `thumbnailUrlFirma`, `urlFirma`), y el intermediario la comprueba.
 *
 * La clave de firma vive en `data/firma-intermediario.key` (solo el dueño): sobrevive a los
 * reinicios, así que una búsqueda retomada sigue enseñando sus miniaturas. No es un secreto que
 * importe fuera de esta instalación.
 */

let clave = null;
function claveFirma() {
  if (clave) return clave;
  const ruta = path.join(config.datos.dir, 'firma-intermediario.key');
  try {
    clave = Buffer.from(fs.readFileSync(ruta, 'utf8').trim(), 'hex');
    if (clave.length < 32) throw new Error('corta');
  } catch {
    clave = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true, mode: 0o700 });
      fs.writeFileSync(ruta, clave.toString('hex'), { mode: 0o600 });
    } catch (error) {
      logger.warn(`No se pudo guardar la clave de firma (vale hasta reiniciar): ${error.message}`);
    }
  }
  return clave;
}

/** Firma corta (22 caracteres) de una dirección. */
function firmar(url) {
  return crypto
    .createHmac('sha256', claveFirma())
    .update(String(url))
    .digest('base64url')
    .slice(0, 22);
}

function firmaValida(url, firma) {
  if (typeof firma !== 'string' || firma.length !== 22) return false;
  const esperada = Buffer.from(firmar(url));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

const CAMPOS = ['thumbnail', 'thumbnailUrl', 'url'];
const esWeb = v => typeof v === 'string' && /^https?:\/\//i.test(v);

/**
 * Añade la firma a cada dirección de imagen o vídeo de lo que se va a mandar a la interfaz:
 * recorre objetos y listas y, junto a `thumbnail`, `thumbnailUrl` y `url`, pone
 * `<campo>Firma`. Devuelve una copia (no toca lo guardado).
 */
function firmarDatos(dato, profundidad = 0) {
  if (profundidad > 6 || dato === null || typeof dato !== 'object') return dato;
  if (Array.isArray(dato)) return dato.map(x => firmarDatos(x, profundidad + 1));
  const copia = {};
  for (const [k, v] of Object.entries(dato)) copia[k] = firmarDatos(v, profundidad + 1);
  for (const campo of CAMPOS) {
    if (esWeb(dato[campo])) copia[`${campo}Firma`] = firmar(dato[campo]);
  }
  return copia;
}

/** «cdn.img.ejemplo.com» → «ejemplo.com» (y «x.ejemplo.co.uk» → «ejemplo.co.uk»), a ojo. */
function dominioBase(host) {
  const partes = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.')
    .filter(Boolean);
  if (partes.length <= 2) return partes.join('.');
  const [penultima, ultima] = partes.slice(-2);
  const dos = ultima.length === 2 && penultima.length <= 3; // co.uk, com.br…
  return partes.slice(dos ? -3 : -2).join('.');
}

/**
 * ¿Puede el intermediario pedir esta dirección? Con firma válida, sí. Sin ella, solo si es de uno
 * de los sitios configurados (mismo dominio base que su dirección de búsqueda) o si quien llama
 * usa la clave de administración (scripts). `dominiosSitios`: dominios base de los sitios.
 */
function puedeIntermediar({ url, firma, admin = false, dominiosSitios = new Set() }) {
  if (admin) return true;
  if (firmaValida(url, firma)) return true;
  try {
    return dominiosSitios.has(dominioBase(new URL(url).hostname));
  } catch {
    return false;
  }
}

module.exports = { firmar, firmaValida, firmarDatos, dominioBase, puedeIntermediar };
