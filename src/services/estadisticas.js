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

/** Lo mismo, a partir de un enlace (se cuenta en su dominio). */
function sumarEnlace(enlace, cuentas) {
  sumar(dominioDe(enlace), cuentas);
}

/** Escribe lo acumulado. */
async function volcar() {
  if (pendiente.size === 0) return;
  const lote = pendiente;
  pendiente = new Map();
  await almacen.cambiar(d => {
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

async function ponerACero() {
  pendiente = new Map();
  await almacen.cambiar(d => {
    d.sitios = {};
    d.desde = new Date().toISOString();
  });
}

module.exports = { sumar, sumarEnlace, volcar, leer, ponerACero, dominioDe, CAMPOS };
