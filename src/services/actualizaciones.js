'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { escribirJson } = require('../lib/ficheroJson');
const { compararVersiones } = require('./copia');
const { version } = require('../../package.json');

/**
 * Actualizaciones (SU-13, contrato común: docs/CREW.md).
 *
 * Se baja `https://clipgeist.com/versiones.json` como mucho una vez al día, SIN enviar nada: sin
 * parámetros, sin cookies y con un User-Agent genérico («Clipgeist»). Se puede apagar en Ajustes →
 * Sistema → Acerca de (`buscar_actualizaciones` en crew.json; encendido por defecto). Si el
 * fichero no existe (404), no hay red o llega algo raro, no se molesta a nadie: queda anotado y
 * se reintenta al día siguiente.
 *
 * Formato: {"actualizado":"AAAA-MM-DD","apps":{"clipscout":{"version","notas","url",
 * "minimas":{"clipkeeper":"…"}}, …}}. `minimas` de clipscout dice qué versión de cada app conectada
 * necesita esta: la interfaz avisa en Ajustes → Conexiones si una es más vieja.
 */

const APPS = ['clipkeeper', 'clonbuster', 'clipscout'];
const fichero = () => path.join(config.datos.dir, 'actualizaciones.json');

let reloj = null;
let enCurso = null;

async function activo() {
  const crew = require('./crew');
  const d = await crew.leer().catch(() => ({}));
  return d.buscar_actualizaciones !== false;
}

async function cambiarActivo(valor) {
  await require('./crew').cambiar(d => {
    d.buscar_actualizaciones = Boolean(valor);
  });
  return { ok: true, activo: Boolean(valor) };
}

/** En Docker se enseña la orden para actualizar en vez del enlace de descarga. */
function enDocker() {
  try {
    return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
  } catch {
    return false;
  }
}

/** Lo que importa del fichero de versiones, limpio (no se fía de lo que llega). */
function limpiar(crudo) {
  if (!crudo || typeof crudo !== 'object' || typeof crudo.apps !== 'object' || !crudo.apps) {
    return null;
  }
  const apps = {};
  for (const app of APPS) {
    const a = crudo.apps[app];
    if (!a || typeof a !== 'object' || typeof a.version !== 'string') continue;
    const minimas = {};
    for (const otra of APPS) {
      const v = a.minimas?.[otra];
      if (typeof v === 'string' && /^\d+(\.\d+){0,2}$/.test(v)) minimas[otra] = v;
    }
    apps[app] = {
      version: a.version.slice(0, 20),
      notas: typeof a.notas === 'string' ? a.notas.slice(0, 4000) : '',
      // Solo enlaces https: lo que se pinta como enlace en la interfaz.
      url: typeof a.url === 'string' && /^https:\/\//.test(a.url) ? a.url.slice(0, 500) : '',
      minimas,
    };
  }
  return {
    actualizado: typeof crudo.actualizado === 'string' ? crudo.actualizado.slice(0, 20) : '',
    apps,
  };
}

async function leerGuardado() {
  try {
    const datos = JSON.parse(await fs.promises.readFile(fichero(), 'utf8'));
    return datos && typeof datos === 'object' ? datos : {};
  } catch {
    return {}; // no existe aún, o ilegible: como si nunca se hubiera comprobado
  }
}

/**
 * Baja el fichero si toca (o si `forzar`). Nunca lanza; devuelve el estado. Con el ajuste
 * apagado no se baja nada, ni siquiera forzando.
 */
async function comprobar({ forzar = false } = {}) {
  if (!(await activo())) return estado();
  const previo = await leerGuardado();
  const ultima = Date.parse(previo.comprobado || '') || 0;
  if (!forzar && Date.now() - ultima < config.actualizaciones.cadaMs) return estado();
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const nuevo = { comprobado: new Date().toISOString(), datos: previo.datos || null, error: '' };
    try {
      const r = await fetch(config.actualizaciones.url, {
        headers: { 'User-Agent': 'Clipgeist', Accept: 'application/json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(config.actualizaciones.timeoutMs),
      });
      if (!r.ok) {
        nuevo.error = `HTTP ${r.status}`;
      } else {
        const datos = limpiar(await r.json());
        if (datos) nuevo.datos = datos;
        else nuevo.error = 'formato';
      }
    } catch (error) {
      nuevo.error = error.name === 'TimeoutError' ? 'tiempo' : 'sin_red';
    }
    if (nuevo.error) logger.debug(`Versiones: no se pudo consultar (${nuevo.error})`);
    await escribirJson(fichero(), nuevo).catch(() => {});
    return estado();
  })().finally(() => {
    enCurso = null;
  });
  return enCurso;
}

/** GET /api/actualizaciones */
async function estado() {
  const guardado = await leerGuardado();
  const propia = guardado.datos?.apps?.clipscout || null;
  const hayNueva = Boolean(propia && compararVersiones(propia.version, version) > 0);
  const docker = enDocker();
  return {
    activo: await activo(),
    actual: version,
    comprobado: guardado.comprobado || null,
    error: guardado.error || '',
    ultima: propia?.version || null,
    hay_nueva: hayNueva,
    notas: hayNueva ? propia.notas : '',
    url: hayNueva ? propia.url || 'https://clipgeist.com/descargas' : '',
    docker,
    comando: hayNueva && docker ? config.actualizaciones.comandoDocker : '',
    // Versión mínima de cada app conectada que necesita ESTA (la interfaz compara y avisa).
    minimas: propia?.minimas || {},
    // Las últimas de las otras (para «hay versión nueva de clipkeeper» si se quisiera enseñar).
    otras: Object.fromEntries(
      Object.entries(guardado.datos?.apps || {})
        .filter(([app]) => app !== 'clipscout')
        .map(([app, a]) => [app, a.version])
    ),
  };
}

/**
 * Comprobación periódica: la primera unos minutos después de arrancar (no en el arranque: que una
 * app recién abierta no salga a internet antes de que el usuario pueda apagarlo) y luego cada hora
 * se mira si ha pasado un día.
 */
function arrancar({ primeraMs = 5 * 60 * 1000, cadaMs = 60 * 60 * 1000 } = {}) {
  if (reloj) return;
  const mirar = () => comprobar().catch(() => {});
  const primera = setTimeout(mirar, primeraMs);
  primera.unref?.();
  reloj = setInterval(mirar, cadaMs);
  reloj.unref?.();
}

function parar() {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

module.exports = { comprobar, estado, cambiarActivo, activo, limpiar, arrancar, parar, enDocker };
