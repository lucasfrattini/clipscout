'use strict';

const config = require('../config');
const { readProfiles, ultimosPerfiles } = require('./profiles');
const { crawl, normalizeCrawlParams } = require('./scraper');
const { hasSearchTemplate, parseExtensionList } = require('../lib/url');
const { mapLimit } = require('../lib/concurrency');
const { buscarEnWeb, buscarEnLaWebAbierta, hostDe } = require('./web');
const { groupDuplicates } = require('../lib/dedupe');
const { parseClockDuration } = require('../lib/media');
const { detectConfig } = require('./detector');
const { extractVideos } = require('./video');
const estadisticas = require('./estadisticas');
const directo = require('./directo');
const proxySalida = require('./proxySalida');
const { ERROR_PROXY } = proxySalida;
const { sinProxy } = require('../lib/http');

/**
 * Búsqueda en TODOS los sitios guardados a la vez.
 *
 * Cada configuración guardada cuya dirección lleva `{q}` es un «sitio» donde se puede buscar.
 * Se lanza un crawl por sitio, con SU configuración (patrón, navegador, extensiones…) y el término
 * que escribió el usuario; los resultados llegan mezclados por el mismo stream, marcados con el
 * sitio del que vienen, para que la interfaz los muestre juntos o filtrados por sitio.
 *
 * Solo se recorren las primeras páginas de cada sitio (`config.busqueda.paginas`): es una búsqueda
 * rápida; para ir a fondo en uno, está el Explorador con esa configuración.
 */

/** Nombre corto para mostrar: «sitio — búsqueda» → «sitio». */
function nombreCorto(nombre) {
  return String(nombre)
    .split(/\s+[—–-]\s+/)[0]
    .trim();
}

/**
 * CS-07: identidad ESTABLE de un sitio. El `id` que ve la API sigue siendo su posición en la lista
 * (los scripts que mandan `sitios: [0, 2]` siguen igual), pero lo que se guarda con una búsqueda
 * para lanzarla más tarde (cola) o retomarla tras un reinicio es esta clave: el servidor y la ruta
 * de su dirección de búsqueda (dos configuraciones del mismo dominio se distinguen), o el nombre. Así, borrar o
 * reordenar sitios ya no hace que una búsqueda en cola o retomada apunte a otros.
 */
function claveSitio(perfil) {
  try {
    const u = new URL(String(perfil.config.searchUrl || '').replace(/\{q\}/g, 'q'));
    return `${u.host.replace(/^www\./, '')}${u.pathname}`;
  } catch {
    return `nombre:${perfil.name}`;
  }
}

function sitiosDe(perfiles) {
  return perfiles
    .map((p, id) => ({ id, nombre: nombreCorto(p.name), clave: claveSitio(p), perfil: p }))
    .filter(s => hasSearchTemplate(s.perfil.config.searchUrl || ''));
}

/** Los sitios donde se puede buscar, con su posición en la lista de configuraciones como id. */
async function listarSitios() {
  return sitiosDe(await readProfiles());
}

/**
 * Posiciones → claves estables, al momento (con la última lista leída o guardada). null si no se
 * puede traducir alguna: entonces se sigue con las posiciones, como antes.
 */
function clavesDeIds(ids) {
  const perfiles = ultimosPerfiles();
  if (!perfiles || !Array.isArray(ids)) return null;
  const porId = new Map(sitiosDe(perfiles).map(s => [s.id, s.clave]));
  const claves = ids.map(id => porId.get(id));
  return claves.every(Boolean) ? claves : null;
}

async function sinLosDeFuera(lista) {
  let opciones = {};
  try {
    opciones = await directo.opcionesSitios();
  } catch {
    return lista; // sin opciones legibles, como antes: todos
  }
  return lista.filter(
    s => !directo.fueraPorDefecto(hostDe(s.perfil.config.searchUrl || ''), opciones)
  );
}

/**
 * ¿Está caído el proxy de salida? Si lo está, avisa por el stream (`proxy_caido`, para el aviso de
 * la pantalla) y devuelve true. Sin proxy configurado, o si no se pudo probar, false.
 */
async function proxyNoResponde(emit) {
  if (!proxySalida.configurado()) return false;
  const e = await proxySalida.asegurar().catch(() => null);
  if (!e || e.ok !== false) return false;
  emit({ type: 'proxy_caido', error: e.error });
  return true;
}

/**
 * Repetidos EN VIVO (CS-08): antes solo se agrupaban al final, así que mientras duraba la búsqueda
 * la lista enseñaba los repetidos. Ahora, con cada tanda de resultados se programa una pasada
 * (como mucho una cada `config.busqueda.agruparCadaMs`) y se manda `duplicados` solo si cambió.
 * Agrupar ya es barato (por cubos: ver lib/dedupe.js), así que no para el servidor.
 */
function crearAgrupador(items, emit) {
  let reloj = null;
  const enviados = new Set(); // firma de cada grupo ya mandado
  const pasada = () =>
    groupDuplicates(items)
      .grupos.filter(g => g.miembros.length > 1)
      .map(g => ({ representante: g.representante.url, miembros: g.miembros.map(m => m.url) }));
  return {
    tocar() {
      if (reloj) return;
      reloj = setTimeout(() => {
        reloj = null;
        // Solo los grupos nuevos o que cambiaron: un grupo solo crece mientras llegan resultados,
        // así que la pantalla los suma a lo que ya tenía (y el fichero de eventos no se llena de
        // la misma lista repetida cada 2 s).
        const nuevos = pasada().filter(g => {
          const firma = JSON.stringify(g);
          if (enviados.has(firma)) return false;
          enviados.add(firma);
          return true;
        });
        if (nuevos.length) emit({ type: 'duplicados', grupos: nuevos, parcial: true });
      }, config.busqueda.agruparCadaMs);
      reloj.unref?.();
    },
    /** Al terminar: la pasada definitiva, siempre (quien mira cierra con ella). */
    final() {
      clearTimeout(reloj);
      reloj = null;
      emit({ type: 'duplicados', grupos: pasada() });
    },
  };
}

/** Alias que se buscan como mucho además del nombre (cada uno es una vuelta más por sitio). */
const MAX_ALIAS = 5;

/** Id del «sitio» que agrupa lo encontrado en toda la web (no es una configuración guardada). */
const ID_WEB_ABIERTA = -1;

/** Lo que se busca en las páginas de sitios sin configurar. */
const EXTENSIONES_ABIERTA = '.mp4, .webm, .m4v, .mov, .m3u8';

/**
 * «En toda la web»: el buscador da páginas de cualquier sitio que nombren lo buscado, y en cada
 * una se busca el vídeo como en la fase 2. Al final se avisa de qué dominios dieron vídeos, para
 * que se puedan dar de alta con un clic (services/autoSitio.js).
 */
async function buscarEnAbierta(q, { excluir, signal, emit, todosLosItems, agrupador }) {
  const id = ID_WEB_ABIERTA;
  emit({ type: 'sitio_inicio', sitio: id });
  let total = 0;
  const conVideo = new Map(); // dominio → vídeos hallados
  try {
    const urls = await buscarEnLaWebAbierta(q, { excluir, signal });
    emit({ type: 'sitio_progreso', sitio: id, enlaces: urls.length });
    if (urls.length > 0 && !signal?.aborted) {
      const params = normalizeCrawlParams({
        searchUrl: urls[0],
        searchTerm: '',
        useJavaScript: true,
        endPage: 1,
        withThumbnails: true,
      });
      await crawl(
        {
          ...params,
          extensions: parseExtensionList(EXTENSIONES_ABIERTA),
          maxLinks: urls.length,
          usarCache: true,
        },
        {
          signal,
          linksPrevios: urls,
          emit: evento => {
            if (evento.type === 'files_found') {
              const items = (evento.details || [])
                .filter(Boolean)
                .map(it => ({ ...it, web: true }));
              total += items.length;
              todosLosItems.push(...items);
              agrupador.tocar();
              for (const it of items) {
                const h = hostDe(it.sourceUrl || it.pageUrl || it.url);
                if (h) conVideo.set(h, (conVideo.get(h) || 0) + 1);
              }
              emit({ type: 'resultados', sitio: id, items });
            } else if (evento.type === 'phase2_progress') {
              emit({
                type: 'sitio_progreso',
                sitio: id,
                hechos: evento.current,
                enlaces: evento.total,
              });
            }
          },
        }
      );
    }
    const sugeridos = [...conVideo.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([dominio, videos]) => ({ dominio, videos }));
    if (sugeridos.length > 0) emit({ type: 'sitios_sugeridos', sugeridos });
    emit({ type: 'sitio_fin', sitio: id, total });
    return { id, total };
  } catch (error) {
    emit({ type: 'sitio_fin', sitio: id, total, error: error.message });
    return { id, total, error: error.message };
  }
}

/**
 * @param {object} entrada  { q, sitios: [ids] | null (todos) }
 * @param {object} opciones { signal, emit }
 */
/** dominio → búsquedas, de los sitios con `busqueda.minBusquedasMuerto` búsquedas o más y ningún resultado. */
async function sitiosSinResultados() {
  const minimo = config.busqueda.minBusquedasMuerto;
  if (!(minimo > 0)) return new Map();
  try {
    const sitios = await estadisticas.leer();
    return new Map(
      Object.entries(sitios)
        .filter(([, v]) => (v.busquedas || 0) >= minimo && !(v.resultados > 0))
        .map(([d, v]) => [d, v.busquedas])
    );
  } catch {
    return new Map();
  }
}

async function buscarEnTodos(
  {
    q,
    sitios = null,
    claves = null,
    paginas = null,
    web = false,
    enlaces = null,
    abierta = false,
    retomar = null,
    alias = [],
  },
  { signal, emit = () => {}, itemsPrevios = [], contar = true } = {}
) {
  const conWeb = web === true && Boolean(config.busqueda.searxngUrl);
  const porSitio = Math.min(
    config.busqueda.maxPaginas,
    Math.max(1, Number.parseInt(paginas, 10) || config.busqueda.paginas)
  );
  const topeEnlaces =
    Number.isInteger(enlaces) && enlaces > 0 ? enlaces : config.busqueda.maxEnlaces * porSitio;
  // Para agrupar repetidos ENTRE sitios al final. Al reanudar tras un reinicio llegan ya los de
  // antes: si no, una copia hallada antes y otra después no se verían nunca como repetidas.
  const todosLosItems = [...itemsPrevios];
  const agrupador = crearAgrupador(todosLosItems, emit);
  const todos = await listarSitios();
  // Sin elegir sitios (búsquedas de otras apps, varias, programadas): fuera los marcados en
  // Ajustes como «no buscar por defecto». Eligiéndolos a mano sí se busca en ellos.
  const elegidos = Array.isArray(claves)
    ? todos.filter(s => claves.includes(s.clave))
    : sitios
      ? todos.filter(s => sitios.includes(s.id))
      : await sinLosDeFuera(todos);

  const conAbierta = abierta === true && Boolean(config.busqueda.searxngUrl);
  emit({
    type: 'sitios',
    sitios: [
      ...elegidos.map(s => ({ id: s.id, nombre: s.nombre, clave: s.clave })),
      ...(conAbierta ? [{ id: ID_WEB_ABIERTA, nombre: 'web', abierta: true }] : []),
    ],
  });

  // Proxy de salida caído: los sitios que salen por él fallan ya, con un motivo claro, en vez de
  // esperar cada uno su tiempo máximo. Los de «Sitios sin VPN» van directos y se buscan igual.
  const proxyCaido = await proxyNoResponde(emit);
  // Sitios que nunca dieron nada en muchas búsquedas: cada uno abría decenas de fichas en el
  // navegador para nada y retrasaba a los demás. Se saltan, con el motivo, hasta que se reponen
  // sus estadísticas (Ajustes → Sitios → poner a cero).
  const muertos = await sitiosSinResultados();
  // Opciones por dominio (Ajustes → Sitios → ⋯): p. ej. «pasar la página a JDownloader».
  const opcionesDominio = await directo.opcionesSitios().catch(() => ({}));

  const resumen = await mapLimit(elegidos, config.busqueda.sitiosALaVez, async sitio => {
    if (signal?.aborted) return { id: sitio.id, total: 0, cancelado: true };
    const c = sitio.perfil.config;
    if (proxyCaido && !sinProxy(c.searchUrl || '')) {
      emit({ type: 'sitio_inicio', sitio: sitio.id });
      emit({ type: 'sitio_fin', sitio: sitio.id, total: 0, error: ERROR_PROXY });
      return { id: sitio.id, total: 0, error: ERROR_PROXY };
    }
    const dominioSitio = hostDe(c.searchUrl || '');
    if (muertos.has(dominioSitio)) {
      const error = `Nunca dio resultados en ${muertos.get(dominioSitio)} búsquedas: se salta`;
      emit({ type: 'sitio_inicio', sitio: sitio.id });
      emit({ type: 'sitio_fin', sitio: sitio.id, total: 0, error, saltado: true });
      return { id: sitio.id, total: 0, error, saltado: true };
    }
    emit({ type: 'sitio_inicio', sitio: sitio.id });
    let total = 0;
    let conDuracion = 0;
    // Rendimiento por sitio (Ajustes → Sitios): qué aporta cada uno.
    const dominio = hostDe(c.searchUrl || '');
    const apuntar = cuentas => contar && estadisticas.sumar(dominio, { busquedas: 1, ...cuentas });
    const vistos = new Set(); // fichas ya revisadas (para no repetirlas en la búsqueda web)
    // CS-09: las fichas terminadas se apuntan por tandas (con el siguiente progreso) para poder
    // retomar el sitio por donde iba tras un reinicio, sin repetir sus páginas ni sus fichas.
    let hechas = [];
    const apuntarHechas = () => {
      if (hechas.length === 0) return;
      emit({ type: 'sitio_hechas', sitio: sitio.id, clave: sitio.clave, urls: hechas });
      hechas = [];
    };
    const reenviar =
      ({ web: esWeb = false } = {}) =>
      evento => {
        if (evento.type === 'files_found') {
          const items = (evento.details || [])
            .filter(Boolean)
            .map(it => (esWeb ? { ...it, web: true } : it));
          total += items.length;
          conDuracion += items.filter(it => Number.isFinite(it.durationSeconds)).length;
          todosLosItems.push(...items);
          emit({ type: 'resultados', sitio: sitio.id, items });
          agrupador.tocar();
        } else if (evento.type === 'phase1_complete') {
          emit({ type: 'sitio_progreso', sitio: sitio.id, enlaces: evento.totalLinks });
        } else if (evento.type === 'phase2_progress') {
          if (evento.url) vistos.add(evento.url);
          apuntarHechas();
          emit({
            type: 'sitio_progreso',
            sitio: sitio.id,
            hechos: evento.current,
            enlaces: evento.total,
          });
        }
      };
    try {
      const params = normalizeCrawlParams({
        ...c,
        fichaComoFichero:
          c.fichaComoFichero === true || opcionesDominio[dominio]?.fichaComoFichero === true,
        searchTerm: q,
        // Las páginas las elige quien busca (no el rango guardado en la configuración).
        endPage: (Number.parseInt(c.startPage, 10) || 1) + porSitio - 1,
        withThumbnails: true,
      });
      // CS-09: retomado tras un reinicio con su lista de fichas ya sacada: ni las páginas del
      // listado ni las fichas terminadas se vuelven a pedir.
      const previos = Array.isArray(retomar?.[sitio.clave]) ? retomar[sitio.clave] : null;
      if (previos) {
        emit({ type: 'sitio_progreso', sitio: sitio.id, enlaces: previos.length, retomado: true });
      }
      const resultado = await crawl(
        {
          ...params,
          extensions: parseExtensionList(c.fileExtensions || '.mp4'),
          // El tope crece con las páginas pedidas: con uno fijo, 2 o 5 páginas daban lo mismo.
          maxLinks: topeEnlaces,
          // Las fichas que ya abrió otra búsqueda hace poco no se vuelven a abrir.
          usarCache: true,
        },
        {
          signal,
          emit: reenviar(),
          linksPrevios: previos,
          alTenerEnlaces: links =>
            emit({
              type: 'sitio_enlaces',
              sitio: sitio.id,
              clave: sitio.clave,
              enlaces: links,
            }),
          alTerminarFicha: url => hechas.push(url),
        }
      );
      apuntarHechas();
      // NU-4: los alias de la persona se buscan también en el mismo sitio (una página cada uno: es
      // un extra). Lo repetido entre nombres lo agrupa la búsqueda como cualquier repetido, y la
      // caché de fichas evita abrir dos veces la misma.
      for (const otro of (Array.isArray(alias) ? alias : []).slice(0, MAX_ALIAS)) {
        if (signal?.aborted) break;
        try {
          const p = normalizeCrawlParams({
            ...c,
            searchTerm: otro,
            endPage: Number.parseInt(c.startPage, 10) || 1,
            withThumbnails: true,
          });
          await crawl(
            {
              ...p,
              extensions: parseExtensionList(c.fileExtensions || '.mp4'),
              maxLinks: topeEnlaces,
              usarCache: true,
            },
            { signal, emit: reenviar(), linksPrevios: null }
          );
        } catch {
          // un alias que falla no corta la búsqueda del sitio
        }
      }
      const bloqueo = resultado.diagnostico?.bloqueo?.sospechoso === true;
      const recortado = resultado.truncated === true;

      // «Tipo Google»: lo que el buscador web encuentra en ese sitio y la búsqueda propia no.
      if (conWeb && !signal?.aborted) {
        emit({ type: 'sitio_progreso', sitio: sitio.id, web: true });
        const web = await buscarEnWeb(q, c, { signal });
        const extensiones = parseExtensionList(c.fileExtensions || '.mp4');
        const urls = web.fichas.filter(u => !vistos.has(u));
        if (urls.length > 0) {
          await crawl(
            { ...params, extensions: extensiones, maxLinks: topeEnlaces, usarCache: true },
            {
              signal,
              emit: reenviar({ web: true }),
              linksPrevios: urls.slice(0, topeEnlaces),
            }
          );
        }
        // Perfil de la modelo, etiqueta… del mismo sitio: se recorren como una búsqueda más.
        for (const listado of web.listados) {
          if (signal?.aborted) break;
          try {
            const p = normalizeCrawlParams({
              ...c,
              searchUrl: listado,
              searchTerm: '',
              pageParam: '',
              endPage: c.startPage || 1,
              withThumbnails: true,
            });
            await crawl(
              { ...p, extensions: extensiones, maxLinks: topeEnlaces, usarCache: true },
              { signal, emit: reenviar({ web: true }) }
            );
          } catch {
            // un listado que falla no corta la búsqueda del sitio
          }
        }
      }
      emit({ type: 'sitio_fin', sitio: sitio.id, total, bloqueo, recortado });
      apuntar({ resultados: total, conDuracion, bloqueos: bloqueo ? 1 : 0 });
      // Retomado: `total` cuenta solo lo de ahora, así que no dice nada de la salud del sitio.
      if (contar && !signal?.aborted && !previos) {
        estadisticas.anotarSalud(dominio, { total, error: bloqueo ? 'bloqueo' : '' });
      }
      return { id: sitio.id, total };
    } catch (error) {
      emit({ type: 'sitio_fin', sitio: sitio.id, total, error: error.message });
      apuntar({ resultados: total, conDuracion });
      if (contar && !signal?.aborted) {
        estadisticas.anotarSalud(dominio, { total, error: error.message });
      }
      return { id: sitio.id, total, error: error.message };
    }
  });

  if (conAbierta && !signal?.aborted && proxyCaido) {
    emit({ type: 'sitio_inicio', sitio: ID_WEB_ABIERTA });
    emit({ type: 'sitio_fin', sitio: ID_WEB_ABIERTA, total: 0, error: ERROR_PROXY });
    resumen.push({ id: ID_WEB_ABIERTA, total: 0, error: ERROR_PROXY });
  } else if (conAbierta && !signal?.aborted) {
    const excluir = new Set(todos.map(s => hostDe(s.perfil.config.searchUrl)).filter(Boolean));
    const r = await buscarEnAbierta(q, { excluir, signal, emit, todosLosItems, agrupador });
    resumen.push(r);
  }

  // Repetidos: el mismo vídeo en varios sitios (o en varias fichas). Como en el Explorador, no se
  // quita nada: se manda qué es copia de qué y la interfaz los pliega.
  agrupador.final();

  return { sitios: resumen, total: resumen.reduce((n, r) => n + (r?.total || 0), 0) };
}

/** Ids de los «sitios» de una búsqueda por enlaces: -2, -3… (uno por enlace pegado). */
const ID_ENLACE = -2;

/** Los vídeos de la página misma (lo que hacía la pestaña Vídeos). */
async function videosDeLaPagina(url, { signal }) {
  const r = await extractVideos(url, { useJavaScript: true, getThumbnails: true, signal });
  return (r.videos || []).map(v => {
    const segundos = parseClockDuration(v.duration);
    return {
      url: v.url,
      sourceUrl: url,
      title: v.title || null,
      duration: v.duration || null,
      durationSeconds: Number.isFinite(segundos) ? segundos : null,
      thumbnail: v.thumbnailUrl || null,
    };
  });
}

/** Recorre el listado que propone el detector y busca el vídeo de cada ficha. */
async function recorrerListado(url, det, porPaginas, { signal, publicar, progreso }) {
  const s = det.sugerencia;
  const params = normalizeCrawlParams({
    searchUrl: s.searchUrl || url,
    searchTerm: '',
    pageParam: s.pageParam || '',
    paginationMode: s.paginationMode === 'scroll' && config.browser.enabled ? 'scroll' : 'auto',
    linkPattern: s.linkPattern,
    useJavaScript: Boolean(s.useJavaScript),
    startPage: 1,
    endPage: porPaginas,
    withThumbnails: true,
  });
  await crawl(
    {
      ...params,
      extensions: parseExtensionList(EXTENSIONES_ABIERTA),
      maxLinks: config.busqueda.maxEnlaces * porPaginas,
      usarCache: true,
    },
    {
      signal,
      emit: evento => {
        if (evento.type === 'files_found') publicar((evento.details || []).filter(Boolean));
        else if (evento.type === 'phase2_progress') progreso(evento.current, evento.total);
      },
    }
  );
}

/**
 * Lo que hay detrás de uno o varios enlaces pegados en la caja de Buscar (lo que antes eran las
 * pestañas Vídeos y Explorador). Por cada enlace:
 *
 * 1. Primero, SIEMPRE, los vídeos de la página misma: la página de un vídeo o de un álbum da sus
 *    vídeos, y no los de los enlaces de al lado (eso pasaba al tomarla por un listado).
 * 2. Si además parece un listado (muchas fichas con el mismo patrón):
 *    - sin vídeos propios, se recorren sus fichas directamente (una categoría, un perfil);
 *    - con vídeos propios, solo se avisa (`listado_disponible`) y la persona decide si recorrerlo.
 *    Con `listado: true` (ese botón) se recorre siempre.
 *
 * Emite los mismos eventos que la búsqueda por nombre, así que la pantalla es la misma.
 */
async function buscarEnlace(
  { url, urls = null, paginas = null, listado = false, indices = null },
  { signal, emit = () => {}, itemsPrevios = [] } = {}
) {
  // Con `indices` (reanudar) la lista es exactamente la que llega, aunque esté vacía.
  const lista = (Array.isArray(indices) ? urls || [] : urls && urls.length ? urls : [url]).slice(
    0,
    config.busqueda.maxEnlacesPegados
  );
  // `indices`: la posición ORIGINAL de cada enlace. Al reanudar solo los que faltaban, cada uno
  // conserva su id (-2 - posición): si se renumeraran, chocarían con los que ya terminaron.
  const idDe = i => ID_ENLACE - (Array.isArray(indices) ? indices[i] : i);
  const porPaginas = Math.min(
    config.busqueda.maxPaginas,
    Math.max(1, Number.parseInt(paginas, 10) || config.busqueda.paginas)
  );
  const nombres = lista.map((u, i) => ({ id: idDe(i), nombre: hostDe(u) || u }));
  emit({ type: 'sitios', sitios: nombres });
  const todosLosItems = [...itemsPrevios];
  const agrupador = crearAgrupador(todosLosItems, emit);
  const resumen = [];
  const proxyCaido = await proxyNoResponde(emit);
  for (const [i, u] of lista.entries()) {
    if (signal?.aborted) break;
    const id = idDe(i);
    emit({ type: 'sitio_inicio', sitio: id });
    if (proxyCaido && !sinProxy(u)) {
      emit({ type: 'sitio_fin', sitio: id, total: 0, error: ERROR_PROXY });
      resumen.push({ id, total: 0, error: ERROR_PROXY });
      continue;
    }
    let total = 0;
    const publicar = items => {
      if (items.length === 0) return;
      total += items.length;
      todosLosItems.push(...items);
      emit({ type: 'resultados', sitio: id, items });
      agrupador.tocar();
    };
    const progreso = (hechos, enlaces) =>
      emit({ type: 'sitio_progreso', sitio: id, modo: 'listado', hechos, enlaces });
    try {
      let det = null;
      try {
        det = await detectConfig(u, { signal });
      } catch {
        // no se pudo leer como listado: queda como página
      }
      const esListado = Boolean(det?.sugerencia?.linkPattern) && det.confianza.patron !== 'baja';
      if (!listado) {
        emit({ type: 'sitio_progreso', sitio: id, modo: 'pagina' });
        publicar(await videosDeLaPagina(u, { signal }));
      }
      if (esListado && !signal?.aborted) {
        if (listado || total === 0) {
          emit({ type: 'sitio_progreso', sitio: id, modo: 'listado' });
          await recorrerListado(u, det, porPaginas, { signal, publicar, progreso });
        } else {
          emit({ type: 'listado_disponible', sitio: id, url: u });
        }
      }
      emit({ type: 'sitio_fin', sitio: id, total });
      resumen.push({ id, total });
    } catch (error) {
      emit({ type: 'sitio_fin', sitio: id, total, error: error.message });
      resumen.push({ id, total, error: error.message });
    }
  }
  agrupador.final();
  return { sitios: resumen, total: resumen.reduce((n, r) => n + r.total, 0) };
}

module.exports = {
  buscarEnTodos,
  sitiosSinResultados,
  buscarEnlace,
  listarSitios,
  clavesDeIds,
  claveSitio,
  nombreCorto,
  ID_WEB_ABIERTA,
  ID_ENLACE,
};
