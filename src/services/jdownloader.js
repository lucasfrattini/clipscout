'use strict';

const config = require('../config');
const crew = require('./crew');

/**
 * Enviar enlaces a JDownloader 2 por su API local («Deprecated API», puerto
 * 3128 por defecto). Se activa en JDownloader: Ajustes avanzados →
 * `RemoteAPI: Deprecated API enabled` y `... localhost only` desactivado.
 *
 * Formato de esa API: GET /<namespace>/<método>?<parámetro1 JSON>&<parámetro2 JSON>,
 * cada parámetro en orden y codificado como URL. Responde `{"data": ...}`.
 *
 * Igual que las conexiones de clip crew, la URL la da el administrador (suele
 * ser una IP de la red local), así que no pasa por la protección SSRF del
 * scraper: solo se llama a ESA URL y solo a estas rutas.
 */

class ErrorJd extends crew.ErrorCrew {}

async function ajustes() {
  const d = await crew.datos();
  return d.jdownloader || { url: '' };
}

async function llamar(base, ruta, parametros = []) {
  const query = parametros.map(p => encodeURIComponent(JSON.stringify(p))).join('&');
  let r;
  try {
    r = await fetch(`${base}${ruta}${query ? `?${query}` : ''}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(config.crew.timeoutMs),
    });
  } catch (error) {
    throw new ErrorJd(
      error.name === 'TimeoutError'
        ? 'JDownloader no responde (tiempo agotado). ¿La URL y el puerto son correctos?'
        : 'No se pudo conectar con JDownloader. ¿Está encendido y con la API activada?',
      502
    );
  }
  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    cuerpo = null;
  }
  if (r.status !== 200 || !cuerpo || !('data' in cuerpo)) {
    throw new ErrorJd(`JDownloader respondió con un error (${r.status}).`, 502);
  }
  return cuerpo.data;
}

/** Comprueba la URL. Nunca lanza: {ok, version, carpeta} o {ok: false, error}. */
async function probar(url) {
  let base;
  try {
    base = crew.normalizarUrl(url);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  try {
    const version = await llamar(base, '/jd/version');
    const carpeta = await llamar(base, '/config/get', [
      'org.jdownloader.settings.GeneralSettings',
      null,
      'DefaultDownloadFolder',
    ]);
    return { ok: true, version, carpeta };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * `biblioteca`: id de la biblioteca de clipkeeper que es la carpeta de descargas de JDownloader
 * (la misma carpeta vista desde las dos máquinas). Sus subcarpetas se ofrecen como destino.
 */
async function guardar({ url = '', autostart = true, biblioteca = null } = {}) {
  const limpia = String(url).trim() ? crew.normalizarUrl(url) : '';
  const id =
    Number.isInteger(Number(biblioteca)) && biblioteca !== null && biblioteca !== ''
      ? Number(biblioteca)
      : null;
  await crew.cambiar(d => {
    d.jdownloader = { url: limpia, autostart: autostart !== false, biblioteca: id };
  });
  return ajustes();
}

/** Subcarpeta relativa segura: sin «..», sin barras al principio ni caracteres raros. */
function limpiarSubcarpeta(texto) {
  const partes = String(texto || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(p => p.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
    .filter(p => p && p !== '.' && p !== '..');
  return partes.join('/').slice(0, 200);
}

/**
 * Manda enlaces a JDownloader. `carpeta` es relativa a la carpeta de descargas
 * de JDownloader (p. ej. el nombre de la actriz); `origen` es la página de
 * donde salieron, para que JDownloader la use como referencia.
 */
async function enviar({ links, carpeta = '', paquete = '', origen = '' } = {}) {
  const { url, autostart = true } = await ajustes();
  if (!url) throw new ErrorJd('JDownloader no está configurado (pestaña Ajustes).', 409);
  const lista = (Array.isArray(links) ? links : [])
    .map(l => String(l).trim())
    .filter(l => /^https?:\/\//i.test(l))
    .slice(0, 500);
  if (lista.length === 0) throw new ErrorJd('No hay enlaces válidos para enviar.');
  const consulta = { links: lista.join('\n'), autostart: Boolean(autostart), deepDecrypt: false };
  const sub = limpiarSubcarpeta(carpeta);
  if (sub) {
    const base = String(
      await llamar(url, '/config/get', [
        'org.jdownloader.settings.GeneralSettings',
        null,
        'DefaultDownloadFolder',
      ])
    ).replace(/\/+$/, '');
    consulta.destinationFolder = `${base}/${sub}`;
    consulta.overwritePackagizerRules = true;
  }
  const nombre = String(paquete || '')
    .trim()
    .slice(0, 200);
  if (nombre) consulta.packageName = nombre;
  if (/^https?:\/\//i.test(String(origen))) consulta.sourceUrl = String(origen).slice(0, 2000);
  const trabajo = await llamar(url, '/linkgrabberv2/addLinks', [consulta]);
  return { ok: true, enviados: lista.length, carpeta: consulta.destinationFolder || null, trabajo };
}

module.exports = { ajustes, guardar, probar, enviar, limpiarSubcarpeta, ErrorJd };
