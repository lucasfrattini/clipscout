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

/** Para comparar nombres: minúsculas, sin acentos y con los espacios de uno en uno. */
const normal = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_.-]+/g, ' ')
    .trim();

/**
 * Carpeta que se propone sola al buscar (§5.5): si lo buscado es el nombre de una carpeta que ya
 * existe, esa; si no, si es una persona o etiqueta del catálogo de clipkeeper, su carpeta nueva con
 * la regla para que lo que llegue entre ya catalogado (como la ventana de carpeta). Si no coincide
 * con nada, null: se sigue preguntando. Solo coincidencias exactas (sin mayúsculas ni acentos): una
 * parecida podría mandar a otra persona.
 */
export function carpetaPropuesta(termino, { existentes = [], catalogo = {}, personas = [] } = {}) {
  const q = normal(termino);
  if (q.length < 2) return null;
  // Fase 7: una persona de clipkeeper (C1) por su nombre o un alias → su carpeta (la de la mayoría
  // de sus vídeos; si no tiene, People/<nombre>) con la regla de esa persona.
  const deClipkeeper = personas.find(p =>
    [p.nombre, ...(p.alias || [])].some(n => normal(n) === q)
  );
  if (deClipkeeper) {
    return {
      carpeta: deClipkeeper.carpeta || `People/${deClipkeeper.nombre}`,
      regla: { personas: [{ nombre: deClipkeeper.nombre, rol: deClipkeeper.rol }] },
    };
  }
  const carpeta = existentes.find(c => normal(String(c).split('/').filter(Boolean).pop()) === q);
  if (carpeta) return { carpeta, regla: null };
  const persona = (catalogo.personas || []).find(p => normal(p.nombre) === q);
  if (persona) {
    return {
      carpeta: `People/${persona.nombre}`,
      regla: { personas: [{ nombre: persona.nombre, rol: persona.rol }] },
    };
  }
  const etiqueta = (catalogo.etiquetas || []).find(e => normal(e.nombre) === q);
  if (etiqueta) {
    const raiz = etiqueta.grupo === 'Tipo' ? 'Categories' : 'Unsorted';
    return {
      carpeta: `${raiz}/${etiqueta.nombre}`,
      regla: { etiquetas: [{ nombre: etiqueta.nombre, grupo: etiqueta.grupo }] },
    };
  }
  return null;
}
