'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const config = require('../config');
const logger = require('../lib/logger');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { sinProxy } = require('../lib/http');
const { AppError } = require('../lib/errors');

/**
 * Vista previa de un resultado antes de mandarlo a descargar: una tira de fotogramas repartidos por
 * todo el vídeo, sacados del propio fichero sin bajarlo (ffmpeg pide solo los trozos que necesita).
 * Sirve para ver de un vistazo si es lo que parece (no un relato hablado, ni una recopilación, ni
 * otra cosa) en cualquier sitio en el que clipscout sepa encontrar el fichero de la ficha.
 *
 * Solo bajo petición (botón «Vista previa»): cada tira son unas pocas peticiones al sitio. Lo hecho
 * se guarda en memoria un rato; como mucho `concurrencia` a la vez.
 */

const cache = new Map(); // ficha → { jpeg, hecha }
const enCurso = new Map(); // ficha → Promise
let activos = 0;
const espera = [];

function ffmpegDisponible() {
  return new Promise(resolve => {
    const p = spawn(config.vistaPrevia.ffmpeg, ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    p.on('error', () => resolve(false));
    p.on('exit', code => resolve(code === 0));
  });
}

async function turno(fn) {
  if (activos >= config.vistaPrevia.concurrencia) await new Promise(r => espera.push(r));
  activos += 1;
  try {
    return await fn();
  } finally {
    activos -= 1;
    espera.shift()?.();
  }
}

/** Ejecuta un programa con tiempo máximo; devuelve stdout (Buffer) o lanza con lo último de stderr. */
function ejecutar(programa, args, { env, plazoMs }) {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const salida = [];
    let error = '';
    const reloj = setTimeout(() => p.kill('SIGKILL'), plazoMs);
    p.stdout.on('data', d => salida.push(d));
    p.stderr.on('data', d => (error = (error + d).slice(-2000)));
    p.on('error', e => {
      clearTimeout(reloj);
      reject(e);
    });
    p.on('exit', code => {
      clearTimeout(reloj);
      if (code === 0) resolve(Buffer.concat(salida));
      else reject(new Error(error.trim().split('\n').pop() || `salió con ${code}`));
    });
  });
}

function entornoPara(fichero) {
  const env = { ...process.env };
  delete env.http_proxy;
  delete env.HTTP_PROXY;
  if (config.outboundProxy && !sinProxy(fichero)) env.http_proxy = config.outboundProxy;
  return env;
}

function cabeceras(ficha) {
  return `Referer: ${ficha}\r\nUser-Agent: ${config.vistaPrevia.userAgent}\r\n`;
}

const ENTRADA = [
  '-protocol_whitelist',
  'hls,https,http,tls,tcp,crypto,httpproxy',
  '-rw_timeout',
  '15000000',
];

async function duracion(fichero, ficha, env) {
  const out = await ejecutar(
    config.vistaPrevia.ffprobe,
    [
      '-v',
      'error',
      ...ENTRADA,
      '-headers',
      cabeceras(ficha),
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      fichero,
    ],
    { env, plazoMs: 30000 }
  );
  const d = Number.parseFloat(out.toString().trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Un fotograma (JPEG) en el segundo `s`, encajado en ANCHO×ALTO con bandas negras. */
function fotograma(fichero, ficha, s, env) {
  const { ancho, alto } = config.vistaPrevia;
  return ejecutar(
    config.vistaPrevia.ffmpeg,
    [
      '-v',
      'error',
      ...ENTRADA,
      '-headers',
      cabeceras(ficha),
      '-ss',
      String(Math.max(0, s).toFixed(2)),
      '-i',
      fichero,
      '-frames:v',
      '1',
      '-vf',
      `scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      '-q:v',
      '5',
      'pipe:1',
    ],
    { env, plazoMs: 30000 }
  );
}

/** Junta los fotogramas en una tira de COLUMNAS columnas. */
async function juntar(jpegs) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-previa-'));
  try {
    await Promise.all(jpegs.map((j, i) => fs.writeFile(path.join(dir, `${i}.jpg`), j)));
    const columnas = Math.min(config.vistaPrevia.columnas, jpegs.length);
    const filas = Math.ceil(jpegs.length / columnas);
    return await ejecutar(
      config.vistaPrevia.ffmpeg,
      [
        '-v',
        'error',
        '-i',
        path.join(dir, '%d.jpg'),
        '-vf',
        `tile=${columnas}x${filas}:padding=4:color=black`,
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        '-q:v',
        '5',
        'pipe:1',
      ],
      { env: process.env, plazoMs: 30000 }
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Direcciones de vídeo que aparezcan en el HTML de la ficha (también dentro de JSON, con «\/»):
 * listas HLS (.m3u8) y ficheros. Para los sitios que no dan un fichero descargable pero sí reproducen
 * por HLS: a ffmpeg le vale igual para sacar fotogramas.
 */
function videosEnHtml(html, base) {
  const texto = String(html || '').replace(/\\\//g, '/');
  const vistos = new Set();
  const salida = [];
  for (const m of texto.matchAll(
    /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>\\]*)?/gi
  )) {
    const u = m[0].replace(/&amp;/g, '&');
    if (vistos.has(u)) continue;
    vistos.add(u);
    try {
      salida.push(new URL(u, base).href);
    } catch {
      // no es una dirección
    }
  }
  // Primero las listas HLS (suelen ser el vídeo entero), luego los ficheros.
  return salida.sort((a, b) => Number(/\.m3u8/i.test(b)) - Number(/\.m3u8/i.test(a)));
}

async function ficherosDe(ficha) {
  const directo = require('./directo');
  const ficheros = await directo.resolverDirecto(ficha).catch(() => []);
  if (ficheros.length) return ficheros;
  const { fetchHtml } = require('../lib/http');
  return videosEnHtml(await fetchHtml(ficha), ficha).filter(
    u => !/preview|thumb|trailer|teaser/i.test(u)
  );
}

async function hacer(ficha) {
  const ficheros = await ficherosDe(ficha);
  if (!ficheros.length) {
    throw new AppError('No se encontró el fichero del vídeo en esa página.', 404, 'SIN_FICHERO');
  }
  let ultimoError = null;
  for (const fichero of ficheros.slice(0, 2)) {
    try {
      // ffmpeg no pasa por la validación de red del resto: se comprueba aquí que el destino es público.
      await assertUrlIsSafe(fichero);
      const env = entornoPara(fichero);
      const d = await duracion(fichero, ficha, env);
      const n = config.vistaPrevia.fotogramas;
      const momentos = d
        ? Array.from({ length: n }, (_, i) => d * (0.06 + (0.88 * i) / (n - 1)))
        : [0];
      const jpegs = [];
      for (const s of momentos) {
        try {
          jpegs.push(await fotograma(fichero, ficha, s, env));
        } catch (error) {
          logger.warn(`Vista previa: fotograma en ${Math.round(s)} s: ${error.message}`);
        }
      }
      if (jpegs.length) return { jpeg: await juntar(jpegs), duracion: d };
    } catch (error) {
      ultimoError = error;
    }
  }
  throw new AppError(
    `No se pudo leer el vídeo: ${ultimoError?.message || 'sin fotogramas'}`.slice(0, 300),
    502,
    'VISTA_PREVIA'
  );
}

/** La tira (JPEG) de una ficha, de la memoria o hecha ahora. */
async function generar(ficha) {
  const guardada = cache.get(ficha);
  if (guardada && Date.now() - guardada.hecha < config.vistaPrevia.vigenciaMs) return guardada;
  if (!(await ffmpegDisponible())) {
    throw new AppError('Falta ffmpeg en el servidor.', 501, 'SIN_FFMPEG');
  }
  if (!enCurso.has(ficha)) {
    enCurso.set(
      ficha,
      turno(() => hacer(ficha))
        .then(r => {
          const hecha = { ...r, hecha: Date.now() };
          cache.set(ficha, hecha);
          while (cache.size > config.vistaPrevia.maxCache) cache.delete(cache.keys().next().value);
          return hecha;
        })
        .finally(() => enCurso.delete(ficha))
    );
  }
  return enCurso.get(ficha);
}

module.exports = { generar, videosEnHtml };
