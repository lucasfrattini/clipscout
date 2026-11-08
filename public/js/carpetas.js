/**
 * Nombres que propone la ventana de carpeta de descarga para un tipo: las carpetas que ya existen
 * bajo su raíz y, además, las personas o etiquetas del catálogo de clipkeeper, aunque aún no tengan
 * carpeta propia (sus vídeos pueden estar en otra). El modo discreto de clipkeeper solo oculta en
 * su biblioteca: aquí sale todo. Sin repetir nombres aunque cambien las mayúsculas.
 */
export function nombresCarpeta({ tipo, raiz, existentes = [], catalogo = {}, filtro = '' }) {
  const carpetas = existentes
    .filter(c => c.startsWith(`${raiz}/`))
    .map(c => c.slice(raiz.length + 1))
    .filter(n => n && !n.includes('/'));
  let fichas = [];
  if (['actriz', 'actor', 'artista'].includes(tipo)) {
    fichas = (catalogo.personas || []).filter(p => p.rol === tipo);
  } else if (tipo === 'categoria') {
    fichas = (catalogo.etiquetas || []).filter(e => e.grupo === 'Tipo');
  } else {
    fichas = (catalogo.etiquetas || []).filter(e => e.grupo !== 'Tipo');
  }
  const q = filtro.trim().toLowerCase();
  const unicos = new Map();
  for (const n of [...carpetas, ...fichas.map(f => f.nombre)]) {
    const clave = n.toLowerCase();
    if (!unicos.has(clave) && (!q || clave.includes(q))) unicos.set(clave, n);
  }
  return [...unicos.values()].sort((a, b) => a.localeCompare(b));
}
