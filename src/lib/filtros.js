'use strict';

/**
 * Filtros de texto de los resultados: lo comparten Buscar (marcas en cada resultado), las
 * búsquedas programadas y el envío a JDownloader (palabras siempre bloqueadas).
 *
 * La interfaz tiene un espejo de `normalizar`/`palabras`/`contieneAlguna` en
 * `public/js/filtros.js` (el front no puede cargar CommonJS sin empaquetador). Un test los compara
 * con la misma batería de casos: si uno cambia sin el otro, el filtro de la pantalla y el del
 * servidor dejarían de estar de acuerdo sin dar ningún error.
 */

/** Sin tildes y en minúsculas, con guiones y guiones bajos como espacios: «Año-Nuevo» → «ano nuevo». */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
}

/** «uno, dos tres» → ['uno', 'dos tres']: se separa por comas; cada trozo es una frase. */
function palabras(texto) {
  const lista = Array.isArray(texto) ? texto : String(texto || '').split(/[,\n]/);
  return lista.map(p => normalizar(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** La primera frase de `lista` que aparece en el texto (ya normalizado), o null. */
function contieneAlguna(textoNormalizado, lista) {
  for (const p of lista) if (textoNormalizado.includes(p)) return p;
  return null;
}

/**
 * El texto con el que se compara un resultado: su título y sus direcciones. La dirección cuenta
 * porque muchas fichas llevan el título en la ruta y el título de página viene vacío.
 */
function textoDe(item) {
  if (!item) return '';
  return normalizar(`${item.title || ''} ${item.sourceUrl || ''} ${item.url || ''}`);
}

/**
 * La palabra bloqueada que contiene el resultado (o null). `lista` ya pasada por `palabras()`.
 * Va aparte de `contieneAlguna` para que quien llama no tenga que saber qué campos mirar.
 */
function bloqueadaPor(item, lista) {
  if (!lista || lista.length === 0) return null;
  return contieneAlguna(textoDe(item), lista);
}

/* ── Idioma probable ───────────────────────────────────────────────── */

/**
 * Palabras muy frecuentes de cada idioma. Es una heurística, no un detector: con títulos de
 * cuatro palabras no se puede pedir más. Por eso el resultado tiene un tercer valor, «dudoso», y
 * la interfaz NUNCA oculta un dudoso: filtrar por lo que no se sabe solo puede quitar cosas buenas
 * (la misma regla que los sliders sin dato).
 */
const FRECUENTES = {
  es: 'el la los las del y en un con para por una unos unas que mi tu su sus muy pero sin esta este como mas al es son dia nueva nuevo hermosa primera vez mejor casa hoy',
  en: 'the and with for my your her his from this that on of is to at new first girl best gets while after big in out up how what when',
  pt: 'o os as um uma com para do da dos das no na em meu minha nao voce muito mais sua seu ele ela que primeira vez',
  fr: 'le les des du une un et en avec pour dans sur est ma mon son sa tres pas la que premiere fois',
  de: 'der die das und mit ein eine fur auf ist ich nicht den dem zu im von sie',
  it: 'il lo gli della delle con per una uno che nel nella sono mia molto la prima volta',
};

const IDIOMAS = Object.keys(FRECUENTES);

/** palabra → idiomas en los que es frecuente (para repartir su peso si está en varios). */
const INDICE = (() => {
  const indice = new Map();
  for (const [idioma, lista] of Object.entries(FRECUENTES)) {
    for (const p of lista.split(' ')) {
      if (!indice.has(p)) indice.set(p, []);
      indice.get(p).push(idioma);
    }
  }
  return indice;
})();

/** Palabras del título y de la RUTA (el dominio no dice nada del idioma del vídeo). */
function palabrasDeItem(item) {
  let ruta = '';
  try {
    ruta = decodeURIComponent(new URL(item.sourceUrl || item.url || '').pathname);
  } catch {
    ruta = '';
  }
  return normalizar(`${item.title || ''} ${ruta}`)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * 'es' | 'en' | 'pt' | 'fr' | 'de' | 'it' | 'dudoso'.
 *
 * Una palabra frecuente en varios idiomas («la», «con», «que») reparte su peso entre ellos, y cada
 * palabra cuenta una vez. Gana un idioma solo si suma al menos 1,5 y le saca un 50 % al segundo.
 */
function idiomaProbable(item) {
  const puntos = new Map();
  for (const p of new Set(palabrasDeItem(item || {}))) {
    const idiomas = INDICE.get(p);
    if (!idiomas) continue;
    for (const i of idiomas) puntos.set(i, (puntos.get(i) || 0) + 1 / idiomas.length);
  }
  const orden = [...puntos.entries()].sort((a, b) => b[1] - a[1]);
  const [primero, segundo] = orden;
  if (!primero || primero[1] < 1.5) return 'dudoso';
  if (segundo && primero[1] < segundo[1] * 1.5) return 'dudoso';
  return primero[0];
}

/* ── Relevancia ────────────────────────────────────────────────────── */

/** Palabras que no dicen nada del tema: artículos, preposiciones y conjunciones. */
const HUECAS = new Set(
  'a al an and at con da das de del der des di die do dos du e el em en et for il in la las le les lo los na no o of on os por para the to un una und with y'.split(
    ' '
  )
);

/** Palabras sueltas de lo buscado (normalizadas). Las de una letra no dicen nada. */
function terminos(q) {
  return normalizar(q)
    .split(/[^a-z0-9]+/)
    .filter(p => p.length > 1 || /\d/.test(p));
}

/**
 * Cuánto casa un resultado con lo buscado: `{ relevancia: 0..100, frase }`.
 *
 * Se mira el título y la RUTA (muchas fichas llevan el título en la dirección y el título de la
 * página viene vacío); el dominio no, porque casaría con todo lo de ese sitio. Escala:
 * - cada palabra encontrada suma su parte de 70 (todas > algunas > ninguna);
 * - todas y SEGUIDAS, en el orden escrito, suman 30 más («frase exacta»); todas pero sueltas, 10.
 * Una palabra cuenta si empieza una palabra del texto: «playa» casa con «playas», no con «explaya».
 */
function relevancia(item, q) {
  const buscadas = terminos(q);
  if (buscadas.length === 0) return { relevancia: null, frase: null };
  let ruta = '';
  try {
    ruta = decodeURIComponent(new URL(item?.sourceUrl || item?.url || '').pathname);
  } catch {
    ruta = '';
  }
  const palabrasTexto = normalizar(`${item?.title || ''} ${ruta}`)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const texto = ` ${palabrasTexto.join(' ')} `;
  // Las palabras huecas («de», «la», «the») casan con casi todo: no cuentan para «todas/algunas»
  // salvo que lo buscado sea solo eso. Para la frase seguida sí cuentan, que es lo que la fija.
  const llenas = buscadas.filter(p => !HUECAS.has(p));
  const cuentan = llenas.length ? llenas : buscadas;
  const encontradas = cuentan.filter(p => palabrasTexto.some(w => w.startsWith(p))).length;
  const frase = texto.includes(` ${buscadas.join(' ')}`);
  let puntos = (70 * encontradas) / cuentan.length;
  if (frase) puntos += 30;
  else if (encontradas === cuentan.length) puntos += 10;
  return { relevancia: Math.round(puntos), frase };
}

module.exports = {
  relevancia,
  terminos,
  normalizar,
  palabras,
  contieneAlguna,
  textoDe,
  bloqueadaPor,
  idiomaProbable,
  IDIOMAS,
};
