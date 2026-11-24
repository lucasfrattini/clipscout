'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { asDocument } = require('../lib/document');
const { toAbsoluteUrl, applySearchTerm, applyPageTemplate, claveEnlace } = require('../lib/url');
const { createLinkMatcher } = require('../lib/pattern');
const { dominioBase } = require('../lib/firmaProxy');
const { mapLimit } = require('../lib/concurrency');
const { crearAlmacen } = require('../lib/almacen');
const { readProfiles } = require('./profiles');
const { nombreCorto } = require('./busqueda');

/**
 * Fotos por persona (fase 7).
 *
 * - FO-1: buscar ÁLBUMES con la misma búsqueda, en los sitios que tienen sección de álbumes. Cada
 *   sitio lo dice en su configuración con un campo opcional, `albumSearchUrl` (plantilla con {q},
 *   como `searchUrl` en los vídeos) y, si hace falta, `albumLinkPattern` (qué enlaces de esa
 *   página son álbumes). Un sitio sin plantilla no sale.
 * - FO-2: sacar de la página de un álbum las fotos a TAMAÑO COMPLETO (el enlace a la imagen, el
 *   `data-src`, la mayor del `srcset`), recorriendo su paginación y con el navegador si el sitio lo
 *   necesita; fuera miniaturas, iconos y anuncios (por tamaño, por nombre y por dominio).
 * - FO-3: «Mandar a una persona»: cada álbum, un paquete del gestor de descargas, a
 *   `<carpeta de la persona>/<carpeta de fotos>/<álbum>` (C3), y lo esperado a clipkeeper (C2).
 * - FO-4: fuente «Web» con el SearXNG propio (imágenes), quitando lo que no nombra a la persona.
 * - FO-5: «¿Ya lo tengo?»: por la dirección del álbum (lo mandado y lo que clipkeeper ya emparejó)
 *   y por cuántas fotos se mandaron frente a las que tiene ahora.
 *
 * Como con los vídeos, clipscout no descarga nada: manda los enlaces directos al gestor.
 */

/* ── Álbumes en una página de resultados (FO-1) ──────────────────────── */

const EXT_IMAGEN = /\.(jpe?g|png|webp|gif|avif|heic|heif)(?:$|[?#])/i;
// Rutas que suelen ser álbumes cuando el sitio no da patrón propio.
const RUTA_ALBUM = /(album|galer|gallery|photo|foto|pics|pictures|imagenes|images|set)s?[/_-]/i;
const NUMERO_FOTOS =
  /(\d{1,5})\s*(?:fotos?|photos?|pics?|pictures?|images?|im[aá]genes|imgs?|p\b)/i;

/** La mejor imagen de un <img>: la mayor del `srcset`, o los `data-*` de carga diferida, o `src`. */
function mejorImagen($, img, base) {
  const $i = $(img);
  const srcset = $i.attr('data-srcset') || $i.attr('srcset') || '';
  let mejor = null;
  let ancho = -1;
  for (const parte of srcset.split(',')) {
    const [u, d] = parte.trim().split(/\s+/);
    if (!u) continue;
    const n = Number.parseFloat(d) || 1;
    if (n > ancho) {
      ancho = n;
      mejor = u;
    }
  }
  const candidato =
    mejor ||
    $i.attr('data-full') ||
    $i.attr('data-large') ||
    $i.attr('data-original') ||
    $i.attr('data-lazy-src') ||
    $i.attr('data-src') ||
    $i.attr('src');
  return toAbsoluteUrl(candidato || '', base);
}

/**
 * Los álbumes que enlaza una página de resultados: `[{url, titulo, thumbnail, n_fotos}]`.
 * Pura (HTML → lista) para poder probarla.
 */
function albumesDeHtml(html, baseUrl, { patron = '', max = config.fotos.albumesPorSitio } = {}) {
  const $ = asDocument(html);
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');
  const coincide = patron ? createLinkMatcher(patron) : null;
  const porUrl = new Map();
  $('a[href]').each((_, a) => {
    const url = toAbsoluteUrl($(a).attr('href'), baseUrl);
    if (!url || !/^https?:/i.test(url)) return;
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    const h = u.hostname.replace(/^www\./, '');
    if (h !== host && !h.endsWith(`.${host}`)) return;
    if (claveEnlace(url) === claveEnlace(baseUrl) || EXT_IMAGEN.test(u.pathname)) return;
    if (coincide ? !coincide.test(url, url) : !RUTA_ALBUM.test(`${u.pathname}/`)) return;
    const clave = claveEnlace(url);
    const previo = porUrl.get(clave) || { url, titulo: '', thumbnail: null, n_fotos: null };
    const img = $(a).find('img').first();
    if (!previo.thumbnail && img.length) previo.thumbnail = mejorImagen($, img, baseUrl);
    const titulo = (
      $(a).attr('title') ||
      img.attr('alt') ||
      $(a).text() ||
      $(a).closest('article, li, div').find('h1, h2, h3, h4').first().text() ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!previo.titulo && titulo) previo.titulo = titulo.replace(NUMERO_FOTOS, '').trim() || titulo;
    const contexto = `${$(a).text()} ${$(a).parent().text()}`;
    const n = contexto.match(NUMERO_FOTOS);
    if (previo.n_fotos === null && n) previo.n_fotos = Number(n[1]);
    porUrl.set(clave, previo);
  });
  return [...porUrl.values()]
    .filter(a => a.titulo || a.thumbnail)
    .map(a => ({ ...a, titulo: a.titulo.slice(0, 200) || new URL(a.url).pathname }))
    .slice(0, max);
}

/* ── Fotos de un álbum (FO-2) ────────────────────────────────────────── */

// Nombres que delatan una miniatura, un icono o un hueco, no una foto.
const NO_ES_FOTO =
  /(thumb|thumbnail|\/thumbs?\/|\/small\/|[_-]small\b|-\d{2,3}x\d{2,3}\.|avatar|logo|icon|sprite|banner|placeholder|blank\.|spacer|pixel\.|emoji|loading\.)/i;
// Dominios de publicidad conocidos por su nombre genérico.
const ANUNCIOS =
  /(^|\.)(ads?|adserver|adservice|adsystem|doubleclick|googlesyndication|adnxs|taboola|outbrain)\./i;

const ladoDe = v => {
  const n = Number.parseInt(String(v || ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Las fotos de una página de álbum y la página siguiente: `{fotos: [url], siguiente: url|null}`.
 * Pura. Primero los enlaces a una imagen (casi siempre la grande detrás de la miniatura); después
 * las <img> sueltas (las que no están dentro de uno de esos enlaces).
 */
function fotosDeHtml(html, baseUrl, { ladoMinimo = config.fotos.ladoMinimo } = {}) {
  const $ = asDocument(html);
  const candidatas = [];
  const vistas = new Set();
  const anadir = url => {
    if (!url || !/^https?:/i.test(url)) return;
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (NO_ES_FOTO.test(u.pathname) || ANUNCIOS.test(u.hostname)) return;
    const k = claveEnlace(url);
    if (vistas.has(k)) return;
    vistas.add(k);
    candidatas.push(url);
  };
  $('a[href]').each((_, a) => {
    const url = toAbsoluteUrl($(a).attr('href'), baseUrl);
    if (url && EXT_IMAGEN.test(new URL(url).pathname)) anadir(url);
  });
  $('img').each((_, img) => {
    const $i = $(img);
    const enlace = $i.closest('a[href]').attr('href');
    if (enlace) {
      const abs = toAbsoluteUrl(enlace, baseUrl);
      if (abs && EXT_IMAGEN.test(new URL(abs).pathname)) return; // ya está la grande
    }
    const ancho = ladoDe($i.attr('width'));
    const alto = ladoDe($i.attr('height'));
    if ((ancho !== null && ancho < ladoMinimo) || (alto !== null && alto < ladoMinimo)) return;
    const url = mejorImagen($, img, baseUrl);
    if (url && EXT_IMAGEN.test(new URL(url).pathname)) anadir(url);
  });
  // Anuncios de otros dominios: se quedan las del dominio de la página y las del dominio que lleva
  // la mayoría de las fotos (su CDN). Un banner suelto de otro sitio no pasa.
  const propio = dominioBase(new URL(baseUrl).hostname);
  const cuenta = new Map();
  for (const f of candidatas) {
    const d = dominioBase(new URL(f).hostname);
    cuenta.set(d, (cuenta.get(d) || 0) + 1);
  }
  const fotos = candidatas.filter(f => {
    const d = dominioBase(new URL(f).hostname);
    return d === propio || cuenta.get(d) >= Math.max(2, candidatas.length * 0.3);
  });
  return { fotos, siguiente: paginaSiguiente($, baseUrl) };
}

/** La página siguiente del álbum (rel=next, «siguiente», o el mismo álbum con la página + 1). */
function paginaSiguiente($, baseUrl) {
  const base = new URL(baseUrl);
  const actual = numeroPagina(base);
  let mejor = null;
  $('a[href], link[rel="next"]').each((_, a) => {
    if (mejor) return;
    const url = toAbsoluteUrl($(a).attr('href'), baseUrl);
    if (!url || claveEnlace(url) === claveEnlace(baseUrl)) return;
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.hostname !== base.hostname) return;
    const rel = String($(a).attr('rel') || '').toLowerCase();
    const texto = $(a).text().replace(/\s+/g, ' ').trim();
    if (rel.split(/\s+/).includes('next')) mejor = url;
    else if (/^(next|siguiente|sig\.?|›|»|>|→)$/i.test(texto)) mejor = url;
    else if (numeroPagina(u) === actual + 1 && mismaRuta(u, base)) mejor = url;
  });
  return mejor;
}

function numeroPagina(u) {
  const p = u.searchParams.get('page') || u.searchParams.get('p') || u.searchParams.get('pg');
  if (p && /^\d+$/.test(p)) return Number(p);
  const m = u.pathname.match(/\/(?:page|pagina)\/(\d+)\/?$/i);
  return m ? Number(m[1]) : 1;
}

/** ¿Es el mismo álbum (misma ruta sin el tramo de página)? */
function mismaRuta(a, b) {
  const limpia = u => u.pathname.replace(/\/(?:page|pagina)\/\d+\/?$/i, '').replace(/\/+$/, '');
  return limpia(a) === limpia(b);
}

/* ── Red: páginas, sitios con álbumes ────────────────────────────────── */

/** HTML de una página: con navegador si el sitio lo necesita (y está disponible), si no HTTP. */
async function obtenerHtml(url, { js = false, signal } = {}) {
  if (js && config.browser.enabled) {
    return require('../lib/browser').renderPage(url, { signal });
  }
  return require('../lib/http').fetchHtmlWithRetry(url, { signal, retries: 2 });
}

/** Sitios con álbumes: los perfiles con `albumSearchUrl` (con {q}). */
async function sitiosConAlbumes() {
  const perfiles = await readProfiles();
  return perfiles
    .map((p, id) => ({ id, nombre: nombreCorto(p.name), perfil: p }))
    .filter(s =>
      /\{(?:q|query|termino|término)(?::(?:slug|guion))?\}/i.test(
        s.perfil.config.albumSearchUrl || ''
      )
    );
}

/** El perfil del sitio de una dirección (mismo dominio base que sus plantillas), o null. */
async function perfilDe(url) {
  let d;
  try {
    d = dominioBase(new URL(url).hostname);
  } catch {
    return null;
  }
  const perfiles = await readProfiles().catch(() => []);
  return (
    perfiles.find(p =>
      [p.config.albumSearchUrl, p.config.searchUrl].some(t => {
        try {
          return dominioBase(new URL(String(t).replace(/\{[^}]*\}/g, 'x')).hostname) === d;
        } catch {
          return false;
        }
      })
    ) || null
  );
}

const conTope = (signal, ms) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

/**
 * FO-1: los álbumes de todos los sitios que tienen sección de álbumes, y (FO-4) los de la web.
 * `{albumes, sitios: [{id, nombre, total, error?}], web: {disponible, total}}`.
 */
async function buscarAlbumes(q, { signal, web = true, alias = [] } = {}) {
  const termino = String(q || '').trim();
  if (!termino) {
    const error = new Error('Escribe qué buscar');
    error.status = 400;
    throw error;
  }
  const sitios = await sitiosConAlbumes();
  const albumes = [];
  const resumen = await mapLimit(sitios, config.busqueda.sitiosALaVez, async s => {
    const c = s.perfil.config;
    try {
      const plantilla = applySearchTerm(c.albumSearchUrl, termino);
      const url = /\{page/i.test(plantilla) ? applyPageTemplate(plantilla, 1) : plantilla;
      const html = await obtenerHtml(url, {
        js: Boolean(c.useJavaScript),
        signal: conTope(signal, config.fotos.porSitioMs),
      });
      const lista = albumesDeHtml(html, url, { patron: c.albumLinkPattern || '' }).map(a => ({
        ...a,
        sitio: s.nombre,
        sitioId: s.id,
        origen: 'sitio',
      }));
      albumes.push(...lista);
      return { id: s.id, nombre: s.nombre, total: lista.length };
    } catch (error) {
      return { id: s.id, nombre: s.nombre, total: 0, error: error.message };
    }
  });
  let infoWeb = { disponible: Boolean(config.busqueda.searxngUrl), total: 0 };
  if (web && infoWeb.disponible) {
    const album = await albumWeb(termino, { signal, alias }).catch(error => {
      logger.warn(`Fotos (web): ${error.message}`);
      return null;
    });
    if (album) {
      albumes.push(album);
      infoWeb = { ...infoWeb, total: album.n_fotos };
    }
  }
  return { q: termino, albumes, sitios: resumen, web: infoWeb };
}

/* ── FO-4: fuente «Web» (SearXNG, imágenes) ──────────────────────────── */

/**
 * Las imágenes que el buscador da para ese nombre, como un «álbum» más (`origen: 'web'`, con sus
 * fotos ya dentro). Un resultado que no nombra a la persona (título, dirección de la página o de
 * la imagen, con sus alias) queda fuera: los buscadores de imágenes mezclan mucho. La palabra extra
 * de la consulta es un ajuste (Ajustes → Búsqueda; de fábrica, ninguna).
 */
async function albumWeb(q, { signal, alias = [] } = {}) {
  const base = config.busqueda.searxngUrl;
  if (!base) return null;
  const { nombra } = require('./personas');
  const persona = { nombre: q, alias };
  const extra = String(config.fotos.palabraWeb || '').trim();
  const params = new URLSearchParams({
    q: extra ? `${q} ${extra}` : q,
    format: 'json',
    categories: 'images',
  });
  const r = await fetch(`${base.replace(/\/+$/, '')}/search?${params}`, {
    signal: conTope(signal, config.busqueda.webTimeoutMs),
  });
  if (!r.ok) throw new Error(`SearXNG respondió ${r.status}`);
  const datos = await r.json();
  const fotos = [];
  const vistas = new Set();
  let portada = null;
  let pagina = null;
  for (const res of datos.results || []) {
    const img = String(res.img_src || '');
    if (!/^https?:\/\//i.test(img) || vistas.has(img)) continue;
    const texto = `${res.title || ''} ${res.url || ''} ${img} ${res.content || ''}`;
    if (!nombra(texto, persona)) continue;
    vistas.add(img);
    fotos.push(img);
    portada = portada || res.thumbnail_src || img;
    pagina = pagina || (/^https?:\/\//i.test(String(res.url || '')) ? res.url : null);
    if (fotos.length >= config.fotos.webMax) break;
  }
  if (!fotos.length) return null;
  return {
    url: pagina || img0(fotos),
    titulo: `Web · ${q}`,
    album: 'Web',
    thumbnail: portada,
    n_fotos: fotos.length,
    sitio: 'web',
    sitioId: -1,
    origen: 'web',
    fotos,
  };
}
const img0 = fotos => fotos[0];

/**
 * Fuera las imágenes de la propia web (fondos, logos: `/img/`, `/static/`…) cuando las fotos del
 * álbum se sirven desde otro servidor: son adornos de la página, no fotos del álbum.
 */
function sinAdornosDelSitio(url, fotos) {
  let propio;
  try {
    propio = new URL(url).hostname;
  } catch {
    return fotos;
  }
  const hostDe = f => {
    try {
      return new URL(f).hostname;
    } catch {
      return '';
    }
  };
  if (!fotos.some(f => hostDe(f) && hostDe(f) !== propio)) return fotos;
  return fotos.filter(
    f =>
      hostDe(f) !== propio ||
      !/\/(?:img|images|static|assets|themes?|layout|css)\//i.test(new URL(f).pathname)
  );
}

/**
 * FO-2: todas las fotos de un álbum, recorriendo su paginación (como mucho
 * `config.fotos.paginasAlbum` páginas y `maxFotosAlbum` fotos).
 */
async function extraerAlbum(url, { signal } = {}) {
  const perfil = await perfilDe(url);
  const js = Boolean(perfil?.config?.useJavaScript);
  const fotos = [];
  const vistas = new Set();
  const paginas = new Set();
  let actual = url;
  for (let i = 0; i < config.fotos.paginasAlbum && actual; i += 1) {
    if (signal?.aborted) break;
    const k = claveEnlace(actual);
    if (paginas.has(k)) break;
    paginas.add(k);
    const html = await obtenerHtml(actual, { js, signal });
    const r = fotosDeHtml(html, actual);
    let nuevas = 0;
    for (const f of r.fotos) {
      const kf = claveEnlace(f);
      if (vistas.has(kf)) continue;
      vistas.add(kf);
      fotos.push(f);
      nuevas += 1;
    }
    if (nuevas === 0 || fotos.length >= config.fotos.maxFotosAlbum) break;
    actual = r.siguiente;
  }
  const limpias = sinAdornosDelSitio(url, fotos);
  return { url, fotos: limpias.slice(0, config.fotos.maxFotosAlbum), paginas: paginas.size };
}

/* ── C3: nombre del álbum en disco ───────────────────────────────────── */

/** Sin `/ \ : * ? " < > |`, sin «..», como mucho 80 caracteres, recortado. */
function nombreAlbum(titulo) {
  const limpio = String(titulo || '')
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return limpio || 'Album';
}

/* ── FO-5: ¿ya lo tengo? ─────────────────────────────────────────────── */

const almacenEnviadas = crearAlmacen(
  () => path.join(config.datos.dir, 'fotos-enviadas.json'),
  () => ({ version: 1, albumes: {} })
);
const MAX_RECORDADOS = 3000;

async function apuntarEnviado(album) {
  await almacenEnviadas.cambiar(d => {
    d.albumes = d.albumes || {};
    d.albumes[claveEnlace(album.url)] = {
      fecha: new Date().toISOString(),
      persona: album.persona,
      album: album.album,
      n: album.n,
    };
    const claves = Object.keys(d.albumes);
    for (const k of claves.slice(0, Math.max(0, claves.length - MAX_RECORDADOS))) {
      delete d.albumes[k];
    }
  });
}

/**
 * Para cada álbum: `{url, estado: 'tengo'|'faltan'|'en_camino'|null, n, fecha}`.
 * - Mandado antes con tantas fotos como tiene ahora (o más): «tengo»; con menos: «faltan».
 * - clipkeeper ya lo emparejó (C2, por la dirección): «tengo»; lo espera aún: «en_camino».
 */
async function yaLoTengo(albumes = []) {
  const { albumes: enviados = {} } = await almacenEnviadas.leer();
  const esperados = require('./esperados');
  const [emparejados, pendientes] = await Promise.all([
    esperados.consultar('emparejado'),
    esperados.consultar('pendiente'),
  ]);
  const porUrl = lista =>
    new Map(
      (lista.items || [])
        .filter(x => x && (x.tipo === 'album' || x.album))
        .map(x => [claveEnlace(x.origen_url), x])
    );
  const ok = porUrl(emparejados);
  const espera = porUrl(pendientes);
  return albumes.map(a => {
    const k = claveEnlace(a?.url);
    const previo = enviados[k];
    const n = Number(a?.n_fotos);
    if (ok.has(k)) {
      const e = ok.get(k);
      const tiene = Number(e.n_fotos ?? previo?.n);
      return {
        url: a.url,
        estado: Number.isFinite(n) && Number.isFinite(tiene) && tiene < n ? 'faltan' : 'tengo',
        n: Number.isFinite(tiene) ? tiene : null,
        fecha: previo?.fecha || null,
      };
    }
    if (previo) {
      const tiene = Number(previo.n);
      return {
        url: a.url,
        estado: Number.isFinite(n) && Number.isFinite(tiene) && tiene < n ? 'faltan' : 'tengo',
        n: Number.isFinite(tiene) ? tiene : null,
        fecha: previo.fecha,
      };
    }
    if (espera.has(k)) return { url: a.url, estado: 'en_camino', n: null, fecha: null };
    return { url: a.url, estado: null, n: null, fecha: null };
  });
}

/* ── FO-3: mandar a una persona (trabajo en segundo plano) ───────────── */

const trabajos = new Map();
const MAX_TRABAJOS = 20;

/** Lo que llega de la interfaz, limpio. Las fotos de un «álbum» solo valen si es de la web. */
function limpiarAlbumes(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter(a => a && /^https?:\/\//i.test(String(a.url || '')))
    .slice(0, config.fotos.maxMandar)
    .map(a => ({
      url: String(a.url).slice(0, 2000),
      titulo: String(a.titulo || '').slice(0, 200),
      n_fotos: Number.isFinite(Number(a.n_fotos)) ? Number(a.n_fotos) : null,
      origen: a.origen === 'web' ? 'web' : 'sitio',
      fotos:
        a.origen === 'web' && Array.isArray(a.fotos)
          ? a.fotos
              .map(String)
              .filter(f => /^https?:\/\//i.test(f))
              .slice(0, config.fotos.maxFotosAlbum)
          : null,
    }));
}

/** La persona de destino: de la lista de clipkeeper (C1) si está, o lo que llegue. */
async function personaDestino(entrada = {}) {
  if (typeof entrada === 'string') entrada = { nombre: entrada };
  const nombre = String(entrada.nombre || entrada.persona || '').trim();
  if (!nombre) {
    const error = new Error('Elige a qué persona mandarlo.');
    error.status = 400;
    throw error;
  }
  const { personas } = await require('./personas').listar();
  const p = personas.find(x => x.nombre === nombre) || {};
  const carpeta = String(entrada.carpeta ?? p.carpeta ?? '').trim() || `People/${nombre}`;
  return {
    nombre,
    carpeta: require('./jdownloader').limpiarSubcarpeta(carpeta),
    carpetaFotos:
      String(entrada.carpeta_fotos || p.carpeta_fotos || '').trim() || config.fotos.carpetaFotos,
    bibliotecaId: Number.isInteger(entrada.biblioteca_id)
      ? entrada.biblioteca_id
      : (p.biblioteca_id ?? null),
  };
}

/** Manda un álbum: sus fotos (las extrae si hace falta) en UN paquete, y lo esperado (C2). */
async function mandarAlbum(album, persona, { signal } = {}) {
  const jd = require('./jdownloader');
  const fotos = album.fotos || (await extraerAlbum(album.url, { signal })).fotos;
  if (!fotos.length) return { url: album.url, enviados: 0, error: 'No se encontraron fotos.' };
  const nombre = nombreAlbum(album.titulo || new URL(album.url).pathname.split('/').pop());
  // Todas las fotos de una persona juntas en `<persona>/Fotos/` (sin subcarpeta por álbum): así lo
  // pidió Lucas; clipkeeper trata lo suelto en `Fotos/` como un solo álbum.
  const r = await jd.enviar({
    links: fotos,
    carpeta: `${persona.carpeta}/${persona.carpetaFotos}`,
    paquete: nombre,
    origen: album.url,
    bibliotecaId: persona.bibliotecaId,
    carpetaEsperados: persona.carpeta,
    esperados: [
      {
        tipo: 'album',
        origen_url: album.url,
        titulo: album.titulo || nombre,
        album: persona.carpetaFotos,
        personas: [persona.nombre],
        n_fotos: fotos.length,
      },
    ],
  });
  await apuntarEnviado({ url: album.url, persona: persona.nombre, album: nombre, n: r.enviados });
  return { url: album.url, album: nombre, enviados: r.enviados, carpeta: r.carpeta };
}

/** FO-3: `{trabajo}`; el progreso con `estado(id)`. */
async function mandar({ persona, albumes } = {}) {
  const destino = await personaDestino(persona);
  const lista = limpiarAlbumes(albumes);
  if (!lista.length) {
    const error = new Error('Elige algún álbum.');
    error.status = 400;
    throw error;
  }
  const { url } = await require('./jdownloader').ajustes();
  if (!url) {
    const error = new Error('JDownloader no está configurado (pestaña Ajustes).');
    error.status = 409;
    throw error;
  }
  const id = crypto.randomUUID();
  const t = {
    id,
    estado: 'mandando',
    hechos: 0,
    total: lista.length,
    resultados: [],
    persona: destino.nombre,
  };
  trabajos.set(id, t);
  while (trabajos.size > MAX_TRABAJOS) trabajos.delete(trabajos.keys().next().value);
  (async () => {
    for (const album of lista) {
      try {
        t.resultados.push(await mandarAlbum(album, destino));
      } catch (error) {
        t.resultados.push({ url: album.url, enviados: 0, error: error.message });
      }
      t.hechos += 1;
    }
    t.estado = 'hecho';
  })().catch(error => {
    t.estado = 'error';
    t.error = error.message;
  });
  return { trabajo: id };
}

function estado(id) {
  const t = trabajos.get(String(id));
  if (!t) {
    const error = new Error('Ese envío ya no existe.');
    error.status = 404;
    throw error;
  }
  return t;
}

/** Espera a que acabe un trabajo (para las pruebas). */
async function esperar(id, maxMs = 10000) {
  const hasta = Date.now() + maxMs;
  while (Date.now() < hasta) {
    const t = estado(id);
    if (t.estado !== 'mandando') return t;
    await new Promise(r => setTimeout(r, 20));
  }
  return estado(id);
}

module.exports = {
  albumesDeHtml,
  fotosDeHtml,
  buscarAlbumes,
  albumWeb,
  extraerAlbum,
  nombreAlbum,
  yaLoTengo,
  mandar,
  mandarAlbum,
  estado,
  esperar,
  sitiosConAlbumes,
  limpiarAlbumes,
};
