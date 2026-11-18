'use strict';

const zlib = require('node:zlib');

/**
 * Zip mínimo, sin dependencias (informe de diagnóstico y copia de la suite). Escribe con deflate y
 * lee «stored» y deflate, que es lo que produce cualquier herramienta corriente. Sin zip64: los
 * ficheros de clipscout son de pocos MB.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en formato DOS. */
function fechaDos(d = new Date()) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/** [{nombre, datos: Buffer}] → Buffer del zip. */
function crear(entradas) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  const { hora, dia } = fechaDos();
  for (const { nombre, datos } of entradas) {
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const comprimido = zlib.deflateRawSync(datos);
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBuf, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombreBuf);
    desplazamiento += local.length + nombreBuf.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

class ZipInvalido extends Error {}

/**
 * Buffer del zip → Map(nombre → Buffer). Lee el directorio central (no se fía de las cabeceras
 * locales) y comprueba el CRC. Topes contra un zip hecho para reventar memoria.
 */
function leer(buf, { maxFicheros = 200, maxBytes = 200 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipInvalido('No es un zip.');
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ZipInvalido('No es un zip.');
  const total = buf.readUInt16LE(fin + 10);
  if (total > maxFicheros) throw new ZipInvalido('Demasiados ficheros en el zip.');
  let p = buf.readUInt32LE(fin + 16);
  const salida = new Map();
  let bytes = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ZipInvalido('Zip dañado.');
    }
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamComp = buf.readUInt32LE(p + 20);
    const tam = buf.readUInt32LE(p + 24);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    p += 46 + largoNombre + largoExtra + largoComentario;
    bytes += tam;
    if (bytes > maxBytes) throw new ZipInvalido('El zip descomprimido es demasiado grande.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
      throw new ZipInvalido('Zip dañado.');
    }
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const crudo = buf.subarray(inicio, inicio + tamComp);
    let datos;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) datos = zlib.inflateRawSync(crudo, { maxOutputLength: tam || 1 });
    else throw new ZipInvalido(`Compresión no admitida (${metodo}).`);
    if (datos.length !== tam || crc32(datos) !== crc) throw new ZipInvalido('Zip dañado (CRC).');
    if (!nombre.endsWith('/')) salida.set(nombre, datos);
  }
  return salida;
}

module.exports = { crear, leer, crc32, ZipInvalido };
