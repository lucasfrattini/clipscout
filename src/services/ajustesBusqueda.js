'use strict';

const config = require('../config');
const crew = require('./crew');

/**
 * Ajustes de la búsqueda web y de la red, editables desde Ajustes (nada fijo en el código):
 *
 * - `searxngUrl`: el SearXNG propio para la búsqueda «site:» (vacío = sin búsqueda web).
 * - `motores`: qué buscadores consulta SearXNG (los que bloquean, fuera). Lista separada por comas.
 * - `webPaginas`: páginas de resultados del buscador por sitio.
 * - `sinProxy`: dominios que van directos, sin la VPN (bloquean su salida).
 *
 * Los valores del entorno (.env) son solo los de partida: lo guardado en Ajustes manda. Se
 * guardan en data/crew.json junto al resto de ajustes, y se aplican en caliente: el cliente HTTP lee
 * `config.outboundProxyBypass` en cada petición, y el navegador se reinicia para coger la lista.
 */

const DEFECTO = () => ({
  searxngUrl: config.busqueda.searxngUrl,
  motores: config.busqueda.webMotores,
  webPaginas: config.busqueda.webPaginas,
  sinProxy: [...config.outboundProxyBypass],
});

function limpiarDominios(lista) {
  const valores = Array.isArray(lista) ? lista : String(lista || '').split(/[\s,]+/);
  return [
    ...new Set(
      valores
        .map(d =>
          String(d)
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '')
            .replace(/^\*?\./, '')
            .replace(/^www\./, '')
        )
        .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    ),
  ];
}

function limpiarMotores(texto) {
  return String(texto || '')
    .split(/[\s,]+/)
    .map(m => m.trim().toLowerCase())
    .filter(m => /^[a-z0-9 _-]+$/.test(m))
    .join(',');
}

/** Aplica a la configuración en memoria lo que usan los demás módulos. */
function aplicar(a) {
  config.busqueda.searxngUrl = a.searxngUrl;
  config.busqueda.webMotores = a.motores;
  config.busqueda.webPaginas = a.webPaginas;
  config.outboundProxyBypass.splice(0, config.outboundProxyBypass.length, ...a.sinProxy);
}

async function leer() {
  const d = await crew.datos();
  return { ...DEFECTO(), ...(d.busqueda || {}) };
}

/** Al arrancar: lo guardado en Ajustes pasa a la configuración en memoria. */
async function cargar() {
  aplicar(await leer());
}

async function guardar(cambios = {}) {
  const actual = await leer();
  const nuevo = {
    searxngUrl:
      cambios.searxngUrl === undefined
        ? actual.searxngUrl
        : String(cambios.searxngUrl).trim()
          ? crew.normalizarUrl(cambios.searxngUrl)
          : '',
    motores: cambios.motores === undefined ? actual.motores : limpiarMotores(cambios.motores),
    webPaginas:
      cambios.webPaginas === undefined
        ? actual.webPaginas
        : Math.min(5, Math.max(1, Number.parseInt(cambios.webPaginas, 10) || 1)),
    sinProxy: cambios.sinProxy === undefined ? actual.sinProxy : limpiarDominios(cambios.sinProxy),
  };
  const cambiaProxy = nuevo.sinProxy.join(',') !== actual.sinProxy.join(',');
  await crew.cambiar(d => {
    d.busqueda = nuevo;
  });
  aplicar(nuevo);
  if (cambiaProxy) {
    // El navegador lee la lista al arrancar: se cierra y el siguiente uso lo abre con la nueva.
    const { pool } = require('../lib/browser');
    await pool.close().catch(() => {});
  }
  return nuevo;
}

/** Prueba el SearXNG: ¿responde en JSON y con qué buscadores? Nunca lanza. */
async function probar(url, motores) {
  let base;
  try {
    base = crew.normalizarUrl(url);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  try {
    const q = new URLSearchParams({ q: 'test', format: 'json' });
    if (motores) q.set('engines', limpiarMotores(motores));
    const r = await fetch(`${base}/search?${q}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const d = await r.json();
    return {
      ok: true,
      resultados: (d.results || []).length,
      sinRespuesta: (d.unresponsive_engines || []).map(e => `${e[0]}: ${e[1]}`),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { leer, cargar, guardar, probar, limpiarDominios, limpiarMotores };
