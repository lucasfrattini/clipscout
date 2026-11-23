'use strict';

const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { crearAlmacen } = require('../lib/almacen');

/**
 * Avisos (CS-N5): lo que pasó mientras no mirabas. Una programada que mandó algo o falló, un
 * paquete del gestor de descargas terminado o fallido, un sitio que dejó de dar resultados y una
 * búsqueda larga que terminó.
 *
 * Se guardan los últimos (data/avisos.json) con un número creciente: la interfaz pregunta «¿hay
 * algo después del N?», pone el punto de cg-ui en Actividad y, si el navegador lo permite y la
 * persona lo pidió, una notificación del sistema. El texto lo pone la interfaz (por `tipo` y
 * `params`, en su idioma); aquí no hay frases.
 */

const TIPOS = new Set([
  'programada',
  'programada_error',
  'paquete_terminado',
  'paquete_fallido',
  'sitio_roto',
  'busqueda_terminada',
]);

const almacen = crearAlmacen(
  () => path.join(config.datos.dir, 'avisos.json'),
  () => ({ version: 1, siguiente: 1, leidoHasta: 0, avisos: [] }),
  { copia: false }
);

/** Apunta un aviso. Nunca lanza: un aviso que no se guarda no debe romper lo que lo provoca. */
async function anotar(tipo, params = {}) {
  if (!TIPOS.has(tipo)) return null;
  try {
    return await almacen.cambiar(d => {
      const aviso = { id: d.siguiente || 1, tipo, fecha: new Date().toISOString(), params };
      d.siguiente = aviso.id + 1;
      d.avisos = [...(d.avisos || []), aviso].slice(-config.avisos.max);
      return aviso;
    });
  } catch (error) {
    logger.warn(`Avisos: ${error.message}`);
    return null;
  }
}

/** Los avisos después de `desde` (los más nuevos primero) y cuántos hay sin leer. */
async function listar({ desde = 0 } = {}) {
  const d = await almacen.leer();
  const todos = d.avisos || [];
  const leidoHasta = d.leidoHasta || 0;
  return {
    avisos: todos.filter(a => a.id > desde).reverse(),
    sinLeer: todos.filter(a => a.id > leidoHasta).length,
    leidoHasta,
    ultimo: todos.length ? todos[todos.length - 1].id : 0,
  };
}

/** «Limpiar» en Actividad → Avisos: los borra todos (la numeración sigue, para no repetir ids). */
async function vaciar() {
  return almacen.cambiar(d => {
    const n = (d.avisos || []).length;
    d.leidoHasta = Math.max(d.leidoHasta || 0, (d.avisos || []).at(-1)?.id || 0);
    d.avisos = [];
    return { borrados: n };
  });
}

/** Marca como leído todo hasta `hasta` (o todo). */
async function marcarLeidos(hasta) {
  return almacen.cambiar(d => {
    const ultimo = (d.avisos || []).at(-1)?.id || 0;
    const n = Number(hasta);
    d.leidoHasta = Math.max(
      d.leidoHasta || 0,
      Number.isFinite(n) && n > 0 ? Math.min(n, ultimo) : ultimo
    );
    return { ok: true, leidoHasta: d.leidoHasta };
  });
}

module.exports = { anotar, listar, marcarLeidos, vaciar, TIPOS };
