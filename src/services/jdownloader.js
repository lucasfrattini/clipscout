'use strict';

const config = require('../config');
const logger = require('../lib/logger');
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
async function enviar({ links, carpeta = '', paquete = '', origen = '', regla = null } = {}) {
  const { url, autostart = true, biblioteca = null } = await ajustes();
  if (!url) throw new ErrorJd('JDownloader no está configurado (pestaña Ajustes).', 409);
  const lista = (Array.isArray(links) ? links : [])
    .map(l => String(l).trim())
    .filter(l => /^https?:\/\//i.test(l))
    .slice(0, 500);
  if (lista.length === 0) throw new ErrorJd('No hay enlaces válidos para enviar.');
  // Un envío = UN paquete con nombre propio. Sin nombre, JDownloader arma un paquete por fichero
  // (y, con «crear subcarpeta por paquete» activo, una carpeta por fichero). Con nombre y
  // `overwritePackagizerRules`, todo va junto y a la carpeta exacta, sin carpetas en medio.
  const sub = limpiarSubcarpeta(carpeta);
  const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const consulta = {
    links: lista.join('\n'),
    autostart: Boolean(autostart),
    deepDecrypt: false,
    overwritePackagizerRules: true,
    packageName:
      String(paquete || '')
        .trim()
        .slice(0, 200) ||
      sub.split('/').pop() ||
      `clipscout ${fecha}`,
  };
  if (sub) {
    const base = String(
      await llamar(url, '/config/get', [
        'org.jdownloader.settings.GeneralSettings',
        null,
        'DefaultDownloadFolder',
      ])
    ).replace(/\/+$/, '');
    consulta.destinationFolder = `${base}/${sub}`;
  }
  if (/^https?:\/\//i.test(String(origen))) consulta.sourceUrl = String(origen).slice(0, 2000);
  const trabajo = await llamar(url, '/linkgrabberv2/addLinks', [consulta]);
  // `autostart` en addLinks no basta: JDownloader deja el paquete en el capturador si el gestor
  // de descargas está parado, o si la comprobación tarda. Así que se espera a que termine de
  // analizar los enlaces de ESTE envío, se pasan a descargas y se arranca el gestor. En segundo
  // plano: la respuesta no espera.
  if (autostart && trabajo?.id) {
    descargarCuandoEste(url, trabajo.id).catch(error =>
      logger.warn(`JDownloader: no se pudo arrancar la descarga: ${error.message}`)
    );
  }
  // Carpeta nueva con persona/categoría/etiqueta: clipkeeper lo apunta para catalogar lo que llegue.
  let reglaGuardada = null;
  if (regla && sub && biblioteca !== null && biblioteca !== undefined) {
    reglaGuardada = await crew.reglaClipkeeper({
      bibliotecaId: biblioteca,
      carpeta: sub,
      personas: Array.isArray(regla.personas) ? regla.personas.slice(0, 5) : [],
      etiquetas: Array.isArray(regla.etiquetas) ? regla.etiquetas.slice(0, 5) : [],
    });
  }
  return {
    ok: true,
    regla: reglaGuardada,
    enviados: lista.length,
    carpeta: consulta.destinationFolder || null,
    paquete: consulta.packageName,
    trabajo,
  };
}

const esperar = ms => new Promise(resolver => setTimeout(resolver, ms).unref?.());

/**
 * Espera a que JDownloader termine de analizar los enlaces de un envío, los pasa a la lista de
 * descargas (salvo los que da por caídos) y arranca las descargas. Solo toca los enlaces de ESE
 * envío: lo que ya hubiera en el capturador se queda como estaba.
 */
async function descargarCuandoEste(url, jobId, { maxMs = 180000, cadaMs = 3000 } = {}) {
  const hasta = Date.now() + maxMs;
  while (Date.now() < hasta) {
    await esperar(cadaMs);
    const trabajos = await llamar(url, '/linkgrabberv2/queryLinkCrawlerJobs', [
      { jobIds: [jobId], collectorInfo: true },
    ]);
    const t = Array.isArray(trabajos) ? trabajos[0] : null;
    if (!t || (!t.crawling && !t.checking)) break;
  }
  const enlaces = await llamar(url, '/linkgrabberv2/queryLinks', [
    { jobUUIDs: [jobId], availability: true },
  ]);
  const ids = (Array.isArray(enlaces) ? enlaces : [])
    .filter(l => l.availability !== 'OFFLINE')
    .map(l => l.uuid);
  if (ids.length > 0) await llamar(url, '/linkgrabberv2/moveToDownloadlist', [ids, []]);
  await llamar(url, '/downloadcontroller/start');
  return ids.length;
}

module.exports = {
  ajustes,
  guardar,
  probar,
  enviar,
  descargarCuandoEste,
  limpiarSubcarpeta,
  ErrorJd,
};
