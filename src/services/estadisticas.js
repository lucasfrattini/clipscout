'use strict';

const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { crearAlmacen } = require('../lib/almacen');

/**
 * Rendimiento por sitio, para saber qué sitio aporta: búsquedas, resultados, cuántos con
 * duración, bloqueos, enviados a JDownloader, «ya lo tenías» y fallidos en JDownloader.
 *
 * Por DOMINIO (data/estadisticas.json, fuera de git): es lo único que tienen en común una
 * búsqueda (perfil), un envío a JDownloader (enlace) y un aviso de clipkeeper. Se acumula en
 * memoria y se escribe como mucho cada pocos segundos: una búsqueda suma por cada sitio y no
 * tiene sentido una escritura de disco por cada uno.
 */

const CAMPOS = [
  'busquedas',
  'resultados',
  'conDuracion',
  'bloqueos',
  'enviadosJd',
  'yaLoTenias',
  'fallidosJd',
];

const almacen = crearAlmacen(
  () => path.join(config.datos.dir, 'estadisticas.json'),
  () => ({ sitios: {} })
);

let pendiente = new Map(); // dominio → { campo: n }
let saludPendiente = []; // [dominio, { total, error, cuando }] en orden de llegada
let reloj = null;

function dominioDe(enlace) {
  try {
    return new URL(enlace).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Suma `cuentas` ({ campo: n }) al dominio. Se guarda al poco, en segundo plano. */
function sumar(dominio, cuentas) {
  if (!dominio) return;
  const actual = pendiente.get(dominio) || {};
  for (const [campo, n] of Object.entries(cuentas)) {
    if (!CAMPOS.includes(campo) || !Number.isFinite(n) || n === 0) continue;
    actual[campo] = (actual[campo] || 0) + n;
  }
  pendiente.set(dominio, actual);
  programarVolcado();
}

function programarVolcado() {
  if (!reloj) {
    reloj = setTimeout(() => {
      reloj = null;
      volcar().catch(error =>
        logger.warn(`No se pudieron guardar las estadísticas: ${error.message}`)
      );
    }, 2000);
    reloj.unref?.();
  }
}

/**
 * Salud por sitio (CS-17): cada búsqueda terminada en un sitio anota si dio algo. Un sitio que
 * cambia su página no da error, da «0 resultados»: si eso pasa `config.salud.cerosAviso` veces
 * seguidas, Ajustes y Actividad lo marcan con «Volver a configurar». Una búsqueda con resultados
 * lo pone a cero. Las paradas a mano y las de proxy caído no cuentan (no dicen nada del sitio).
 */
function anotarSalud(dominio, { total = 0, error = '' } = {}) {
  if (!dominio) return;
  saludPendiente.push([dominio, { total, error: String(error || '').slice(0, 300) }, Date.now()]);
  programarVolcado();
}

/** El estado de salud de un dominio tal como se guarda, con `aviso` calculado. */
function conAviso(s) {
  return s ? { ...s, aviso: (s.cerosSeguidos || 0) >= config.salud.cerosAviso } : null;
}

/** Lo mismo, a partir de un enlace (se cuenta en su dominio). */
function sumarEnlace(enlace, cuentas) {
  sumar(dominioDe(enlace), cuentas);
}

/** Escribe lo acumulado. */
async function volcar() {
  if (pendiente.size === 0 && saludPendiente.length === 0) return;
  const lote = pendiente;
  const salud = saludPendiente;
  pendiente = new Map();
  saludPendiente = [];
  await almacen.cambiar(d => {
    d.salud = d.salud || {};
    for (const [dominio, { total, error }, cuando] of salud) {
      const s = d.salud[dominio] || { cerosSeguidos: 0 };
      const fecha = new Date(cuando).toISOString();
      s.ultimaBusqueda = fecha;
      if (total > 0) {
        s.cerosSeguidos = 0;
        s.ultimaConResultados = fecha;
        s.ultimoError = '';
      } else {
        s.cerosSeguidos = (s.cerosSeguidos || 0) + 1;
        s.ultimoError = error;
        // CS-N5: el aviso, justo al cruzar el umbral (no en cada búsqueda vacía de después).
        if (s.cerosSeguidos === config.salud.cerosAviso) {
          require('./avisos').anotar('sitio_roto', { dominio });
        }
      }
      d.salud[dominio] = s;
    }
    d.sitios = d.sitios || {};
    for (const [dominio, cuentas] of lote) {
      const s = d.sitios[dominio] || {};
      for (const [campo, n] of Object.entries(cuentas)) s[campo] = (s[campo] || 0) + n;
      s.actualizado = new Date().toISOString();
      d.sitios[dominio] = s;
    }
  });
}

async function leer() {
  await volcar();
  return (await almacen.leer()).sitios || {};
}

/** dominio → { cerosSeguidos, ultimaBusqueda, ultimaConResultados, ultimoError, aviso }. */
async function leerSalud() {
  await volcar();
  const salud = (await almacen.leer()).salud || {};
  return Object.fromEntries(Object.entries(salud).map(([d, s]) => [d, conAviso(s)]));
}

async function ponerACero() {
  pendiente = new Map();
  saludPendiente = [];
  await almacen.cambiar(d => {
    d.sitios = {};
    d.salud = {};
    d.desde = new Date().toISOString();
  });
}

module.exports = {
  sumar,
  sumarEnlace,
  anotarSalud,
  leerSalud,
  volcar,
  leer,
  ponerACero,
  dominioDe,
  CAMPOS,
};
