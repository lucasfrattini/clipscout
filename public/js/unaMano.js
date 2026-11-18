/**
 * Piezas puras de la interfaz «cómoda con una mano» (fase 3). Sin DOM, para probarlas en Node
 * (tests/fase3-interfaz.test.js).
 */

/** Ajustes en 4 secciones; las direcciones viejas (#/ajustes/sitios…) siguen llevando a su sitio. */
export const SECCIONES_AJUSTES = ['busqueda', 'descargas', 'clipgeist', 'sistema'];
const SECCION_VIEJA = {
  sitios: 'busqueda',
  busqueda: 'busqueda',
  jdownloader: 'descargas',
  descargas: 'descargas',
  conexiones: 'clipgeist',
  clipgeist: 'clipgeist',
  general: 'sistema',
  seguridad: 'sistema',
  copia: 'sistema',
  apariencia: 'sistema',
  acerca: 'sistema',
  sistema: 'sistema',
};

/** La sección de Ajustes que corresponde a lo pedido en la dirección ('' = ninguna: el índice). */
export function seccionAjustes(pedida) {
  return SECCION_VIEJA[String(pedida || '').toLowerCase()] || '';
}

/** Actividad: tres pestañas. Lo viejo de Ajustes (paquetes, programadas) también lleva aquí. */
export const PESTANAS_ACTIVIDAD = ['busquedas', 'descargas', 'programadas'];
export function pestanaActividad(pedida) {
  return PESTANAS_ACTIVIDAD.includes(pedida) ? pedida : PESTANAS_ACTIVIDAD[0];
}

const LOCALES = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal)$/i;

/**
 * Dirección de otra app de Clipgeist tal como hay que abrirla DESDE ESTE NAVEGADOR. Las conexiones
 * se guardan como las ve el servidor («http://localhost:8096», o el nombre del contenedor), y
 * desde el móvil eso apunta al propio teléfono. Si la guardada es local o un nombre sin dominio,
 * se cambia por la máquina desde la que se está viendo clipscout (mismo protocolo y puerto).
 */
export function urlDeApp(guardada, hostActual) {
  let url;
  try {
    url = new URL(guardada);
  } catch {
    return guardada;
  }
  const host = url.hostname;
  const actual = String(hostActual || '');
  if (!actual || LOCALES.test(actual)) return url.href;
  const sinDominio = !host.includes('.') && !host.includes(':') && !host.startsWith('[');
  if (!LOCALES.test(host) && !sinDominio) return url.href;
  url.hostname = actual;
  return url.href;
}

/**
 * «Descargar todo»: lo que se ve, una vez cada ficha, SIN lo que ya tienes en la biblioteca ni lo
 * que ya mandaste (CS-41, CS-N7), aunque se estén mostrando.
 */
export function paraDescargarTodo(lista, { tengo = new Map(), enviados = new Map() } = {}) {
  const fuera = enlace => tengo.has(enlace) || enviados.has(enlace);
  const r = [];
  const vistos = new Set();
  for (const item of lista) {
    const enlace = item.sourceUrl || item.url;
    if (!enlace || vistos.has(enlace) || fuera(enlace)) continue;
    vistos.add(enlace);
    r.push(enlace);
  }
  return r;
}

/** Fecha corta para «Enviado el 12 nov.» en el idioma de la interfaz. */
export function fechaCorta(ms, idioma = 'es') {
  try {
    return new Date(ms).toLocaleDateString(idioma, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
