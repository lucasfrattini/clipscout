'use strict';

const crew = require('./crew');
const config = require('../config');
const logger = require('../lib/logger');

/**
 * NU-1, lado emisor (contrato C2: `POST /api/crew/v1/esperados` de clipkeeper). Justo después de
 * cada envío correcto al gestor de descargas se le dice a clipkeeper qué va a llegar y a qué
 * carpeta: título, personas, etiquetas, duración y la página de origen (de cada vídeo, o de cada
 * álbum de fotos). Cuando su escaneo vea el fichero nuevo, la ficha nace completa en vez de con el
 * nombre del fichero.
 *
 * Es un extra: si clipkeeper no está conectado, es anterior (404) o no responde, el envío ya está
 * hecho y no se toca; solo se apunta en el registro. Nunca lanza.
 */

const MAX_ITEMS = 500; // por petición (contrato)

const texto = (v, max = 300) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const lista = (v, max = 20) =>
  [
    ...new Set((Array.isArray(v) ? v : []).map(x => texto(x?.nombre ?? x, 120)).filter(Boolean)),
  ].slice(0, max);

/** Un item como lo espera clipkeeper (vídeo o álbum), o null si no vale. */
function limpiarItem(it = {}) {
  const origen = texto(it.origen_url, 2000);
  if (!/^https?:\/\//i.test(origen)) return null;
  const base = {
    tipo: it.tipo === 'album' ? 'album' : 'video',
    origen_url: origen,
    titulo: texto(it.titulo),
    personas: lista(it.personas),
  };
  if (base.tipo === 'album') {
    return {
      ...base,
      album: texto(it.album || it.titulo, 80),
      ...(Number.isFinite(Number(it.n_fotos)) && it.n_fotos !== null
        ? { n_fotos: Math.max(0, Math.round(Number(it.n_fotos))) }
        : {}),
    };
  }
  const duracion = Number(it.duracion);
  const sustituye = Number(it.sustituye_video_id);
  return {
    ...base,
    etiquetas: lista(it.etiquetas),
    duracion: Number.isFinite(duracion) && duracion > 0 ? duracion : null,
    sustituye_video_id:
      it.sustituye_video_id !== null &&
      it.sustituye_video_id !== undefined &&
      Number.isInteger(sustituye)
        ? sustituye
        : null,
  };
}

/**
 * Avisa a clipkeeper de lo que llegará a `carpeta` (relativa a la biblioteca `bibliotecaId`).
 * Devuelve `{conectado, ok, ids, error?}`.
 */
async function avisar({ bibliotecaId, carpeta = '', items = [] } = {}) {
  const limpios = (Array.isArray(items) ? items : []).map(limpiarItem).filter(Boolean);
  if (!limpios.length) return { conectado: false, ok: false, ids: [], error: 'nada que avisar' };
  if (
    bibliotecaId === null ||
    bibliotecaId === undefined ||
    !Number.isInteger(Number(bibliotecaId))
  ) {
    return { conectado: false, ok: false, ids: [], error: 'sin biblioteca' };
  }
  const { conexiones = [] } = await crew.datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, ok: false, ids: [] };
  const ids = [];
  try {
    for (let i = 0; i < limpios.length; i += MAX_ITEMS) {
      const r = await fetch(`${destino.url}/api/crew/v1/esperados`, {
        method: 'POST',
        headers: { 'X-Api-Key': destino.api_key, 'Content-Type': 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.crew.timeoutMs),
        body: JSON.stringify({
          biblioteca_id: Number(bibliotecaId),
          carpeta: String(carpeta || ''),
          items: limpios.slice(i, i + MAX_ITEMS),
        }),
      });
      if (r.status !== 201 && r.status !== 200) {
        if (r.status !== 404) logger.warn(`Esperados: clipkeeper respondió ${r.status}`);
        return { conectado: true, ok: false, ids, error: `clipkeeper respondió ${r.status}` };
      }
      const j = await r.json().catch(() => ({}));
      if (Array.isArray(j.ids)) ids.push(...j.ids);
    }
    return { conectado: true, ok: true, ids };
  } catch (error) {
    logger.warn(`Esperados: clipkeeper no responde (${error.message})`);
    return { conectado: true, ok: false, ids, error: 'clipkeeper no responde.' };
  }
}

/** Diagnóstico: `GET /api/crew/v1/esperados?estado=…` de clipkeeper (para «¿ya lo tengo?»). */
async function consultar(estado = 'pendiente') {
  const { conexiones = [] } = await crew.datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, items: [] };
  try {
    const r = await fetch(
      `${destino.url}/api/crew/v1/esperados?estado=${encodeURIComponent(estado)}`,
      {
        headers: { 'X-Api-Key': destino.api_key },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.crew.timeoutMs),
      }
    );
    if (r.status !== 200) return { conectado: true, items: [] };
    const j = await r.json().catch(() => ({}));
    const items = Array.isArray(j) ? j : j.esperados || j.items || [];
    return { conectado: true, items: Array.isArray(items) ? items : [] };
  } catch {
    return { conectado: true, items: [] };
  }
}

module.exports = { avisar, consultar, limpiarItem, MAX_ITEMS };
