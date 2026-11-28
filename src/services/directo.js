'use strict';

const config = require('../config');
const crew = require('./crew');
const cacheFichas = require('./cacheFichas');
const { readProfiles } = require('./profiles');
const { hostDe } = require('./web');
const { parseExtensionList } = require('../lib/url');

/**
 * Fichero directo para JDownloader: cuando JDownloader no puede con la ficha de un sitio (su
 * plugin da «Server error 404», el sitio cambió…), se le manda el enlace al FICHERO que clipscout
 * sabe sacar de esa ficha, con la ficha como origen (`sourceUrl` = Referer).
 *
 * El fichero se resuelve FRESCO: muchas URLs de fichero llevan un token que caduca en minutos, así
 * que lo de una búsqueda de hace una hora ya no vale. Solo se reutiliza lo de la caché de fichas si
 * es muy reciente (`JD_DIRECTO_FRESCO_MS`).
 *
 * Opciones por sitio (por dominio, en data/crew.json `sitios`): `jdDirecto` = mandar el fichero
 * directo desde el principio, sin esperar a que JDownloader falle. Van por dominio y no dentro del
 * perfil porque el Explorador reescribe el perfil entero al guardarlo y se las llevaría por delante.
 */

const VIDEO_POR_DEFECTO = '.mp4, .webm, .m4v, .mov';

async function opcionesSitios() {
  return (await crew.datos()).sitios || {};
}

/** Cambia las opciones de un dominio. `cambios`: `{ jdDirecto, fueraPorDefecto, fichaComoFichero, personasFicha, selectorPersonas }`. */
async function guardarOpcionesSitio(dominio, cambios = {}) {
  const host = hostDe(`https://${String(dominio || '').replace(/^https?:\/\//, '')}`);
  if (!host) throw new crew.ErrorCrew('Dominio no válido.');
  return crew.cambiar(d => {
    d.sitios = d.sitios || {};
    const actual = d.sitios[host] || {};
    if ('jdDirecto' in cambios) actual.jdDirecto = cambios.jdDirecto === true;
    if ('fueraPorDefecto' in cambios) actual.fueraPorDefecto = cambios.fueraPorDefecto === true;
    // «Pasar la página a JDownloader»: el sitio firma sus ficheros y el gestor resuelve la ficha.
    if ('fichaComoFichero' in cambios) actual.fichaComoFichero = cambios.fichaComoFichero === true;
    // «Personas en la ficha»: al enviar se lee la ficha y sus personas van a clipkeeper.
    if ('personasFicha' in cambios) actual.personasFicha = cambios.personasFicha === true;
    if ('selectorPersonas' in cambios) {
      const { limpiarSelector } = require('./personasFicha');
      const crudo = String(cambios.selectorPersonas ?? '').trim();
      const limpio = limpiarSelector(crudo);
      if (crudo && !limpio) throw new crew.ErrorCrew('Ese selector CSS no es válido.');
      if (limpio) actual.selectorPersonas = limpio;
      else delete actual.selectorPersonas;
    }
    d.sitios[host] = actual;
    return { dominio: host, ...actual };
  });
}

/**
 * ¿Este sitio queda fuera de las búsquedas que no eligen sitios? Para los que traen sobre todo
 * resultados que no son lo buscado: se puede seguir buscando en él eligiéndolo a mano.
 */
function fueraPorDefecto(dominio, opciones) {
  return opciones?.[dominio]?.fueraPorDefecto === true;
}

/** ¿Este enlace es de un sitio marcado «mandar el fichero directo»? (con las opciones ya leídas) */
function esDirecto(enlace, opciones) {
  return opciones?.[hostDe(enlace)]?.jdDirecto === true;
}

/** El perfil guardado de ese dominio (para abrir la ficha como la abre la búsqueda). */
async function perfilDe(enlace) {
  const host = hostDe(enlace);
  const perfiles = await readProfiles().catch(() => []);
  return perfiles.find(p => hostDe(p.config?.searchUrl || '') === host) || null;
}

/**
 * Los ficheros de una ficha, frescos. Lista vacía si no se encuentra ninguno; nunca los dudosos
 * (relevance.js): mandar a descargar la vista previa de otro vídeo es justo lo que no se quiere.
 */
async function resolverDirecto(ficha, { signal } = {}) {
  const guardada = cacheFichas.get(ficha);
  if (guardada && Date.now() - guardada.guardadaEn < config.jd.directoFrescoMs) {
    const ficheros = guardada.detalles.filter(d => !d.suspect).map(d => d.url);
    if (ficheros.length > 0) return ficheros;
  }
  // Perezoso: scraper arrastra el navegador y no hace falta cargarlo para lo demás.
  const { findFiles } = require('./scraper');
  const perfil = await perfilDe(ficha);
  const r = await findFiles([ficha], {
    extensions: parseExtensionList(perfil?.config?.fileExtensions || VIDEO_POR_DEFECTO),
    useJavaScript: perfil
      ? perfil.config.useJavaScript === true || perfil.config.useJavaScript === 'true'
      : config.browser.enabled,
    concurrency: 1,
    signal,
  });
  return (r.details || []).filter(d => !d.suspect).map(d => d.url);
}

module.exports = {
  opcionesSitios,
  guardarOpcionesSitio,
  esDirecto,
  fueraPorDefecto,
  resolverDirecto,
  perfilDe,
};
