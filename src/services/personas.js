'use strict';

const crew = require('./crew');
const config = require('../config');
const { normalizar } = require('../lib/filtros');

/**
 * Personas de clipkeeper (fase 7, contrato C1: `GET /api/crew/v1/personas`): nombre, alias, la
 * carpeta donde están la mayoría de sus vídeos y la carpeta de fotos. Sirven para:
 *
 * - NU-1: saber qué personas van en lo que se manda (por el término buscado y el título, con sus
 *   alias) y decírselo a clipkeeper con lo esperado (C2);
 * - NU-4: buscar y «Recoger» también por sus alias;
 * - FO-3: «Mandar a una persona» (la lista y su carpeta);
 * - proponer como destino la carpeta de la persona cuando lo buscado es ella.
 *
 * clipkeeper es el dueño de las personas: aquí solo se pide la lista y se recuerda un minuto (se
 * consulta en cada envío). Sin clipkeeper, o si no responde, lista vacía: nada se rompe.
 */

let cache = null; // { en, lista, conectado }

/** Lo que llega de clipkeeper, limpio (una versión anterior no manda `alias` ni `carpeta`). */
function limpiar(p) {
  const nombre = String(p?.nombre || '').trim();
  if (!nombre) return null;
  return {
    id: p.id ?? null,
    nombre,
    rol: String(p.rol || ''),
    alias: (Array.isArray(p.alias) ? p.alias : [])
      .map(a => String(a || '').trim())
      .filter(Boolean)
      .slice(0, 20),
    biblioteca_id: Number.isInteger(p.biblioteca_id) ? p.biblioteca_id : null,
    carpeta: typeof p.carpeta === 'string' && p.carpeta.trim() ? p.carpeta.trim() : null,
    carpeta_fotos: String(p.carpeta_fotos || '').trim() || config.fotos.carpetaFotos,
    videos: Number(p.videos) || 0,
    fotos: Number(p.fotos) || 0,
    foto: p.foto === true,
  };
}

/**
 * La lista de personas (`{conectado, personas, error?}`). `q` filtra en clipkeeper (sin acentos ni
 * mayúsculas, en nombre y alias); sin `q` se usa la caché de un minuto.
 */
async function listar({ q = '', fresca = false } = {}) {
  const termino = String(q || '').trim();
  if (!termino && !fresca && cache && Date.now() - cache.en < config.fotos.personasCacheMs) {
    return { conectado: cache.conectado, personas: cache.lista };
  }
  const { conexiones = [] } = await crew.datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) {
    cache = { en: Date.now(), lista: [], conectado: false };
    return { conectado: false, personas: [] };
  }
  const url = `${destino.url}/api/crew/v1/personas${termino ? `?q=${encodeURIComponent(termino)}` : ''}`;
  try {
    const r = await fetch(url, {
      headers: { 'X-Api-Key': destino.api_key },
      redirect: 'manual',
      signal: AbortSignal.timeout(config.crew.timeoutMs),
    });
    if (r.status !== 200) {
      // 404: un clipkeeper anterior a la fase 7. Se recuerda igual, para no preguntar en cada envío.
      if (!termino) cache = { en: Date.now(), lista: [], conectado: true };
      return { conectado: true, personas: [], error: `clipkeeper respondió ${r.status}` };
    }
    const j = await r.json();
    const lista = (Array.isArray(j?.personas) ? j.personas : []).map(limpiar).filter(Boolean);
    if (!termino) cache = { en: Date.now(), lista, conectado: true };
    return { conectado: true, personas: lista };
  } catch {
    if (!termino) cache = { en: Date.now(), lista: [], conectado: true };
    return { conectado: true, personas: [], error: 'clipkeeper no responde.' };
  }
}

const olvidar = () => {
  cache = null;
};

/** Para comparar: sin tildes, minúsculas, solo letras y números separados por un espacio. */
const plano = s =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Todos los nombres de una persona (el suyo y sus alias), sin repetir. */
function nombresDe(persona) {
  const vistos = new Set();
  const lista = [];
  for (const n of [persona?.nombre, ...(persona?.alias || [])]) {
    const k = plano(n);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    lista.push(String(n).trim());
  }
  return lista;
}

/** La persona cuyo nombre o alias es exactamente lo buscado (sin tildes ni mayúsculas), o null. */
function porTermino(termino, personas = []) {
  const q = plano(termino);
  if (q.length < 2) return null;
  return personas.find(p => nombresDe(p).some(n => plano(n) === q)) || null;
}

/**
 * ¿Nombra este texto a la persona? Por palabras enteras («Ana Pérez» en «ana-perez-playa») o, con
 * nombres de dos palabras o más, también pegado («anaperez»). Los nombres de menos de 3 letras no
 * cuentan: casarían con cualquier cosa.
 */
function nombra(texto, persona) {
  const espaciado = ` ${plano(texto)} `;
  const pegado = espaciado.replace(/\s+/g, '');
  return nombresDe(persona).some(n => {
    const k = plano(n);
    if (k.replace(/\s/g, '').length < 3) return false;
    if (espaciado.includes(` ${k} `)) return true;
    const junto = k.replace(/\s/g, '');
    return k.includes(' ') && junto.length >= 6 && pegado.includes(junto);
  });
}

/** Las personas que nombra alguno de los textos (término, título, dirección…), por nombre. */
function detectar(textos, personas = []) {
  const lista = (Array.isArray(textos) ? textos : [textos]).filter(Boolean);
  if (!lista.length) return [];
  return personas.filter(p => lista.some(t => nombra(t, p))).map(p => p.nombre);
}

/**
 * NU-4: los otros nombres de la persona que es lo buscado (vacío si no es ninguna). Para buscar
 * también por ellos y que «lleva el nombre» valga con cualquiera.
 */
async function aliasDe(termino) {
  const { personas } = await listar().catch(() => ({ personas: [] }));
  const p = porTermino(termino, personas);
  if (!p) return { persona: null, alias: [] };
  const q = plano(termino);
  return { persona: p, alias: nombresDe(p).filter(n => plano(n) !== q) };
}

module.exports = {
  aliasDe,
  listar,
  olvidar,
  nombresDe,
  porTermino,
  nombra,
  detectar,
  limpiar,
  plano,
};
