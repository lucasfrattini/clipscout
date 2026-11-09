'use strict';

const config = require('../config');
const { readProfiles } = require('./profiles');
const { crawl, normalizeCrawlParams } = require('./scraper');
const { hasSearchTemplate, parseExtensionList } = require('../lib/url');
const { mapLimit } = require('../lib/concurrency');
const { buscarEnWeb, buscarEnLaWebAbierta, hostDe } = require('./web');
const { groupDuplicates } = require('../lib/dedupe');
const { parseClockDuration } = require('../lib/media');
const { detectConfig } = require('./detector');
const { extractVideos } = require('./video');

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

/** Los sitios donde se puede buscar, con su posición en la lista de configuraciones como id. */
async function listarSitios() {
  const perfiles = await readProfiles();
  return perfiles
    .map((p, id) => ({ id, nombre: nombreCorto(p.name), perfil: p }))
    .filter(s => hasSearchTemplate(s.perfil.config.searchUrl || ''));
}

/** Id del «sitio» que agrupa lo encontrado en toda la web (no es una configuración guardada). */
const ID_WEB_ABIERTA = -1;

/** Lo que se busca en las páginas de sitios sin configurar. */
const EXTENSIONES_ABIERTA = '.mp4, .webm, .m4v, .mov, .m3u8';

/**
 * «En toda la web»: el buscador da páginas de cualquier sitio que nombren lo buscado, y en cada
 * una se busca el vídeo como en la fase 2. Al final se avisa de qué dominios dieron vídeos, para
 * que se puedan dar de alta con un clic (services/autoSitio.js).
 */
async function buscarEnAbierta(q, { excluir, signal, emit, todosLosItems }) {
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
        { ...params, extensions: parseExtensionList(EXTENSIONES_ABIERTA), maxLinks: urls.length },
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
async function buscarEnTodos(
  { q, sitios = null, paginas = null, web = false, enlaces = null, abierta = false },
  { signal, emit = () => {} } = {}
) {
  const conWeb = web === true && Boolean(config.busqueda.searxngUrl);
  const porSitio = Math.min(
    config.busqueda.maxPaginas,
    Math.max(1, Number.parseInt(paginas, 10) || config.busqueda.paginas)
  );
  const topeEnlaces =
    Number.isInteger(enlaces) && enlaces > 0 ? enlaces : config.busqueda.maxEnlaces * porSitio;
  const todosLosItems = []; // para agrupar repetidos ENTRE sitios al final
  const todos = await listarSitios();
  const elegidos = sitios ? todos.filter(s => sitios.includes(s.id)) : todos;

  const conAbierta = abierta === true && Boolean(config.busqueda.searxngUrl);
  emit({
    type: 'sitios',
    sitios: [
      ...elegidos.map(s => ({ id: s.id, nombre: s.nombre })),
      ...(conAbierta ? [{ id: ID_WEB_ABIERTA, nombre: 'web', abierta: true }] : []),
    ],
  });

  const resumen = await mapLimit(elegidos, config.busqueda.sitiosALaVez, async sitio => {
    if (signal?.aborted) return { id: sitio.id, total: 0, cancelado: true };
    const c = sitio.perfil.config;
    emit({ type: 'sitio_inicio', sitio: sitio.id });
    let total = 0;
    const vistos = new Set(); // fichas ya revisadas (para no repetirlas en la búsqueda web)
    const reenviar =
      ({ web: esWeb = false } = {}) =>
      evento => {
        if (evento.type === 'files_found') {
          const items = (evento.details || [])
            .filter(Boolean)
            .map(it => (esWeb ? { ...it, web: true } : it));
          total += items.length;
          todosLosItems.push(...items);
          emit({ type: 'resultados', sitio: sitio.id, items });
        } else if (evento.type === 'phase1_complete') {
          emit({ type: 'sitio_progreso', sitio: sitio.id, enlaces: evento.totalLinks });
        } else if (evento.type === 'phase2_progress') {
          if (evento.url) vistos.add(evento.url);
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
        searchTerm: q,
        // Las páginas las elige quien busca (no el rango guardado en la configuración).
        endPage: (Number.parseInt(c.startPage, 10) || 1) + porSitio - 1,
        withThumbnails: true,
      });
      const resultado = await crawl(
        {
          ...params,
          extensions: parseExtensionList(c.fileExtensions || '.mp4'),
          // El tope crece con las páginas pedidas: con uno fijo, 2 o 5 páginas daban lo mismo.
          maxLinks: topeEnlaces,
        },
        { signal, emit: reenviar() }
      );
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
            { ...params, extensions: extensiones, maxLinks: topeEnlaces },
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
              { ...p, extensions: extensiones, maxLinks: topeEnlaces },
              { signal, emit: reenviar({ web: true }) }
            );
          } catch {
            // un listado que falla no corta la búsqueda del sitio
          }
        }
      }
      emit({ type: 'sitio_fin', sitio: sitio.id, total, bloqueo, recortado });
      return { id: sitio.id, total };
    } catch (error) {
      emit({ type: 'sitio_fin', sitio: sitio.id, total, error: error.message });
      return { id: sitio.id, total, error: error.message };
    }
  });

  if (conAbierta && !signal?.aborted) {
    const excluir = new Set(todos.map(s => hostDe(s.perfil.config.searchUrl)).filter(Boolean));
    const r = await buscarEnAbierta(q, { excluir, signal, emit, todosLosItems });
    resumen.push(r);
  }

  // Repetidos: el mismo vídeo en varios sitios (o en varias fichas). Como en el Explorador, no se
  // quita nada: se manda qué es copia de qué y la interfaz los pliega.
  const { grupos } = groupDuplicates(todosLosItems);
  emit({
    type: 'duplicados',
    grupos: grupos
      .filter(g => g.miembros.length > 1)
      .map(g => ({
        representante: g.representante.url,
        miembros: g.miembros.map(m => m.url),
      })),
  });

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
  { url, urls = null, paginas = null, listado = false },
  { signal, emit = () => {} } = {}
) {
  const lista = (urls && urls.length ? urls : [url]).slice(0, config.busqueda.maxEnlacesPegados);
  const porPaginas = Math.min(
    config.busqueda.maxPaginas,
    Math.max(1, Number.parseInt(paginas, 10) || config.busqueda.paginas)
  );
  const nombres = lista.map((u, i) => ({ id: ID_ENLACE - i, nombre: hostDe(u) || u }));
  emit({ type: 'sitios', sitios: nombres });
  const todosLosItems = [];
  const resumen = [];
  for (const [i, u] of lista.entries()) {
    if (signal?.aborted) break;
    const id = ID_ENLACE - i;
    emit({ type: 'sitio_inicio', sitio: id });
    let total = 0;
    const publicar = items => {
      if (items.length === 0) return;
      total += items.length;
      todosLosItems.push(...items);
      emit({ type: 'resultados', sitio: id, items });
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
  const { grupos } = groupDuplicates(todosLosItems);
  emit({
    type: 'duplicados',
    grupos: grupos
      .filter(g => g.miembros.length > 1)
      .map(g => ({ representante: g.representante.url, miembros: g.miembros.map(m => m.url) })),
  });
  return { sitios: resumen, total: resumen.reduce((n, r) => n + r.total, 0) };
}

module.exports = {
  buscarEnTodos,
  buscarEnlace,
  listarSitios,
  nombreCorto,
  ID_WEB_ABIERTA,
  ID_ENLACE,
};
