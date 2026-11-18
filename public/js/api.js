/** Cliente de la API de clipscout. */

import { t, idiomaActual, existeClave } from './i18n/index.js';

const BASE = '/api';

/**
 * Todas las llamadas de la interfaz a esta misma app llevan `X-Clipgeist: 1`: el servidor rechaza
 * lo que cambia algo si no viene de la propia app (contra webs que intentan accionarla). Se pone
 * aquí y, por si alguna vista usa `fetch` directamente, también en el `fetch` de la página para
 * las direcciones de esta misma app.
 */
const CABECERA = { 'X-Clipgeist': '1' };
if (typeof window !== 'undefined' && window.fetch && !window.fetch.clipgeist) {
  const original = window.fetch.bind(window);
  const propia = entrada => {
    try {
      const url = new URL(
        entrada instanceof Request ? entrada.url : String(entrada),
        location.href
      );
      return url.origin === location.origin;
    } catch {
      return false;
    }
  };
  const conCabecera = async (entrada, opciones = {}) => {
    if (!propia(entrada)) return original(entrada, opciones);
    const cabeceras = new Headers(
      opciones.headers || (entrada instanceof Request ? entrada.headers : {})
    );
    if (!cabeceras.has('X-Clipgeist')) cabeceras.set('X-Clipgeist', '1');
    // Los errores del servidor llegan en el idioma de la interfaz (SU-10).
    if (!cabeceras.has('Accept-Language')) cabeceras.set('Accept-Language', idiomaActual());
    const respuesta = await original(entrada, { ...opciones, headers: cabeceras });
    if (respuesta.status === 401) revisarSesion(entrada);
    return respuesta;
  };
  conCabecera.clipgeist = true;
  window.fetch = conCabecera;
}

/**
 * CS-13: la sesión caducó (o se cerró desde otro sitio). Antes salía un error genérico y la
 * conexión en directo reintentaba cada 3 s para siempre; ahora cualquier 401 de la propia API
 * (salvo las de /api/auth/, que son las de entrar) lleva a la pantalla de acceso, y al entrar se
 * vuelve a la misma pantalla.
 */
let yendoAlLogin = false;
export function sesionCaducada() {
  if (yendoAlLogin || typeof window === 'undefined') return;
  yendoAlLogin = true;
  try {
    sessionStorage.setItem('clipscout:volver', location.hash || '');
  } catch {
    // sin almacenamiento: se vuelve al inicio
  }
  location.replace('/login');
}
function revisarSesion(entrada) {
  try {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada), location.href);
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
      sesionCaducada();
    }
  } catch {
    // dirección rara: nada que hacer
  }
}

class ApiError extends Error {
  constructor(message, code, status, { codigo = '', params = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.codigo = codigo;
    this.params = params;
  }
}

/**
 * El texto de un error del servidor (SU-10): por su `codigo`, con el diccionario de la interfaz
 * (`err.<codigo>`); si el código no está en el diccionario, el `detail` (que el servidor ya manda
 * en el idioma de la interfaz). Así una frase concreta («No existe esa conexión.») no se pierde
 * tras un mensaje genérico: solo se traducen los códigos que dicen todo por sí mismos.
 */
export function mensajeError(cuerpo, status) {
  const codigo = cuerpo?.codigo;
  if (codigo && existeClave(`err.${codigo}`)) return t(`err.${codigo}`, cuerpo.params || {});
  return cuerpo?.detail || cuerpo?.error || t('api.errorHttp', { status });
}

async function request(path, options = {}) {
  let response;
  try {
    // Las cabeceras se fusionan aparte: con un spread plano, un options.headers
    // (cualquier cabecera propia) borraría el Content-Type y el body dejaría de
    // llegar como JSON.
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': idiomaActual(),
        ...CABECERA,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    // Un abort deliberado (AbortController, ver `extractVideos`) no es un
    // fallo de red: se relanza tal cual para que quien llamó lo distinga con
    // `error.name === 'AbortError'`. Envolverlo en un ApiError genérico lo
    // haría indistinguible de una caída real de la conexión.
    if (error.name === 'AbortError') throw error;
    throw new ApiError(t('api.sinConexion', { mensaje: error.message }), 'NETWORK', 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      mensajeError(payload, response.status),
      payload?.code || 'HTTP_ERROR',
      response.status,
      { codigo: payload?.codigo || '', params: payload?.params || {} }
    );
  }

  return payload;
}

export function getHealth() {
  return request('/health');
}

/**
 * Estado del acceso (`/api/auth/estado`: asistente, contraseña, aviso de cifrado). Al arrancar lo
 * pedían tres sitios por separado (CS-15); se pide una vez y se comparte durante unos segundos.
 * Si falla devuelve `{}`, como hacían todos.
 */
let estadoEnVuelo = null;
let estadoPedidoEn = 0;
export function estadoAcceso() {
  if (!estadoEnVuelo || Date.now() - estadoPedidoEn > 5000) {
    estadoPedidoEn = Date.now();
    estadoEnVuelo = fetch('/api/auth/estado')
      .then(r => r.json())
      .catch(() => ({}));
  }
  return estadoEnVuelo;
}

export function scrape(params) {
  return request('/scrape', { method: 'POST', body: JSON.stringify(params) });
}

/** Propone una configuración para una URL. Cuesta una carga con navegador. */
export function detectConfig(searchUrl) {
  return request('/scrape/detect', { method: 'POST', body: JSON.stringify({ searchUrl }) });
}

/**
 * `signal` es el de un `AbortController` propio de la vista: "Cancelar" hace
 * `controller.abort()`, que corta el `fetch` en curso. El backend, a su vez,
 * aborta el análisis al detectar el cierre de la conexión (`res.on('close')`
 * en `routes/video.js`), así que cancelar de verdad detiene el trabajo, no
 * solo la espera del cliente.
 */
export function extractVideos(params, { signal } = {}) {
  return request('/video/extract', { method: 'POST', body: JSON.stringify(params), signal });
}

/* ── Configuraciones guardadas ───────────────────────────────────── */

/** Configura y prueba un sitio con solo su dirección (no guarda nada). */
export function autoSitio(url, termino, { signal } = {}) {
  return request('/sitios/auto', {
    method: 'POST',
    body: JSON.stringify({ url, termino }),
    signal,
  });
}

/** Cambia la configuración de sitios ya guardados (mismo dominio), sin moverlos de la lista. */
export function reconfigurarSitios(sitios) {
  return request('/sitios/reconfigurar', { method: 'POST', body: JSON.stringify({ sitios }) });
}

/** Suma configuraciones a las guardadas (las de un dominio que ya estaba se saltan). */
export function guardarSitios(sitios) {
  return request('/sitios', { method: 'POST', body: JSON.stringify({ sitios }) });
}

export function getProfiles() {
  return request('/profiles');
}

export function saveProfiles(profiles) {
  return request('/profiles', { method: 'PUT', body: JSON.stringify({ profiles }) });
}

/**
 * Abre el stream SSE del crawl.
 * Devuelve un objeto con `close()` para que la UI pueda cancelar: al cerrar el
 * EventSource, el servidor recibe el 'close' y aborta el trabajo.
 */
/** Frena una exploración en curso. El stream sigue abierto y cierra solo. */
export function pauseScrape(jobId) {
  return request('/scrape/pause', { method: 'POST', body: JSON.stringify({ jobId }) });
}

export function openScrapeStream(params, handlers = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  const source = new EventSource(`${BASE}/scrape/stream?${query.toString()}`);
  let finished = false;

  source.onmessage = event => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === 'complete' || payload.type === 'error') {
      finished = true;
      source.close();
    }

    handlers.onEvent?.(payload);
  };

  source.onerror = () => {
    // Un cierre limpio tras 'complete' también dispara onerror
    if (finished) return;
    source.close();
    handlers.onEvent?.({
      type: 'error',
      message: t('api.sseCaida'),
      code: 'STREAM_DISCONNECTED',
    });
  };

  return {
    close() {
      finished = true;
      source.close();
    },
  };
}

/**
 * Abre el stream SSE del análisis de vídeo (mismo mecanismo que
 * `openScrapeStream`, calcado a propósito: es el único ya establecido en el
 * proyecto para progreso en tiempo real).
 *
 * Diferencias con `openScrapeStream`, por cómo lo espera `GET
 * /api/video/stream` (ver `parsearUrls` en `src/routes/video.js`):
 *   - `urls` viaja como un STRING JSON de un array, no como valor suelto: una
 *     lista de direcciones no cabe limpia en un solo parámetro de query.
 *   - `getMetadata`/`getThumbnails`/`useJavaScript` viajan SIEMPRE como
 *     'true'/'false' explícitos. El servidor compara contra la cadena
 *     'true' exacta, así que omitirlos equivale a mandar 'false' — a
 *     diferencia de `POST /video/extract`, donde `useJavaScript` por
 *     defecto es `true`. Aquí no hay valor por defecto que valga: hay que
 *     decir siempre lo que el formulario tiene marcado.
 */
export function openVideoStream(params, handlers = {}) {
  const query = new URLSearchParams();
  query.set('urls', JSON.stringify(params.urls || []));
  query.set('getMetadata', String(Boolean(params.getMetadata)));
  query.set('getThumbnails', String(Boolean(params.getThumbnails)));
  query.set('useJavaScript', String(Boolean(params.useJavaScript)));

  const source = new EventSource(`${BASE}/video/stream?${query.toString()}`);
  let finished = false;

  source.onmessage = event => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === 'complete' || payload.type === 'error') {
      finished = true;
      source.close();
    }

    handlers.onEvent?.(payload);
  };

  source.onerror = () => {
    // Un cierre limpio tras 'complete' también dispara onerror
    if (finished) return;
    source.close();
    handlers.onEvent?.({
      type: 'error',
      message: t('api.sseCaida'),
      code: 'STREAM_DISCONNECTED',
    });
  };

  return {
    close() {
      finished = true;
      source.close();
    },
  };
}

/* ── Clipgeist: ajustes y conexiones con las otras apps ───────────── */

export const ajustes = {
  general: () => request('/ajustes/general'),
  guardarGeneral: datos =>
    request('/ajustes/general', { method: 'PUT', body: JSON.stringify(datos) }),
  regenerarClave: () => request('/ajustes/api-key', { method: 'POST', body: '{}' }),
  conexiones: () => request('/ajustes/conexiones'),
  probar: datos =>
    request('/ajustes/conexiones/probar', { method: 'POST', body: JSON.stringify(datos) }),
  conectar: datos =>
    request('/ajustes/conexiones', { method: 'POST', body: JSON.stringify(datos) }),
  estado: id => request(`/ajustes/conexiones/${id}/estado`),
  quitar: id => request(`/ajustes/conexiones/${id}`, { method: 'DELETE' }),
  revocar: id => request(`/ajustes/conexiones/${id}/revocar`, { method: 'POST', body: '{}' }),
  sesiones: () => request('/ajustes/sesiones'),
  cerrarSesion: id => request(`/ajustes/sesiones/${id}`, { method: 'DELETE' }),
  cerrarDemas: () => request('/ajustes/sesiones/cerrar-demas', { method: 'POST', body: '{}' }),
  yaLoTengo: (titulos, duraciones, persona = '', { enlaces = [], contar = false } = {}) =>
    request('/ajustes/ya-lo-tengo', {
      method: 'POST',
      body: JSON.stringify({ titulos, duraciones, persona, enlaces, contar }),
      // `contar`: false, o el id de la búsqueda (el servidor cuenta cada búsqueda una vez)
    }),
  ponerACeroEstadisticas: () => request('/ajustes/sitios/estadisticas', { method: 'DELETE' }),
  jdownloader: () => request('/ajustes/jdownloader'),
  busqueda: () => request('/ajustes/busqueda'),
  proxy: () => request('/ajustes/proxy'),
  probarProxy: () => request('/ajustes/proxy/probar', { method: 'POST', body: '{}' }),
  guardarProxy: url => request('/ajustes/proxy', { method: 'PUT', body: JSON.stringify({ url }) }),
  guardarBusqueda: datos =>
    request('/ajustes/busqueda', { method: 'PUT', body: JSON.stringify(datos) }),
  probarBusqueda: datos =>
    request('/ajustes/busqueda/probar', { method: 'POST', body: JSON.stringify(datos) }),
  destinos: () => request('/ajustes/destinos'),
  guardarJd: datos =>
    request('/ajustes/jdownloader', { method: 'PUT', body: JSON.stringify(datos) }),
  probarJd: url =>
    request('/ajustes/jdownloader/probar', { method: 'POST', body: JSON.stringify({ url }) }),
  enviarJd: datos =>
    request('/ajustes/jdownloader/enviar', { method: 'POST', body: JSON.stringify(datos) }),
  enviadosJd: enlaces =>
    request('/ajustes/jdownloader/enviados', {
      method: 'POST',
      body: JSON.stringify({ enlaces }),
    }),
  guardarAcceso: datos =>
    request('/ajustes/acceso', { method: 'PUT', body: JSON.stringify(datos) }),
  quitarAcceso: datos =>
    request('/ajustes/acceso/quitar', { method: 'POST', body: JSON.stringify(datos) }),
  sitios: () => request('/ajustes/sitios'),
  guardarSitio: (dominio, datos) =>
    request(`/ajustes/sitios/${encodeURIComponent(dominio)}`, {
      method: 'PUT',
      body: JSON.stringify(datos),
    }),
  filtros: () => request('/ajustes/filtros'),
  guardarFiltros: datos =>
    request('/ajustes/filtros', { method: 'PUT', body: JSON.stringify(datos) }),
  paquetesJd: revisar => request(`/ajustes/jdownloader/paquetes${revisar ? '?revisar=1' : ''}`),
  reintentarPaquete: id =>
    request(`/ajustes/jdownloader/paquetes/${encodeURIComponent(id)}/reintentar`, {
      method: 'POST',
      body: '{}',
    }),
  vaciarCapturador: () =>
    request('/ajustes/jdownloader/vaciar-capturador', { method: 'POST', body: '{}' }),
  respaldos: () => request('/ajustes/respaldos'),
  respaldarAhora: () => request('/ajustes/respaldos', { method: 'POST', body: '{}' }),
  restaurarRespaldo: id =>
    request(`/ajustes/respaldos/${encodeURIComponent(id)}/restaurar`, {
      method: 'POST',
      body: '{}',
    }),
  programadas: () => request('/ajustes/programadas'),
  guardarProgramada: datos =>
    request('/ajustes/programadas', { method: 'POST', body: JSON.stringify(datos) }),
  quitarProgramada: id =>
    request(`/ajustes/programadas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  lanzarProgramada: id =>
    request(`/ajustes/programadas/${encodeURIComponent(id)}/ahora`, { method: 'POST', body: '{}' }),
};

/** «Recoger» (CS-N1): la propuesta de lo que se mandaría de una búsqueda. */
export const recoger = {
  propuesta: datos =>
    request('/recoger/propuesta', { method: 'POST', body: JSON.stringify(datos) }),
};

/** Fase 5: diagnóstico, copia de la suite y versiones (Ajustes → Sistema). */
export const sistema = {
  diagnostico: () => request('/diagnostico'),
  registro: (lineas = 200) => request(`/diagnostico/registro?lineas=${lineas}`),
  actualizaciones: () => request('/actualizaciones'),
  privacidad: () => request('/privacidad'),
  buscarActualizaciones: activo =>
    request('/actualizaciones', { method: 'PUT', body: JSON.stringify({ activo }) }),
  comprobarActualizaciones: () =>
    request('/actualizaciones/comprobar', { method: 'POST', body: '{}' }),
  restaurarCopia: fichero =>
    request('/crew/v1/copia/restaurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: fichero,
    }),
};

export { ApiError };
