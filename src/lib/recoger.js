'use strict';

/**
 * «Recoger» (CS-N1) y las búsquedas programadas (CS-04): LA función que decide qué se manda de lo
 * encontrado. Pura (sin red ni disco) para poder probarla entera.
 *
 * De una búsqueda de una persona o un término:
 * - un vídeo una sola vez: la misma ficha escrita de otra forma (`claveEnlace`) y los repetidos
 *   que detectó la búsqueda (`grupos`: el mismo vídeo en varios sitios). De cada grupo sale el
 *   MEJOR que pasa los filtros (el más largo o el de más calidad, según `orden`);
 * - nada de lo ya enviado (si cualquier copia del grupo se mandó, ninguna);
 * - solo lo que lleva el nombre (`soloConNombre`: todas sus palabras en el título o la dirección);
 * - duración mínima, «debe contener», «no debe contener» y las palabras siempre bloqueadas;
 * - ordenado: los más largos primero (o la mejor calidad), y como mucho `n` (lo corta quien
 *   llama, después de quitar lo que clipkeeper ya tiene).
 */

const { claveEnlace } = require('./url');
const {
  palabras,
  textoDe,
  contieneAlguna,
  bloqueadaPor,
  relevancia,
  normalizar,
} = require('./filtros');

/** Calidad que se deduce del título o la dirección: 0 sin dato, 1 HD, 2 1080p, 3 1440p, 4 4K. */
function calidadDe(item) {
  const t = ` ${normalizar(`${item?.title || ''} ${item?.sourceUrl || ''} ${item?.url || ''}`)} `;
  if (/[^a-z0-9](2160p?|4k|uhd)[^a-z0-9]/.test(t)) return 4;
  if (/[^a-z0-9](1440p?|2k|qhd)[^a-z0-9]/.test(t)) return 3;
  if (/[^a-z0-9](1080p?|fhd|full ?hd)[^a-z0-9]/.test(t)) return 2;
  if (/[^a-z0-9](720p?|hd)[^a-z0-9]/.test(t)) return 1;
  return 0;
}

/** ¿Lleva el nombre? Todas sus palabras (sin tildes ni mayúsculas) en el título o la ruta. */
function llevaNombre(item, nombre) {
  const r = relevancia(item, nombre);
  // relevancia: 70 por todas las palabras + 10 (sueltas) o + 30 (seguidas); menos de 80 = falta alguna.
  return r.relevancia === null || r.relevancia >= 80;
}

const duracionDe = it => (Number.isFinite(it?.durationSeconds) ? it.durationSeconds : -1);

/** Comparador según el orden pedido. `null`: el de la búsqueda (las programadas de antes). */
function comparador(orden) {
  if (orden === 'calidad') {
    return (a, b) => calidadDe(b) - calidadDe(a) || duracionDe(b) - duracionDe(a);
  }
  if (orden === 'largos') {
    return (a, b) => duracionDe(b) - duracionDe(a) || calidadDe(b) - calidadDe(a);
  }
  return null;
}

/**
 * @param {object[]} items      resultados de la búsqueda (url, sourceUrl, title, durationSeconds)
 * @param {object} o
 * @param {string} [o.nombre]           persona o término (para `soloConNombre`)
 * @param {boolean} [o.soloConNombre]
 * @param {'largos'|'calidad'|null} [o.orden]
 * @param {number} [o.minutosMinimo]
 * @param {boolean} [o.sinDuracion]     ¿entran los que no dicen cuánto duran? (con mínimo)
 * @param {string} [o.contener]         «una, otra»: alguna
 * @param {string} [o.excluir]          ninguna
 * @param {string[]} [o.bloqueadas]     ya pasadas por `palabras()`
 * @param {Iterable<string>} [o.yaEnviados]  enlaces (o claves) mandados antes
 * @param {object[]} [o.grupos]         repetidos de la búsqueda: [{ miembros: [url…] }]
 * @returns {{ elegidos: {link, item, claves}[], descartes: object }}
 */
function elegir(items, o = {}) {
  const contener = palabras(o.contener);
  const excluir = palabras(o.excluir);
  const minimo = (Number(o.minutosMinimo) || 0) * 60;
  const enviados = new Set([...(o.yaEnviados || [])].map(claveEnlace));
  const bloqueadas = o.bloqueadas || [];
  const nombre = String(o.nombre || '').trim();
  const enlaceDe = it => it?.sourceUrl || it?.url;

  // Grupo de cada enlace, y todas las claves de cada grupo (también las de las fichas, que es lo
  // que se manda): lo enviado de cualquier copia cuenta para todas.
  const grupoDe = new Map();
  (Array.isArray(o.grupos) ? o.grupos : []).forEach((g, i) => {
    for (const u of g?.miembros || []) grupoDe.set(claveEnlace(u), i);
  });
  // Además, el mismo título (de 3 palabras o más) en varios sitios, con duraciones que no se
  // contradicen (±2 s, o sin dato), es el mismo vídeo: la búsqueda solo agrupa por el fichero y
  // un mismo vídeo subido a dos sitios llegaba dos veces.
  let siguiente = Array.isArray(o.grupos) ? o.grupos.length : 0;
  const porTitulo = new Map(); // título normalizado → [{ g, d }]
  for (const it of items || []) {
    const link = enlaceDe(it);
    if (!link || grupoDe.has(claveEnlace(it.url)) || grupoDe.has(claveEnlace(link))) continue;
    const titulo = normalizar(it.title).replace(/\s+/g, ' ').trim();
    if (titulo.split(' ').length < 3) continue;
    const d = Number.isFinite(it.durationSeconds) ? it.durationSeconds : null;
    const lista = porTitulo.get(titulo) || [];
    let g = lista.find(x => x.d === null || d === null || Math.abs(x.d - d) <= 2)?.g;
    if (g === undefined) {
      g = siguiente;
      siguiente += 1;
      lista.push({ g, d });
      porTitulo.set(titulo, lista);
    }
    grupoDe.set(claveEnlace(link), g);
    if (it.url) grupoDe.set(claveEnlace(it.url), g);
  }
  const grupoDeItem = it =>
    grupoDe.get(claveEnlace(it?.url)) ?? grupoDe.get(claveEnlace(enlaceDe(it)));
  const clavesGrupo = new Map();
  for (const it of items || []) {
    const g = grupoDeItem(it);
    if (g === undefined || !enlaceDe(it)) continue;
    if (!clavesGrupo.has(g)) clavesGrupo.set(g, new Set());
    clavesGrupo.get(g).add(claveEnlace(enlaceDe(it)));
    if (it.url) clavesGrupo.get(g).add(claveEnlace(it.url));
  }

  const descartes = {
    repetido: 0,
    enviado: 0,
    duracion: 0,
    contener: 0,
    excluir: 0,
    bloqueada: 0,
    sinNombre: 0,
  };
  const vistos = new Set();
  const pasan = [];
  for (const it of items || []) {
    const link = enlaceDe(it);
    const clave = link ? claveEnlace(link) : '';
    if (!link || vistos.has(clave)) {
      descartes.repetido += 1;
      continue;
    }
    vistos.add(clave);
    const g = grupoDeItem(it);
    const claves = g === undefined ? [clave] : [...clavesGrupo.get(g)];
    if (claves.some(k => enviados.has(k))) {
      descartes.enviado += 1;
      continue;
    }
    const d = it.durationSeconds;
    if (Number.isFinite(d) ? d < minimo : !o.sinDuracion && minimo > 0) {
      descartes.duracion += 1;
      continue;
    }
    // Las palabras bloqueadas de Ajustes mandan sobre todo lo demás.
    if (bloqueadaPor(it, bloqueadas)) {
      descartes.bloqueada += 1;
      continue;
    }
    const texto = textoDe({ ...it, sourceUrl: link });
    if (contieneAlguna(texto, excluir)) {
      descartes.excluir += 1;
      continue;
    }
    if (contener.length && !contieneAlguna(texto, contener)) {
      descartes.contener += 1;
      continue;
    }
    if (o.soloConNombre && nombre && !llevaNombre(it, nombre)) {
      descartes.sinNombre += 1;
      continue;
    }
    pasan.push({ link, item: it, claves, g });
  }

  // De cada grupo, el mejor que pasa (sin orden pedido, el primero, como antes).
  const cmp = comparador(o.orden);
  const mejorDeGrupo = new Map();
  for (const e of pasan) {
    if (e.g === undefined) continue;
    const actual = mejorDeGrupo.get(e.g);
    if (!actual || (cmp && cmp(e.item, actual.item) < 0)) mejorDeGrupo.set(e.g, e);
  }
  const elegidos = [];
  for (const e of pasan) {
    if (e.g !== undefined && mejorDeGrupo.get(e.g) !== e) {
      descartes.repetido += 1;
      continue;
    }
    elegidos.push({ link: e.link, item: e.item, claves: e.claves });
  }
  if (cmp) elegidos.sort((a, b) => cmp(a.item, b.item));
  return { elegidos, descartes };
}

/* ── «¿Lo tengo?» contra lo que clipkeeper dice que tengo de esa persona ── */

const palabrasTitulo = s =>
  new Set(
    normalizar(s)
      .replace(/\.[a-z0-9]{2,4}$/, '')
      .split(/[^a-z0-9]+/)
      .filter(p => p.length > 1)
  );

/** Títulos parecidos: comparten al menos la mitad de las palabras del más corto. */
function tituloParecido(a, b) {
  const x = palabrasTitulo(a);
  const y = palabrasTitulo(b);
  if (x.size === 0 || y.size === 0) return false;
  let comunes = 0;
  for (const p of x) if (y.has(p)) comunes += 1;
  return comunes / Math.min(x.size, y.size) >= 0.5;
}

/**
 * El vídeo de clipkeeper (`POST /api/crew/v1/tengo`) que corresponde a este resultado, o null.
 * Contrato (FASE6-SPEC): la misma página de origen; o duración ±2 s con título parecido; o, sin
 * título, duración ±1 s.
 */
function coincidencia(item, videos) {
  const enlaces = [item?.sourceUrl, item?.url].filter(Boolean).map(claveEnlace);
  const d = item?.durationSeconds;
  const titulo = String(item?.title || '').trim();
  for (const v of videos || []) {
    if (v.origen_url && enlaces.includes(claveEnlace(v.origen_url))) return v;
    if (!Number.isFinite(d) || !Number.isFinite(v.duracion)) continue;
    const diferencia = Math.abs(d - v.duracion);
    if (titulo) {
      if (
        diferencia <= 2 &&
        (tituloParecido(titulo, v.titulo) || tituloParecido(titulo, v.fichero))
      ) {
        return v;
      }
    } else if (diferencia <= 1) return v;
  }
  return null;
}

module.exports = { elegir, calidadDe, llevaNombre, coincidencia, tituloParecido, comparador };
