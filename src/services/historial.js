'use strict';

const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { crearAlmacen } = require('../lib/almacen');
const { normalizar } = require('../lib/filtros');

/**
 * Historial de búsquedas (CS-N9): lo último que se buscó a mano, para repetirlo con un toque desde
 * Buscar. En el servidor (data/historial.json) y no en el navegador: se ve igual desde el móvil y
 * desde el ordenador. La misma búsqueda escrita de otra forma (mayúsculas, tildes, espacios) es
 * una sola, que sube arriba y cuenta las veces. Se puede borrar entero o una a una.
 */

const MAX = 30;

const almacen = crearAlmacen(
  () => path.join(config.datos.dir, 'historial.json'),
  () => ({ version: 1, busquedas: [] }),
  { copia: false }
);

const claveDe = q => normalizar(q).replace(/\s+/g, ' ').trim();

/** Apunta una búsqueda (nunca lanza: el historial no debe impedir buscar). */
async function apuntar(q) {
  const texto = String(q || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  if (!texto) return;
  try {
    await almacen.cambiar(d => {
      const clave = claveDe(texto);
      const previa = (d.busquedas || []).find(b => claveDe(b.q) === clave);
      const resto = (d.busquedas || []).filter(b => claveDe(b.q) !== clave);
      d.busquedas = [
        { q: texto, fecha: new Date().toISOString(), veces: (previa?.veces || 0) + 1 },
        ...resto,
      ].slice(0, MAX);
    });
  } catch (error) {
    logger.warn(`Historial: ${error.message}`);
  }
}

async function listar() {
  return { busquedas: (await almacen.leer()).busquedas || [] };
}

/** «Deshacer» de «Borrar el historial» (SU-UX-011): vuelve a poner lo que había. */
async function restaurar(lista) {
  const validas = (Array.isArray(lista) ? lista : [])
    .filter(b => b && typeof b.q === 'string' && b.q.trim())
    .slice(0, MAX)
    .map(b => ({
      q: b.q.trim().slice(0, 300),
      fecha: typeof b.fecha === 'string' ? b.fecha : new Date().toISOString(),
      veces: Number.isInteger(b.veces) && b.veces > 0 ? b.veces : 1,
    }));
  return almacen.cambiar(d => {
    const ya = new Set((d.busquedas || []).map(b => claveDe(b.q)));
    d.busquedas = [...(d.busquedas || []), ...validas.filter(b => !ya.has(claveDe(b.q)))].slice(
      0,
      MAX
    );
    return { busquedas: d.busquedas };
  });
}

/** Borra una (por su texto) o, sin `q`, todo. */
async function borrar(q) {
  return almacen.cambiar(d => {
    d.busquedas = q ? (d.busquedas || []).filter(b => claveDe(b.q) !== claveDe(q)) : [];
    return { busquedas: d.busquedas };
  });
}

module.exports = { apuntar, listar, borrar, MAX, restaurar };
