'use strict';

const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../lib/logger');
const { mapLimit } = require('../lib/concurrency');
const { hostDe } = require('./web');

/**
 * Las personas de un vídeo, leídas de su ficha en el momento de mandarlo a descargar, para que
 * clipkeeper reciba el vídeo ya con su actriz y no solo con lo que diga el título.
 *
 * Solo para los sitios que lo tienen activado (Ajustes → Sitios → «Personas en la ficha»): leer la
 * ficha es una petición más por vídeo, y no todos los sitios dicen algo útil. De la ficha salen:
 * - los datos estructurados (JSON-LD) del vídeo: `author` y `actor` de tipo persona;
 * - los enlaces que elija el selector CSS del sitio (p. ej. los de la lista de actrices), si tiene.
 *
 * Nunca lanza ni frena el envío: lo que no se pueda leer se queda sin personas, como antes.
 */

const MAX_NOMBRES = 8; // por vídeo: más que eso es una lista de relacionados, no el reparto
const MAX_SELECTOR = 300;

/** Nombre limpio, o '' si no parece un nombre (vacío, número, demasiado largo). */
function limpiarNombre(texto) {
  const n = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length < 2 || n.length > 60) return '';
  if (!/\p{L}/u.test(n)) return '';
  return n;
}

function personasJsonLd($) {
  const nombres = [];
  const deNodo = nodo => {
    for (const x of [].concat(nodo ?? [])) {
      if (x && typeof x === 'object' && (!x['@type'] || x['@type'] === 'Person')) {
        nombres.push(x.name);
      }
    }
  };
  $('script[type="application/ld+json"]').each((_, s) => {
    let datos;
    try {
      datos = JSON.parse($(s).text());
    } catch {
      return;
    }
    for (const d of [].concat(datos?.['@graph'] ?? datos)) {
      if (!d || typeof d !== 'object') continue;
      deNodo(d.author);
      deNodo(d.actor);
    }
  });
  return nombres;
}

/** Selector aceptable (texto corto, CSS válido para cheerio), o '' si no. */
function limpiarSelector(selector) {
  const s = String(selector ?? '').trim();
  if (!s || s.length > MAX_SELECTOR) return '';
  try {
    cheerio.load('<p></p>')(s);
  } catch {
    return '';
  }
  return s;
}

/** Los nombres de personas de una ficha (HTML), sin repetir y en orden de aparición. */
function nombresDeFicha(html, selector = '') {
  const $ = cheerio.load(typeof html === 'string' ? html : '');
  const crudos = personasJsonLd($);
  const sel = limpiarSelector(selector);
  if (sel) {
    $(sel).each((_, e) => {
      crudos.push($(e).attr('data-name') || $(e).text());
    });
  }
  const vistos = new Set();
  const salida = [];
  for (const c of crudos) {
    const n = limpiarNombre(c);
    const k = n.toLocaleLowerCase();
    if (!n || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(n);
    if (salida.length >= MAX_NOMBRES) break;
  }
  return salida;
}

/** ¿Hay que leer la ficha de este enlace? (el sitio tiene «Personas en la ficha») */
function activoPara(enlace, opciones) {
  return opciones?.[hostDe(enlace)]?.personasFicha === true;
}

/**
 * Añade a `e.meta.personas` de cada envío lo que diga su ficha (solo sitios activados). Modifica
 * los objetos que recibe. `leer(url, {signal})` devuelve el HTML (inyectable para las pruebas).
 */
async function completar(pasan, opciones, { leer } = {}) {
  const lector = leer || require('../lib/http').fetchHtml;
  const conFicha = pasan.filter(e => activoPara(e.link, opciones));
  await mapLimit(conFicha, config.jd.personasFichaConcurrencia, async e => {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), config.jd.personasFichaPlazoMs);
    try {
      const html = await lector(e.link, { signal: corte.signal });
      const nombres = nombresDeFicha(html, opciones[hostDe(e.link)]?.selectorPersonas);
      if (nombres.length) {
        const previas = Array.isArray(e.meta.personas) ? e.meta.personas : [];
        e.meta = { ...e.meta, personas: [...previas, ...nombres] };
      }
    } catch (error) {
      logger.warn(`Personas de la ficha: ${error.message}`, { url: e.link.slice(0, 120) });
    } finally {
      clearTimeout(reloj);
    }
  });
  return conFicha.length;
}

module.exports = { nombresDeFicha, limpiarSelector, activoPara, completar, MAX_SELECTOR };
