/**
 * Modelo de la pantalla Buscar (CS-22): lo que decide QUÉ se ve de lo encontrado, sin DOM ni
 * estado propio. Vivía como funciones sueltas dentro de `createBuscarView` (una función de más de
 * 2.000 líneas) y no se podía probar; ahora la vista le pasa su estado y pinta lo que sale.
 * Pruebas en `tests/fase4-buscar-modelo.test.js`.
 */

import { contieneAlguna, textoDe } from './filtros.js';
import { plegarAlbumes } from './albumes.js';

/**
 * Qué escribió la persona en la caja única: un enlace (se sacan sus vídeos), un dominio suelto
 * («ejemplo.com»: se ofrece agregarlo como sitio) o un nombre / una palabra (se busca en todos).
 */
const ES_ENLACE = /^(?:https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S+)$/i;
const ES_DOMINIO = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/?$/i;

export function tipoDeEntrada(texto) {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'palabra';
  // Uno o varios enlaces (como en la antigua pestaña Vídeos): se sacan sus vídeos.
  if (partes.every(p => ES_ENLACE.test(p))) return 'enlace';
  if (partes.length === 1 && ES_DOMINIO.test(partes[0])) return 'dominio';
  return 'palabra';
}

/** Un nombre legible a partir de la dirección (para lo que llega sin título). */
export function nombreDeUrl(url) {
  try {
    const ultimo = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return ultimo
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/[-_.]+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/** La ficha de un resultado (lo que se descarga y se compara con la biblioteca). */
export const enlaceDe = r => r.sourceUrl || r.url;

/** Texto normalizado de cada resultado, calculado una sola vez. */
export function crearTextoNormal() {
  const textos = new WeakMap();
  return r => {
    if (!textos.has(r)) textos.set(r, textoDe(r));
    return textos.get(r);
  };
}

/**
 * Filtros de la lista: deciden qué se MUESTRA, nunca qué se busca.
 * @typedef {object} Filtros
 * @property {boolean} ocultarTengo      lo que ya está en la biblioteca (CS-41)
 * @property {boolean} ocultarEnviados   lo ya mandado a JDownloader (CS-N7)
 * @property {Map|Set} enBiblioteca      fichas que ya están en clipkeeper
 * @property {Map|Set} enviados          fichas ya enviadas
 * @property {string[]} contener         alguna de estas frases (normalizadas)
 * @property {string[]} excluir          ninguna de estas
 * @property {boolean} soloFrase         la frase exacta, seguida
 * @property {string} idioma             '' = cualquiera
 * @property {number} minDuracion        minutos; 0 = cualquiera
 * @property {(r: object) => string} textoNormal
 */

/** Por qué un resultado no se muestra (o null). El orden es el de las explicaciones. */
export function motivoOculto(r, f) {
  if (r.bloqueada) return 'bloqueada';
  if (f.ocultarTengo && f.enBiblioteca.has(enlaceDe(r))) return 'tengo';
  if (f.ocultarEnviados && f.enviados.has(enlaceDe(r))) return 'enviado';
  if (f.excluir.length && contieneAlguna(f.textoNormal(r), f.excluir)) return 'excluir';
  if (f.contener.length && !contieneAlguna(f.textoNormal(r), f.contener)) return 'contener';
  // Sin dato (un enlace pegado no tiene término) no se oculta: no se sabe.
  if (f.soloFrase && r.frase === false) return 'frase';
  if (f.idioma && r.idioma && r.idioma !== 'dudoso' && r.idioma !== f.idioma) return 'idioma';
  if (
    f.minDuracion &&
    !(Number.isFinite(r.durationSeconds) && r.durationSeconds >= f.minDuracion * 60)
  ) {
    return 'duracion';
  }
  return null;
}

/**
 * Orden elegido ('llegada' | 'relevancia' | 'duracion'). Los que no tienen el dato van siempre al
 * final (la misma regla que la lista del Explorador); el orden de llegada desempata, así la lista
 * no baila con cada tanda.
 */
export function ordenar(lista, orden) {
  if (orden === 'llegada') return lista;
  const valor = r =>
    orden === 'relevancia'
      ? r.relevancia
      : Number.isFinite(r.durationSeconds)
        ? r.durationSeconds
        : null;
  return lista
    .map((r, i) => ({ r, i, v: valor(r) }))
    .sort((a, b) => {
      const sa = Number.isFinite(a.v);
      const sb = Number.isFinite(b.v);
      if (sa !== sb) return sa ? -1 : 1;
      return (sa && b.v - a.v) || a.i - b.i;
    })
    .map(x => x.r);
}

/**
 * Repetido = el MISMO vídeo (mismo fichero, p. ej. hallado por la búsqueda propia y por la web) o
 * una copia que detecta el servidor (`copias`: url → { representante }). Se queda el primero; los
 * vídeos distintos de un mismo álbum NO lo son. Nunca se borra nada: es una vista.
 */
export function esCopia(r, copias) {
  const c = copias.get(r.url);
  return Boolean(c && c.representante !== r.url);
}
export function plegarRepetidos(lista, copias) {
  const vistas = new Set();
  return lista.filter(r => {
    if (esCopia(r, copias) || vistas.has(r.url)) return false;
    vistas.add(r.url);
    return true;
  });
}

/**
 * Una sola pasada por pintado (CS-14): ordenar, quedarse con la pestaña, filtrar, plegar repetidos
 * y álbumes. Devuelve la lista de lo visible (`lista`), lo que se pinta (`pintar`: con «Ver
 * ocultos», también lo oculto), el motivo de cada uno, los ocultos por motivo y cuántos se
 * plegaron.
 *
 * @param {object[]} resultados todo lo encontrado, en orden de llegada
 * @param {object} e  { orden, enPestana(r), filtros: Filtros, ocultarRepetidos, copias,
 *                      albumesAbiertos, verOcultos }
 */
export function calcularLista(resultados, e) {
  const base = ordenar(resultados, e.orden).filter(e.enPestana);
  const motivos = new Map(base.map(r => [r, motivoOculto(r, e.filtros)]));
  const sinOcultos = base.filter(r => !motivos.get(r));
  const plegar = lista => (e.ocultarRepetidos ? plegarRepetidos(lista, e.copias) : lista);
  const plegada = plegar(sinOcultos);
  const conAlbumes = plegarAlbumes(plegada, e.albumesAbiertos);
  let pintar = conAlbumes.lista;
  let albumes = conAlbumes.albumes;
  if (e.verOcultos) {
    const todos = plegarAlbumes(plegar(base), e.albumesAbiertos);
    pintar = todos.lista;
    albumes = todos.albumes;
  }
  const ocultos = new Map();
  for (const m of motivos.values()) if (m) ocultos.set(m, (ocultos.get(m) || 0) + 1);
  return {
    lista: conAlbumes.lista,
    pintar,
    albumes,
    motivos,
    ocultos,
    repetidos: sinOcultos.length - plegada.length,
    enAlbumes: plegada.length - conAlbumes.lista.length,
  };
}

/** «Los N primeros» de la selección: los tamaños que tiene sentido ofrecer para `total`. */
export const tamanosPrimeros = total => [5, 10, 20, 50].filter(n => n < total);
