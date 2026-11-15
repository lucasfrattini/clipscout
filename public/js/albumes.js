/**
 * Álbumes de Buscar: una ficha con varios ficheros se pliega en un solo resultado.
 *
 * Lógica pura (con test en `tests/albumes.test.js`): recibe la lista YA filtrada —los filtros se
 * aplican por fichero, así que la duración mínima mira cada vídeo y no el álbum— y devuelve la
 * lista plegada y los miembros visibles de cada álbum.
 */

/** La ficha que agrupa un resultado, o null si el resultado es la ficha misma. */
export const claveAlbum = r => (r.sourceUrl && r.sourceUrl !== r.url ? r.sourceUrl : null);

/**
 * @param {object[]} lista    resultados ya filtrados y ordenados
 * @param {Set<string>} abiertos fichas desplegadas a mano
 * @returns {{ lista: object[], albumes: Map<string, object[]> }}
 */
export function plegarAlbumes(lista, abiertos = new Set()) {
  const miembros = new Map();
  for (const r of lista) {
    const k = claveAlbum(r);
    if (!k) continue;
    if (!miembros.has(k)) miembros.set(k, []);
    miembros.get(k).push(r);
  }
  const albumes = new Map([...miembros].filter(([, m]) => m.length > 1));
  const salida = [];
  const puestos = new Set();
  for (const r of lista) {
    const k = claveAlbum(r);
    const grupo = k ? albumes.get(k) : null;
    if (!grupo) {
      salida.push(r);
      continue;
    }
    if (puestos.has(k)) continue;
    puestos.add(k);
    // Desplegado, los miembros van juntos detrás del primero aunque el orden los separe.
    salida.push(...(abiertos.has(k) ? grupo : [grupo[0]]));
  }
  return { lista: salida, albumes };
}
