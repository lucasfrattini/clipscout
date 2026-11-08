'use strict';

const config = require('../config');
const { readProfiles } = require('./profiles');
const { crawl, normalizeCrawlParams } = require('./scraper');
const { hasSearchTemplate, parseExtensionList } = require('../lib/url');
const { mapLimit } = require('../lib/concurrency');

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

/**
 * @param {object} entrada  { q, sitios: [ids] | null (todos) }
 * @param {object} opciones { signal, emit }
 */
async function buscarEnTodos(
  { q, sitios = null, paginas = null },
  { signal, emit = () => {} } = {}
) {
  const porSitio = Math.min(
    config.busqueda.maxPaginas,
    Math.max(1, Number.parseInt(paginas, 10) || config.busqueda.paginas)
  );
  const todos = await listarSitios();
  const elegidos = sitios ? todos.filter(s => sitios.includes(s.id)) : todos;

  emit({ type: 'sitios', sitios: elegidos.map(s => ({ id: s.id, nombre: s.nombre })) });

  const resumen = await mapLimit(elegidos, config.busqueda.sitiosALaVez, async sitio => {
    if (signal?.aborted) return { id: sitio.id, total: 0, cancelado: true };
    const c = sitio.perfil.config;
    emit({ type: 'sitio_inicio', sitio: sitio.id });
    let total = 0;
    try {
      const params = normalizeCrawlParams({
        ...c,
        searchTerm: q,
        // Las páginas las elige quien busca (no el rango guardado en la configuración).
        endPage: (Number.parseInt(c.startPage, 10) || 1) + porSitio - 1,
        withThumbnails: true,
      });
      const resultado = await crawl(
        { ...params, extensions: parseExtensionList(c.fileExtensions || '.mp4') },
        {
          signal,
          emit: evento => {
            if (evento.type === 'files_found') {
              const items = (evento.details || []).filter(Boolean);
              total += items.length;
              emit({ type: 'resultados', sitio: sitio.id, items });
            } else if (evento.type === 'phase1_complete') {
              emit({ type: 'sitio_progreso', sitio: sitio.id, enlaces: evento.totalLinks });
            } else if (evento.type === 'phase2_progress') {
              emit({
                type: 'sitio_progreso',
                sitio: sitio.id,
                hechos: evento.current,
                enlaces: evento.total,
              });
            }
          },
        }
      );
      const bloqueo = resultado.diagnostico?.bloqueo?.sospechoso === true;
      emit({ type: 'sitio_fin', sitio: sitio.id, total, bloqueo });
      return { id: sitio.id, total };
    } catch (error) {
      emit({ type: 'sitio_fin', sitio: sitio.id, total, error: error.message });
      return { id: sitio.id, total, error: error.message };
    }
  });

  return { sitios: resumen, total: resumen.reduce((n, r) => n + (r?.total || 0), 0) };
}

module.exports = { buscarEnTodos, listarSitios, nombreCorto };
