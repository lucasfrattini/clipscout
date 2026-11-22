'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const crew = require('./crew');
const filtrosGlobales = require('./filtrosGlobales');
const { bloqueadaPor } = require('../lib/filtros');
const directo = require('./directo');

/**
 * Enviar enlaces a JDownloader 2 por su API local («Deprecated API», puerto
 * 3128 por defecto). Se activa en JDownloader: Ajustes avanzados →
 * `RemoteAPI: Deprecated API enabled` y `... localhost only` desactivado.
 *
 * Formato de esa API: GET /<namespace>/<método>?<parámetro1 JSON>&<parámetro2 JSON>,
 * cada parámetro en orden y codificado como URL. Responde `{"data": ...}`.
 *
 * Igual que las conexiones de Clipgeist, la URL la da el administrador (suele
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
async function enviar({
  links,
  titulos = [],
  duraciones = [],
  items = [],
  termino = '',
  carpeta = '',
  paquete = '',
  origen = '',
  regla = null,
  esperados = null,
  bibliotecaId = null,
  carpetaEsperados = null,
} = {}) {
  const { url, autostart = true, biblioteca = null } = await ajustes();
  if (!url) throw new ErrorJd('JDownloader no está configurado (pestaña Ajustes).', 409);
  const validos = (Array.isArray(links) ? links : [])
    .map((l, i) => ({
      link: String(l).trim(),
      title: Array.isArray(titulos) ? titulos[i] : '',
      duracion: Array.isArray(duraciones) ? duraciones[i] : null,
      meta: Array.isArray(items) && items[i] && typeof items[i] === 'object' ? items[i] : {},
    }))
    .filter(e => /^https?:\/\//i.test(e.link))
    .slice(0, 500);
  // Palabras siempre bloqueadas (Ajustes): no salen hacia JDownloader por ningún camino, ni
  // siquiera si la pantalla las enseñaba. Se dice cuántas se quitaron: nada en silencio.
  const prohibidas = filtrosGlobales.bloqueadas();
  const pasan = validos.filter(e => !bloqueadaPor({ title: e.title, url: e.link }, prohibidas));
  const lista = pasan.map(e => e.link);
  const bloqueados = validos.length - lista.length;
  if (lista.length === 0) {
    throw new ErrorJd(
      bloqueados
        ? `No se envió nada: los ${bloqueados} enlaces tienen palabras bloqueadas (Ajustes).`
        : 'No hay enlaces válidos para enviar.'
    );
  }
  // Un envío = UN paquete con nombre propio. Sin nombre, JDownloader arma un paquete por fichero
  // (y, con «crear subcarpeta por paquete» activo, una carpeta por fichero). Con nombre y
  // `overwritePackagizerRules`, todo va junto y a la carpeta exacta, sin carpetas en medio.
  const sub = limpiarSubcarpeta(carpeta);
  const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const nombre =
    String(paquete || '')
      .trim()
      .slice(0, 200) ||
    sub.split('/').pop() ||
    `clipscout ${fecha}`;
  const destino = sub ? `${await carpetaBase(url)}/${sub}` : null;

  // Sitios marcados «mandar el fichero directo» (Ajustes → Sitios): no se les manda la ficha,
  // que JDownloader no sabe abrir, sino el fichero, resuelto fresco y en segundo plano.
  const opciones = await directo.opcionesSitios();
  const directas = [];
  const normales = [];
  for (const l of lista) (directo.esDirecto(l, opciones) ? directas : normales).push(l);

  const estadisticas = require('./estadisticas');
  for (const l of lista) estadisticas.sumarEnlace(l, { enviadosJd: 1 });

  let trabajo = null;
  if (normales.length > 0) {
    trabajo = await anadir(url, { links: normales, paquete: nombre, destino, origen, autostart });
  }
  // Se apunta para vigilarlo: estado, fichero directo si JDownloader no puede, aviso a clipkeeper.
  const paquetes = require('./paquetesJd');
  const idPaquete = await paquetes
    .registrar({ nombre, carpeta: sub, destino, biblioteca, fichas: lista, jobIds: [trabajo?.id] })
    .catch(error => logger.warn(`No se pudo apuntar el paquete: ${error.message}`));
  if (directas.length > 0) {
    mandarDirectos(url, { fichas: directas, paquete: nombre, destino, autostart, idPaquete }).catch(
      error => logger.warn(`JDownloader: fichero directo: ${error.message}`)
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
  // NU-1 (C2): clipkeeper sabe ya qué va a llegar a esa carpeta (título, personas, etiquetas,
  // duración, origen). `esperados: false` no avisa; un array son los items ya hechos (álbumes).
  let aviso = null;
  if (esperados !== false) {
    aviso = await avisarEsperados({
      pasan,
      termino,
      regla,
      esperados,
      bibliotecaId: bibliotecaId ?? biblioteca,
      carpeta: carpetaEsperados ?? sub,
    }).catch(error => {
      logger.warn(`Esperados: ${error.message}`);
      return null;
    });
  }
  return {
    ok: true,
    esperados: aviso,
    regla: reglaGuardada,
    enviados: lista.length,
    bloqueados,
    directos: directas.length,
    carpeta: destino,
    paquete: nombre,
    trabajo,
  };
}

const nombresDe = lista =>
  (Array.isArray(lista) ? lista : [])
    .map(x => (typeof x === 'string' ? x : x?.nombre))
    .filter(Boolean);

/**
 * Los items de C2 de un envío: uno por enlace mandado (o los que da quien llama, p. ej. un álbum),
 * con las personas que nombran el término buscado, el título o la dirección (con sus alias, C1)
 * más las de la regla de la carpeta.
 */
async function avisarEsperados({ pasan, termino, regla, esperados, bibliotecaId, carpeta }) {
  if (bibliotecaId === null || bibliotecaId === undefined) return null;
  const { personas } = await require('./personas').listar();
  const { detectar } = require('./personas');
  const deRegla = nombresDe(regla?.personas);
  const etiquetasRegla = nombresDe(regla?.etiquetas);
  const unir = (...listas) => [...new Set(listas.flat().filter(Boolean))];
  const items = Array.isArray(esperados)
    ? esperados.map(it => ({
        ...it,
        personas: unir(
          nombresDe(it.personas),
          deRegla,
          detectar([termino, it.titulo, it.album, it.origen_url], personas)
        ),
      }))
    : pasan.map(e => ({
        tipo: 'video',
        origen_url: e.link,
        titulo: e.meta.titulo ?? e.title ?? '',
        duracion: e.meta.duracion ?? e.duracion ?? null,
        sustituye_video_id: e.meta.sustituye_video_id ?? null,
        personas: unir(
          nombresDe(e.meta.personas),
          deRegla,
          detectar([termino, e.meta.titulo ?? e.title, e.link], personas)
        ),
        etiquetas: unir(nombresDe(e.meta.etiquetas), etiquetasRegla),
      }));
  return require('./esperados').avisar({ bibliotecaId, carpeta, items });
}

/** La carpeta de descargas de JDownloader (sin barra final). */
async function carpetaBase(url) {
  return String(
    await llamar(url, '/config/get', [
      'org.jdownloader.settings.GeneralSettings',
      null,
      'DefaultDownloadFolder',
    ])
  ).replace(/\/+$/, '');
}

/**
 * Un `addLinks`: enlaces a un paquete con nombre y carpeta exactos. `origen` va como `sourceUrl`
 * (JDownloader lo usa como Referer: sin él, muchos CDN niegan el fichero directo).
 */
async function anadir(url, { links, paquete, destino = null, origen = '', autostart = true }) {
  const consulta = {
    links: links.join('\n'),
    autostart: Boolean(autostart),
    deepDecrypt: false,
    overwritePackagizerRules: true,
    packageName: paquete,
  };
  if (destino) consulta.destinationFolder = destino;
  if (/^https?:\/\//i.test(String(origen))) consulta.sourceUrl = String(origen).slice(0, 2000);
  const trabajo = await llamar(url, '/linkgrabberv2/addLinks', [consulta]);
  // `autostart` en addLinks no basta: JDownloader deja el paquete en el capturador si el gestor
  // de descargas está parado, o si la comprobación tarda. Así que se espera a que termine de
  // analizar los enlaces de ESTE envío, se pasan a descargas y se arranca el gestor. En segundo
  // plano: la respuesta no espera.
  if (autostart && trabajo?.id) {
    descargarCuandoEste(url, trabajo.id, { paquete, destino }).catch(error =>
      logger.warn(`JDownloader: no se pudo arrancar la descarga: ${error.message}`)
    );
  }
  return trabajo;
}

/**
 * Fichas de sitios «fichero directo»: cada una se resuelve fresca y se manda su fichero con la
 * ficha como origen, al mismo paquete y carpeta. Si no se encuentra fichero, se manda la ficha:
 * mejor que JDownloader lo intente a que se pierda sin decir nada.
 */
async function mandarDirectos(url, { fichas, paquete, destino, autostart, idPaquete }) {
  const paquetes = require('./paquetesJd');
  for (const ficha of fichas) {
    let ficheros = [];
    try {
      ficheros = await directo.resolverDirecto(ficha);
    } catch (error) {
      logger.warn(`Fichero directo de ${ficha}: ${error.message}`);
    }
    const trabajo = await anadir(url, {
      links: ficheros.length ? ficheros : [ficha],
      paquete,
      destino,
      origen: ficha,
      autostart,
    });
    if (idPaquete) {
      await paquetes.anotarTrabajo(
        idPaquete,
        trabajo?.id,
        Object.fromEntries(ficheros.map(f => [f, ficha]))
      );
    }
  }
}

/**
 * Vacía el capturador de JDownloader (lo que está analizado pero no pasó a descargas). Es una
 * acción destructiva sobre JDownloader: la interfaz la pide con confirmación.
 */
async function vaciarCapturador() {
  const { url } = await ajustes();
  if (!url) throw new ErrorJd('JDownloader no está configurado (pestaña Ajustes).', 409);
  await llamar(url, '/linkgrabberv2/clearList');
  return { ok: true };
}

const esperar = ms => new Promise(resolver => setTimeout(resolver, ms).unref?.());

/**
 * Espera a que JDownloader termine de analizar los enlaces de un envío, los pasa a la lista de
 * descargas (salvo los que da por caídos) y arranca las descargas. Solo toca los enlaces de ESE
 * envío: lo que ya hubiera en el capturador se queda como estaba.
 */
async function descargarCuandoEste(
  url,
  jobId,
  { maxMs = 180000, cadaMs = 3000, paquete = '', destino = null } = {}
) {
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
  // Hay versiones de JDownloader que no filtran por `jobUUIDs` (devuelven []): entonces se buscan
  // los paquetes de ESTE envío por nombre y carpeta, y se mueven sus enlaces en línea.
  if (ids.length === 0 && paquete) {
    const paquetes = await llamar(url, '/linkgrabberv2/queryPackages', [{ saveTo: true }]);
    const mios = (Array.isArray(paquetes) ? paquetes : [])
      .filter(p => p.name === paquete && (!destino || p.saveTo === destino))
      .map(p => p.uuid);
    if (mios.length > 0) {
      const suyos = await llamar(url, '/linkgrabberv2/queryLinks', [
        { packageUUIDs: mios, availability: true },
      ]);
      for (const l of Array.isArray(suyos) ? suyos : []) {
        if (l.availability !== 'OFFLINE') ids.push(l.uuid);
      }
    }
  }
  if (ids.length > 0) await llamar(url, '/linkgrabberv2/moveToDownloadlist', [ids, []]);
  // CS-11: si el gestor está EN PAUSA es porque lo pausó la persona: se respeta (lo enviado queda
  // en la lista de descargas y baja al reanudar). Parado o sin saberlo, se arranca como siempre.
  let estado = null;
  try {
    estado = await llamar(url, '/downloadcontroller/getCurrentState');
  } catch {
    estado = null; // versión que no lo dice: como antes
  }
  if (String(estado).toUpperCase() !== 'PAUSE') await llamar(url, '/downloadcontroller/start');
  return ids.length;
}

module.exports = {
  vaciarCapturador,
  llamar,
  anadir,
  ajustes,
  guardar,
  probar,
  enviar,
  descargarCuandoEste,
  limpiarSubcarpeta,
  ErrorJd,
};
