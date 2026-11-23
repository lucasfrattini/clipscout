'use strict';

const config = require('../../config');
const { AppError } = require('../../lib/errors');
const { groupDuplicates } = require('../../lib/dedupe');
const { combinar } = require('../../lib/blocking');

/**
 * El crawl completo: fase 1, fase 2 y agrupación de duplicados, para una dirección (`crawl`) o
 * para varias con la misma configuración (`crawlMany`).
 */

/** Las dos fases y la comprobación SSRF de la dirección de partida llegan de scraper.js. */
module.exports = function crear({ assertUrlIsSafe, collectLinks, findFiles }) {
  /**
   * Da forma de salida a los grupos de duplicados: solo los que tienen más de
   * un miembro y con las URLs en vez de los objetos completos. Es la forma que
   * espera el cliente, y la usan por igual `crawl` y `crawlMany`.
   */
  function mapearGrupos(grupos) {
    return grupos
      .filter(g => g.miembros.length > 1)
      .map(g => ({
        representante: g.representante.url,
        miembros: g.miembros.map(m => m.url),
        motivos: g.motivos,
      }));
  }

  /**
   * Crawl completo: fase 1 (+ fase 2 si hay extensiones).
   * `emit` recibe los eventos de progreso; es lo que alimenta el SSE.
   */
  async function crawl(params, opciones = {}) {
    const {
      signal,
      emit = () => {},
      pausa = null,
      /** Enlaces ya obtenidos: al continuar, la fase 1 no se repite. */
      linksPrevios = null,
      /** Ficheros ya encontrados antes de frenar, para fundirlos al final. */
      detallesPrevios = [],
      /**
       * Agrupar duplicados aquí mismo (por defecto). Se pone a `false` cuando
       * este crawl es UNA de varias direcciones de un lote multi-URL: entonces
       * la agrupación NO puede correr por dirección, porque dos copias del mismo
       * vídeo halladas en direcciones distintas no se verían nunca como
       * duplicadas. La hace `crawlMany` UNA sola vez sobre la fusión de todas.
       */
      group = true,
      /** CS-09: la lista de fichas de la fase 1, en cuanto se tiene (para poder retomar). */
      alTenerEnlaces = null,
      /** CS-09: cada ficha de la fase 2 ya terminada. */
      alTerminarFicha = null,
    } = opciones;
    const {
      searchUrl,
      pageParam = '',
      paginationMode = 'auto',
      linkPattern = '',
      startPage = 1,
      endPage = 10,
      useJavaScript = false,
      extensions = [],
      concurrency,
      licenseFilter = 'off',
      withSizes = false,
      withThumbnails = false,
      fichaComoFichero = false,
      /** Tope de fichas a revisar en la fase 2 (la pestaña Buscar: una búsqueda rápida). 0 = sin tope. */
      maxLinks = 0,
      /** Caché de fichas compartida entre búsquedas (Buscar). El Explorador va siempre fresco. */
      usarCache = false,
    } = params;

    await assertUrlIsSafe(searchUrl);

    const startedAt = Date.now();

    // Señal compuesta: aborta si el cliente se desconecta O si el crawl supera
    // su duración máxima. Debe ser un AbortSignal real: axios llama a
    // signal.addEventListener, así que un objeto con un getter `aborted` no vale.
    const timeoutSignal = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(config.crawl.maxDurationMs),
    ]);

    /**
     * Al CONTINUAR no se repite la fase 1.
     *
     * Los enlaces ya se recorrieron antes de frenar; volver a pedirlos sería
     * machacar el sitio para llegar exactamente a la misma lista.
     */
    let links = linksPrevios;
    let pagesScraped = 0;
    let linksTruncated = false;
    let scrollInfo = null;
    let modoUsado = paginationMode;
    let diagnostico = null;

    if (links === null) {
      emit({ type: 'phase1_start' });

      const fase1 = await collectLinks({
        searchUrl,
        pageParam,
        paginationMode,
        linkPattern,
        startPage,
        endPage,
        useJavaScript,
        signal: timeoutSignal,
        onProgress: progress => emit({ type: 'phase1_progress', ...progress }),
      });

      links = fase1.links;
      pagesScraped = fase1.pagesScraped;
      linksTruncated = fase1.truncated;
      // Se avisa (truncated) en vez de recortar en silencio: quien lo pidió sabe que hay más.
      if (maxLinks > 0 && links.length > maxLinks) {
        links = links.slice(0, maxLinks);
        linksTruncated = true;
      }
      scrollInfo = fase1.scroll;
      modoUsado = fase1.paginationMode;
      diagnostico = fase1.diagnostico;

      emit({
        type: 'phase1_complete',
        totalLinks: links.length,
        pagesScraped,
        truncated: linksTruncated,
        pattern: linkPattern || null,
        paginationMode: modoUsado,
        scroll: scrollInfo || null,
        diagnostico,
      });
      alTenerEnlaces?.(links);
    }

    let files = [];
    let fileDetails = [];
    let failures = [];
    let filesTruncated = false;
    let skippedByLicense = [];
    let discardedFiles = 0;
    let pendientes = [];
    let paused = false;

    if (extensions.length > 0 && links.length > 0 && !timeoutSignal.aborted) {
      emit({ type: 'phase2_start', totalPages: links.length });

      const result = await findFiles(links, {
        extensions,
        concurrency,
        useJavaScript,
        licenseFilter,
        withSizes,
        withThumbnails,
        fichaComoFichero,
        usarCache,
        pausa,
        signal: timeoutSignal,
        onProgress: progress => emit({ type: 'phase2_progress', ...progress }),
        onFilesFound: payload => emit({ type: 'files_found', ...payload }),
        onFichaHecha: alTerminarFicha,
      });

      files = result.files;
      fileDetails = result.details ?? [];
      pendientes = result.pendientes ?? [];
      paused = result.paused === true;
      failures = result.failures;
      filesTruncated = result.truncated;
      skippedByLicense = result.skippedByLicense ?? [];
      discardedFiles = result.discardedFiles ?? 0;

      /**
       * La sospecha de bloqueo de la fase 2 va al MISMO campo que la de la fase
       * 1: el cliente ya lee `diagnostico.bloqueo` y lo enseña. Un campo aparte
       * sería un aviso que nadie muestra.
       */
      if (diagnostico) {
        diagnostico.bloqueo = combinar([diagnostico.bloqueo, result.bloqueo]);
      } else if (result.bloqueo?.sospechoso) {
        // Al CONTINUAR un trabajo frenado no se repite la fase 1, así que no hay
        // diagnóstico previo que rellenar. Se crea con la forma que el cliente
        // ya espera, y solo si hay algo que decir: un objeto con todo a cero no
        // aportaría nada.
        diagnostico = { enlacesVistos: 0, prefijos: [], bloqueo: result.bloqueo };
      }
    }

    // Distinguir "lo canceló el usuario" de "se agotó el tiempo máximo": con
    // navegador en la fase 2 lo segundo es fácil de alcanzar, y decir
    // aborted:false ocultaba que el resultado estaba incompleto.
    const cancelled = Boolean(signal?.aborted);
    const timedOut = timeoutSignal.aborted && !cancelled;

    // Agrupación de duplicados. NO filtra nada: se devuelven todos los ficheros
    // igual que antes, y los grupos van aparte para que la interfaz pueda
    // plegarlos y el usuario deshacerlo. Descartar en silencio le haría perder
    // resultados legítimos sin enterarse.
    /**
     * Al continuar, lo de antes y lo nuevo son UNA sola lista.
     *
     * Se funden ANTES de agrupar duplicados: si se agrupara cada tanda por su
     * cuenta, dos copias del mismo vídeo encontradas en tandas distintas no se
     * verían nunca como duplicadas. El usuario frenó y siguió; para él es una
     * exploración, no dos.
     */
    if (detallesPrevios.length > 0) {
      const porUrl = new Map(detallesPrevios.map(d => [d.url, d]));
      for (const detalle of fileDetails) porUrl.set(detalle.url, detalle);
      fileDetails = [...porUrl.values()];
      files = [...new Set([...detallesPrevios.map(d => d.url), ...files])];
    }

    // En un lote multi-URL la agrupación NO corre aquí: `crawlMany` la hace una
    // sola vez sobre la fusión de todas las direcciones. Agrupar por dirección
    // dejaría escapar los duplicados que están repartidos entre ellas.
    const { grupos, totalDuplicados } = group
      ? groupDuplicates(fileDetails)
      : { grupos: [], totalDuplicados: 0 };

    /**
     * Segunda agrupacion, mas agresiva: la duracion sola basta.
     *
     * Se calcula aqui y se manda junto a la conservadora para que el usuario
     * pueda cambiar de modo sin volver a explorar. Cuesta otra pasada, pero la
     * agrupacion son ~33 ms con 2000 ficheros.
     *
     * NO es el modo por defecto, y el motivo esta medido: ver lib/dedupe.js.
     * Con mil resultados, agrupar solo por duracion esconde uno de cada cuatro
     * videos buenos detras de otro que no tiene nada que ver.
     */
    const porDuracion = group
      ? groupDuplicates(fileDetails, { soloDuracion: true })
      : { grupos: [], totalDuplicados: 0 };

    return {
      links,
      files,
      fileDetails,
      duplicateGroups: mapearGrupos(grupos),
      totalDuplicados,
      duplicateGroupsPorDuracion: mapearGrupos(porDuracion.grupos),
      totalDuplicadosPorDuracion: porDuracion.totalDuplicados,
      failures,
      pagesScraped,
      totalLinks: links.length,
      totalFiles: files.length,
      extensions,
      truncated: linksTruncated || filesTruncated,
      licenseFilter,
      skippedByLicense: skippedByLicense.length,
      // Ficheros que estaban en la página pero no eran suyos
      discardedFiles,
      suspectFiles: fileDetails.filter(d => d.suspect).length,
      /**
       * Por qué el resultado puede estar vacío.
       *
       * `enlacesVistos` cuenta TODOS los enlaces de las páginas recorridas,
       * casen o no con el patrón: comparado con `totalLinks` dice si el patrón
       * se lo llevó todo por delante. `prefijos` son las rutas más repetidas,
       * como pista de qué patrón querría el usuario. `bloqueo` es una SOSPECHA
       * de que el sitio esté rechazando peticiones automáticas.
       */
      diagnostico,
      /**
       * Frenado a medias: quedan enlaces por mirar y se pueden continuar.
       * `pendientes` NO va al cliente —son miles de URLs— sino que lo guarda
       * el registro de trabajos; ver routes/scrape.js.
       */
      paused,
      pendientes,
      aborted: cancelled,
      timedOut,
      maxDurationMs: config.crawl.maxDurationMs,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Funde los diagnósticos de fase 1 de varias direcciones en uno solo.
   *
   * `enlacesVistos` se suma, los prefijos se acumulan y se quedan los tres más
   * repetidos del conjunto, y la sospecha de bloqueo se combina sin repetir
   * motivos. Con una sola dirección se devuelve tal cual, para que el lote de
   * una URL no cambie la forma que ya conoce el cliente.
   */
  function fusionarDiagnosticos(diagnosticos) {
    if (!Array.isArray(diagnosticos) || diagnosticos.length === 0) return null;
    if (diagnosticos.length === 1) return diagnosticos[0];

    let enlacesVistos = 0;
    const prefijos = new Map();
    const bloqueos = [];
    for (const d of diagnosticos) {
      enlacesVistos += d.enlacesVistos || 0;
      for (const { prefijo, veces } of d.prefijos || []) {
        prefijos.set(prefijo, (prefijos.get(prefijo) || 0) + veces);
      }
      if (d.bloqueo) bloqueos.push(d.bloqueo);
    }
    const prefijosTop = [...prefijos.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([prefijo, veces]) => ({ prefijo, veces }));

    return { enlacesVistos, prefijos: prefijosTop, bloqueo: combinar(bloqueos) };
  }

  /**
   * Explora VARIAS direcciones con la MISMA configuración y agrupa los
   * duplicados UNA sola vez sobre la fusión de todas.
   *
   * Por qué existe: si cada dirección se agrupara por su cuenta, dos copias del
   * mismo vídeo halladas en direcciones distintas no se verían nunca como
   * duplicadas. Es la misma razón por la que continuar una exploración funde
   * antes de agrupar. Cada dirección se recorre con `crawl(..., { group:false })`
   * —reutilizando fase 1, fase 2, SSRF, topes y throttle tal cual, sin abrir
   * conexiones nuevas— y aquí solo se fusiona y se agrupa.
   *
   * Frenar y continuar operan A NIVEL DE LOTE: la dirección en curso se frena
   * como siempre (deja de coger enlaces de fase 2, termina lo que tiene en
   * vuelo) y las direcciones que faltan no se arrancan. Al continuar se sigue
   * por la dirección interrumpida —sin repetir su fase 1— y después por las
   * pendientes. El estado para continuar viaja en `estadoReanudar`, que guarda
   * el registro de trabajos; el cliente solo lleva el id.
   *
   * @param {{listaParams: object[], extensions?: string[]}} entrada
   */
  async function crawlMany(entrada, opciones = {}) {
    const { listaParams, extensions = [] } = entrada;
    const { signal, emit = () => {}, pausa = null, reanudar = null } = opciones;

    if (!Array.isArray(listaParams) || listaParams.length === 0) {
      throw new AppError('Se requiere al menos una searchUrl', 400, 'SEARCH_URL_REQUIRED');
    }

    const total = listaParams.length;
    const startedAt = Date.now();

    // Fusión de detalles por URL de fichero. La última descripción gana, igual
    // que al continuar: dos direcciones pueden traer el mismo fichero.
    const detallesFusion = new Map();
    for (const d of reanudar?.detallesPrevios ?? []) detallesFusion.set(d.url, d);

    const linksTotales = new Set();
    const failures = [];
    const diagnosticos = [];
    let pagesScraped = 0;
    let truncated = false;
    let skippedByLicense = 0;
    let discardedFiles = 0;
    let aborted = false;
    let timedOut = false;

    let direccionesAnalizadas = reanudar?.direccionesPrevias ?? 0;
    const indiceInicio = reanudar?.indice ?? 0;

    let pausadoEnLote = false;
    let estadoReanudar = null;

    for (let i = indiceInicio; i < total; i += 1) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      // Frenado ENTRE direcciones: no se arranca la siguiente. Lo que falta es
      // esta dirección entera (aún sin empezar) y las que vengan detrás.
      if (pausa?.pausado) {
        pausadoEnLote = true;
        estadoReanudar = {
          indice: i,
          detallesPrevios: [...detallesFusion.values()],
          linksPendientes: [],
          direccionesPrevias: direccionesAnalizadas,
        };
        break;
      }

      const pUrl = listaParams[i];

      // Solo la dirección interrumpida arranca con sus enlaces pendientes: su
      // fase 1 ya se recorrió antes de frenar. Las demás empiezan de cero.
      const continuaInterrumpida =
        Boolean(reanudar) && i === indiceInicio && (reanudar.linksPendientes?.length ?? 0) > 0;

      emit({ type: 'url_start', urlActual: i + 1, urlTotal: total, searchUrl: pUrl.searchUrl });
      // Cada evento de progreso lleva en qué dirección va el lote, para que el
      // cliente pueda decir "dirección i de N".
      const emitUrl = evento => emit({ ...evento, urlActual: i + 1, urlTotal: total });

      const res = await crawl(
        { ...pUrl, extensions },
        {
          signal,
          emit: emitUrl,
          pausa,
          group: false,
          linksPrevios: continuaInterrumpida ? reanudar.linksPendientes : null,
          detallesPrevios: [],
        }
      );

      for (const d of res.fileDetails) detallesFusion.set(d.url, d);
      for (const l of res.links) linksTotales.add(l);
      failures.push(...res.failures);
      pagesScraped += res.pagesScraped;
      truncated = truncated || res.truncated;
      skippedByLicense += res.skippedByLicense;
      discardedFiles += res.discardedFiles;
      if (res.diagnostico) diagnosticos.push(res.diagnostico);
      if (res.timedOut) timedOut = true;

      if (res.aborted) {
        aborted = true;
        break;
      }

      // Frenado A MEDIAS de esta dirección: su fase 2 dejó enlaces sin mirar.
      // Se continúa POR ELLA, no por la siguiente.
      if (res.paused) {
        pausadoEnLote = true;
        estadoReanudar = {
          indice: i,
          detallesPrevios: [...detallesFusion.values()],
          linksPendientes: res.pendientes,
          direccionesPrevias: direccionesAnalizadas,
        };
        break;
      }

      // La dirección se recorrió entera y con éxito.
      direccionesAnalizadas += 1;

      if (timedOut) break;
    }

    const fileDetails = [...detallesFusion.values()];
    const files = fileDetails.map(d => d.url);

    // La agrupación corre UNA vez sobre la fusión: es la razón de ser de este
    // orquestador. Igual que en `crawl`, no filtra nada, solo agrupa.
    const { grupos, totalDuplicados } = groupDuplicates(fileDetails);
    const porDuracion = groupDuplicates(fileDetails, { soloDuracion: true });

    const cancelled = Boolean(signal?.aborted) || aborted;

    return {
      links: [...linksTotales],
      files,
      fileDetails,
      duplicateGroups: mapearGrupos(grupos),
      totalDuplicados,
      duplicateGroupsPorDuracion: mapearGrupos(porDuracion.grupos),
      totalDuplicadosPorDuracion: porDuracion.totalDuplicados,
      failures,
      pagesScraped,
      totalLinks: linksTotales.size,
      totalFiles: files.length,
      extensions,
      truncated,
      licenseFilter: listaParams[0].licenseFilter,
      skippedByLicense,
      discardedFiles,
      suspectFiles: fileDetails.filter(d => d.suspect).length,
      diagnostico: fusionarDiagnosticos(diagnosticos),
      // Detalle por dirección: el `diagnostico` fundido es para el resumen; este
      // permite que el cliente explique un vacío dirección por dirección.
      diagnosticoPorUrl: diagnosticos,
      // Cuántas direcciones se recorrieron con éxito, de cuántas se pidieron.
      direccionesAnalizadas,
      direccionesTotal: total,
      /**
       * Frenado a medias del lote. `estadoReanudar` NO viaja al cliente —lleva
       * miles de URLs pendientes— sino que lo guarda el registro de trabajos.
       * `pendientesTotal` es solo el número, para avisar sin descarte silencioso.
       */
      paused: pausadoEnLote,
      pendientes: pausadoEnLote ? estadoReanudar.linksPendientes : [],
      pendientesTotal: pausadoEnLote ? estadoReanudar.linksPendientes.length : 0,
      estadoReanudar,
      aborted: cancelled,
      timedOut,
      maxDurationMs: config.crawl.maxDurationMs,
      durationMs: Date.now() - startedAt,
    };
  }

  return { crawl, crawlMany, mapearGrupos, fusionarDiagnosticos };
};
