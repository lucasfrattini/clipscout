/**
 * Espejo en el navegador de `src/lib/filtros.js` (normalizar, palabras, contieneAlguna, textoDe).
 *
 * Está duplicado porque el front se sirve sin empaquetador y no puede cargar CommonJS. Un test
 * (`tests/filtros.test.js`) pasa la MISMA batería por los dos: si se toca uno, se toca el otro,
 * o el filtro de la pantalla y el del servidor dejan de coincidir sin dar ningún error.
 */

export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
}

export function palabras(texto) {
  const lista = Array.isArray(texto) ? texto : String(texto || '').split(/[,\n]/);
  return lista.map(p => normalizar(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function contieneAlguna(textoNormalizado, lista) {
  for (const p of lista) if (textoNormalizado.includes(p)) return p;
  return null;
}

export function textoDe(item) {
  if (!item) return '';
  return normalizar(`${item.title || ''} ${item.sourceUrl || ''} ${item.url || ''}`);
}
