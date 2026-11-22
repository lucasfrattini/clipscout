'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const logger = require('../lib/logger');
const { claveEnlace } = require('../lib/url');
const { calidadDe, llevaNombre, tituloParecido } = require('../lib/recoger');
const { normalizar } = require('../lib/filtros');

/**
 * NU-6 «Mejorar calidad» (contrato C5). clipkeeper manda los vídeos de poca resolución (persona,
 * título, duración, alto) y clipscout busca la MISMA escena en mejor calidad: misma persona, título
 * parecido, duración ±3 % y más alto que el actual (deducido del título o la dirección, como en
 * «Recoger»). Como mucho 3 candidatos por vídeo. Es un trabajo en segundo plano: clipkeeper
 * pregunta por él y, cuando la persona elige, `enviar` los manda a la carpeta del vídeo con
 * `sustituye_video_id` en lo esperado (C2), para que el nuevo pase a ser su calidad principal.
 *
 * Una búsqueda por persona (no por vídeo): con 200 vídeos de la misma persona serían 200 búsquedas
 * iguales. Los que no tienen persona se buscan por su título.
 */

const MAX_ITEMS = 200;
const trabajos = new Map();

/** Calidad deducida → alto en píxeles (0 = no se sabe). */
const ALTOS = [0, 720, 1080, 1440, 2160];
const altoDe = item => ALTOS[calidadDe(item)] || 0;

const texto = (v, max = 300) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function limpiarItem(it = {}) {
  const id = it.video_id;
  if (id === null || id === undefined || id === '') return null;
  const n = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    video_id: id,
    titulo: texto(it.titulo),
    personas: (Array.isArray(it.personas) ? it.personas : [])
      .map(p => texto(p?.nombre ?? p, 120))
      .filter(Boolean)
      .slice(0, 10),
    duracion: n(it.duracion),
    alto: n(it.alto) ?? 0,
    biblioteca_id: Number.isInteger(Number(it.biblioteca_id)) ? Number(it.biblioteca_id) : null,
    carpeta: texto(it.carpeta, 500),
  };
}

/**
 * Los candidatos de un vídeo entre los resultados de una búsqueda. Pura. `nombres`: la persona y
 * sus alias (vale cualquiera); vacío si el vídeo no tiene persona.
 */
function candidatosPara(item, resultados, { nombres = [], sitios = new Map() } = {}) {
  const vistos = new Set();
  const lista = [];
  for (const r of resultados || []) {
    const url = r.sourceUrl || r.url;
    if (!url) continue;
    const k = claveEnlace(url);
    if (vistos.has(k)) continue;
    if (nombres.length && !nombres.some(n => llevaNombre(r, n))) continue;
    if (item.titulo && !tituloParecido(item.titulo, r.title || '')) continue;
    const d = r.durationSeconds;
    if (!Number.isFinite(item.duracion) || !Number.isFinite(d)) continue;
    if (Math.abs(d - item.duracion) > item.duracion * 0.03) continue;
    const alto = altoDe(r);
    if (!(alto > (item.alto || 0))) continue;
    vistos.add(k);
    lista.push({
      url,
      titulo: r.title || '',
      sitio: sitios.get(r.sitio) || r.sitio || '',
      duracion: d,
      alto,
      miniatura: r.thumbnail || null,
    });
  }
  lista.sort(
    (a, b) =>
      b.alto - a.alto || Math.abs(a.duracion - item.duracion) - Math.abs(b.duracion - item.duracion)
  );
  return lista.slice(0, config.mejorar.candidatos);
}

/** Una búsqueda en todos los sitios, con tope de tiempo; devuelve resultados y nombres de sitio. */
async function buscarPorDefecto(q, { alias = [] } = {}) {
  const { buscarEnTodos } = require('./busqueda');
  const resultados = [];
  const sitios = new Map();
  const signal = AbortSignal.timeout(config.mejorar.busquedaMs);
  await buscarEnTodos(
    { q, paginas: config.mejorar.paginas, web: false, alias },
    {
      contar: false,
      signal,
      emit: ev => {
        if (ev.type === 'sitios') for (const s of ev.sitios || []) sitios.set(s.id, s.nombre);
        else if (ev.type === 'resultados') {
          for (const it of ev.items || []) resultados.push({ ...it, sitio: ev.sitio });
        }
      },
    }
  );
  return { resultados, sitios };
}

/** Se cambia en las pruebas (sin sitios de verdad). */
let buscar = buscarPorDefecto;
const usarBusqueda = fn => {
  buscar = fn || buscarPorDefecto;
};

const clave = s =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function trabajar(t) {
  // Grupos: por la primera persona del vídeo; sin persona, cada título por su cuenta.
  const grupos = new Map();
  for (const it of t.items) {
    const k = it.personas[0] ? `p:${clave(it.personas[0])}` : `t:${clave(it.titulo)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  const personas = require('./personas');
  for (const items of grupos.values()) {
    const persona = items[0].personas[0] || '';
    const q = persona || items[0].titulo;
    let propuestas = items.map(it => ({ video_id: it.video_id, candidatos: [] }));
    if (q) {
      try {
        const { alias } = persona ? await personas.aliasDe(persona) : { alias: [] };
        const { resultados, sitios } = await buscar(q, { alias });
        propuestas = items.map(it => ({
          video_id: it.video_id,
          candidatos: candidatosPara(it, resultados, {
            nombres: persona ? [persona, ...alias] : [],
            sitios,
          }),
        }));
      } catch (error) {
        logger.warn(`Mejorar calidad «${q}»: ${error.message}`);
      }
    }
    t.propuestas.push(...propuestas);
    t.hechos += items.length;
  }
  t.estado = 'hecho';
}

/** POST /mejorar → `{trabajo}` (202). */
function iniciar(cuerpo = {}) {
  const entrada = Array.isArray(cuerpo.items) ? cuerpo.items : null;
  if (!entrada || entrada.length === 0 || entrada.length > MAX_ITEMS) {
    const error = new Error(`Se esperaba una lista de 1 a ${MAX_ITEMS} vídeos.`);
    error.status = 400;
    throw error;
  }
  const items = entrada.map(limpiarItem).filter(Boolean);
  if (!items.length) {
    const error = new Error('Cada vídeo necesita su video_id.');
    error.status = 400;
    throw error;
  }
  const id = crypto.randomUUID();
  const t = { id, estado: 'buscando', hechos: 0, total: items.length, items, propuestas: [] };
  trabajos.set(id, t);
  while (trabajos.size > config.mejorar.maxTrabajos) {
    trabajos.delete(trabajos.keys().next().value);
  }
  trabajar(t).catch(error => {
    t.estado = 'error';
    t.error = error.message;
    logger.warn(`Mejorar calidad: ${error.message}`);
  });
  return { trabajo: id };
}

function obtener(id) {
  const t = trabajos.get(String(id));
  if (!t) {
    const error = new Error('Ese trabajo ya no existe.');
    error.status = 404;
    throw error;
  }
  return t;
}

/** GET /mejorar/{trabajo}. */
function estado(id) {
  const t = obtener(id);
  return {
    estado: t.estado,
    hechos: t.hechos,
    total: t.total,
    propuestas: t.propuestas,
    ...(t.error ? { error: t.error } : {}),
  };
}

/**
 * POST /mejorar/{trabajo}/enviar `{elegidos: [{video_id, url}]}`: solo candidatos propuestos en
 * ese trabajo. Uno por carpeta de destino (un paquete por carpeta), con `sustituye_video_id`.
 */
async function enviar(id, cuerpo = {}) {
  const t = obtener(id);
  const elegidos = Array.isArray(cuerpo.elegidos) ? cuerpo.elegidos.slice(0, MAX_ITEMS) : [];
  const fallos = [];
  const porCarpeta = new Map();
  for (const e of elegidos) {
    const item = t.items.find(x => String(x.video_id) === String(e?.video_id));
    const prop = t.propuestas.find(x => String(x.video_id) === String(e?.video_id));
    const cand = prop?.candidatos.find(c => claveEnlace(c.url) === claveEnlace(e?.url));
    if (!item || !cand) {
      fallos.push({
        video_id: e?.video_id ?? null,
        url: e?.url ?? null,
        error: 'No es un candidato de este trabajo.',
      });
      continue;
    }
    const k = `${item.biblioteca_id}|${item.carpeta}`;
    if (!porCarpeta.has(k)) porCarpeta.set(k, []);
    porCarpeta.get(k).push({ item, cand });
  }
  let enviados = 0;
  const jd = require('./jdownloader');
  for (const grupo of porCarpeta.values()) {
    const { item } = grupo[0];
    try {
      const r = await jd.enviar({
        links: grupo.map(g => g.cand.url),
        titulos: grupo.map(g => g.item.titulo || g.cand.titulo),
        items: grupo.map(g => ({
          titulo: g.item.titulo || g.cand.titulo,
          personas: g.item.personas,
          duracion: g.cand.duracion,
          sustituye_video_id: g.item.video_id,
        })),
        carpeta: item.carpeta,
        paquete: grupo.length === 1 ? item.titulo || 'clipscout' : item.carpeta.split('/').pop(),
        bibliotecaId: item.biblioteca_id,
      });
      enviados += r.enviados;
    } catch (error) {
      for (const g of grupo) {
        fallos.push({ video_id: g.item.video_id, url: g.cand.url, error: error.message });
      }
    }
  }
  return { enviados, fallos };
}

module.exports = { iniciar, estado, enviar, candidatosPara, altoDe, usarBusqueda, MAX_ITEMS };
