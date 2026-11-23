'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const { fetchHtmlWithRetry, fetchContentLength } = require('../../lib/http');
const { detectLicense } = require('../../lib/license');
const {
  extractDeclaredVideoUrls,
  extractDurationSeconds,
  extractSizeBytes,
  extractThumbnail,
  extractTitle,
  extractFileThumbnails,
  extractFileDurations,
  formatDuration,
  formatFileSize,
} = require('../../lib/media');
const { asDocument } = require('../../lib/document');
const { analizarRespuesta, analizarError, combinar } = require('../../lib/blocking');
const { findExtension } = require('../extensions');
const { selectRelevantFiles, sizeLooksInconsistent } = require('../../lib/relevance');
const cacheFichas = require('../cacheFichas');
const { renderPageOrFallback } = require('./descarga');

/** FASE 2: abrir cada ficha y sacar sus ficheros, con duración, título, miniatura y peso. */

/** Lo que lee el HTML y la comprobación SSRF por enlace llegan de scraper.js, que arma el motor. */
module.exports = function crear({ extractFilesFromHtml, isUrlSafe }) {
  /**
   * Lo que da UNA ficha: sus ficheros ya separados de los ajenos (relevance.js), cada uno con su
   * duración, título y miniatura. Es lo que guarda la caché de fichas, así que no depende de nada
   * de la exploración en curso (topes, ficheros ya vistos): eso lo aplica quien llama.
   */
  function extraerFicha(
    html,
    doc,
    url,
    { extensions, withThumbnails = false, fichaComoFichero = false }
  ) {
    // Si una extensión reclama esta ficha, extrae ella. Lo que devuelva
    // pasa por las mismas validaciones que el resto: la comprobación
    // SSRF de antes y los topes de después. Una extensión no se salta los
    // límites del motor, solo sabe dónde mirar.
    const extension = findExtension(url);
    let candidatos = extension?.extraerFicheros
      ? extension.extraerFicheros(html, { baseUrl: url, extensions, extractFilesFromHtml })
      : extractFilesFromHtml(doc, url, extensions);
    // Sitio que firma sus ficheros: la ficha misma es lo que se entrega (solo una ficha de vídeo,
    // con su reproductor; un listado o una página de canal no).
    if (
      fichaComoFichero &&
      !candidatos.some(c => !/creatives|\/ads?\//i.test(c)) &&
      /<video|player|mediaDefinition/i.test(html)
    ) {
      candidatos = [url];
    }

    // Una ficha no contiene solo su vídeo: también los clips de vista
    // previa de los relacionados y los anuncios de terceros. Se separa
    // el grano de la paja ANTES de estampar nada.
    const { files: clasificados, discarded } = selectRelevantFiles(
      candidatos,
      url,
      extractDeclaredVideoUrls(doc, url)
    );

    const found = [...new Set(clasificados.map(f => f.url))];
    const porUrl = new Map(clasificados.map(f => [f.url, f]));
    if (found.length === 0) {
      return { detalles: [], descartados: discarded.length, declaredSize: null };
    }

    // Una ficha con UN solo fichero: su duración de página vale para
    // él. Con VARIOS —un álbum— cada uno tiene la suya, y estampar la
    // misma a todos es el mismo fallo que arregló relevance.js con la
    // duración de ficheros dudosos, aplicado esta vez a álbumes en vez
    // de a clips ajenos: un dato real, pero del vídeo equivocado. Por
    // eso el dato de página solo se usa cuando no hay ambigüedad
    // posible; con varios ficheros se intenta primero el dato POR
    // FICHERO (ver extractFileDurations/extractFileThumbnails), que
    // asocia cada `<video poster>`/insignia de duración con su propio
    // `<source>` en vez de repartir un único valor de página.
    const esFicheroUnico = found.length === 1;

    // Se extraen los segundos UNA vez y se formatean, en vez de llamar
    // a extractDuration() y extractDurationSeconds() por separado:
    // extractDuration es literalmente formatDuration(extractDurationSeconds(html)),
    // asi que pedir las dos parseaba el mismo HTML con cheerio dos
    // veces para acabar con el mismo numero. En la fase 2 eso es un
    // parseo completo de mas por CADA pagina de detalle.
    //
    // Se guardan los segundos ademas de la cadena porque la agrupacion
    // de duplicados compara la duracion EXACTA, y "12:34" ya ha perdido
    // precision.
    const paginaDurationSeconds = esFicheroUnico ? extractDurationSeconds(doc) : null;
    const duracionesPorFichero = extractFileDurations(doc, url);
    // Del MISMO documento ya parseado: no cuesta ni petición ni parseo
    const paginaTitulo = extractTitle(doc);
    // La imagen de la ficha (og:image…) vale también cuando la ficha tiene varios ficheros,
    // como reserva para los que no tienen la suya: mejor eso que una miniatura vacía.
    const paginaThumbnail = withThumbnails ? extractThumbnail(doc, url) : null;
    const miniaturasPorFichero = withThumbnails ? extractFileThumbnails(doc, url) : new Map();

    const detalles = found.map(file => {
      // A un fichero que no se ha podido verificar NO se le pone
      // ninguna duración. Es justo lo que convertía un clip de cinco
      // segundos en "20:09": el dato era real, pero de otro vídeo.
      // Sin duración, el usuario ve que no se sabe.
      const info = porUrl.get(file);
      const durationSeconds = info?.suspect
        ? null
        : (duracionesPorFichero.get(file) ?? paginaDurationSeconds);
      return {
        url: file,
        duration: formatDuration(durationSeconds),
        durationSeconds,
        suspect: info?.suspect === true,
        suspectReason: info?.reason || null,
        sourceUrl: url,
        title: paginaTitulo,
        thumbnail: miniaturasPorFichero.get(file) ?? paginaThumbnail,
      };
    });

    return { detalles, descartados: discarded.length, declaredSize: extractSizeBytes(doc) };
  }

  /**
   * FASE 2 — visita cada link y busca ficheros por extensión.
   *
   * Sustituye al esquema de lotes secuenciales anterior por un pool de workers
   * real: en cuanto un worker termina una URL coge la siguiente, sin esperar a
   * que el resto del lote acabe.
   */
  async function findFiles(urls, options) {
    const {
      extensions,
      concurrency,
      useJavaScript,
      // Faltaba en este destructuring aunque `crawl` sí lo pasaba, así que las
      // dos líneas que lo usan lanzaban ReferenceError en CADA URL de la fase 2.
      // El try/catch de abajo lo convertía en un fallo por URL en vez de en un
      // error visible, que es lo que lo mantuvo escondido.
      withSizes = false,
      // Miniaturas: NUNCA por defecto. Son peticiones extra a los sitios
      // explorados, así que solo si el usuario las pide.
      withThumbnails = false,
      /** Sin fichero en la ficha, se entrega la propia ficha (lo resuelve el gestor de descargas). */
      fichaComoFichero = false,
      licenseFilter,
      signal,
      /**
       * Objeto con `.pausado`. Cuando se pone a true, los workers dejan de
       * COGER trabajo nuevo pero los que ya están en vuelo terminan: frenar no
       * es abortar, y tirar a medias una página ya descargada sería perder
       * trabajo hecho por nada.
       */
      pausa = null,
      /** Usar la caché de fichas (services/cacheFichas.js): la piden Buscar y las programadas. */
      usarCache = false,
      onProgress,
      onFilesFound,
      /**
       * CS-09: avisa de cada ficha TERMINADA (no de las que se empiezan, como `onProgress`):
       * con ellas una búsqueda cortada por un reinicio sigue por las que faltaban.
       */
      onFichaHecha,
    } = options;

    const files = new Set();
    // Metadatos por fichero. La duracion sale del HTML que ya se descargo para
    // buscar los ficheros, asi que no cuesta ninguna peticion extra.
    const details = new Map();
    const failures = [];

    /**
     * Sospecha de bloqueo observada en ESTA fase.
     *
     * La fase 1 ya la acumulaba y la fase 2 no miraba nada: un sitio que empieza
     * a responder 429 a mitad del recorrido dejaba sus fallos enterrados en
     * `failures`, sin motivo, indistinguibles de "esa ficha no tenía nada".
     * Es SOSPECHA, no diagnóstico (ver lib/blocking.js), y no cambia lo que se
     * descarga ni lo que se devuelve: solo se apunta.
     *
     * Lo comparten todos los workers, que corren concurrentes sobre el mismo
     * cursor; `combinar` funde sin repetir motivos.
     */
    let bloqueo = { sospechoso: false, motivos: [] };
    const anotarBloqueo = observacion => {
      if (observacion?.sospechoso) bloqueo = combinar([bloqueo, observacion]);
    };

    const skippedByLicense = [];
    let processed = 0;
    let truncated = false;
    // Ficheros de la página que NO eran de la página (anuncios, previews de
    // los relacionados). Se cuentan para que la omisión no sea silenciosa.
    let descartados = 0;

    let limit = Math.min(
      Math.max(1, concurrency ?? config.crawl.defaultConcurrency),
      config.crawl.maxConcurrency
    );

    // Con navegador, la concurrencia real la marca el pool de pestañas: lanzar
    // 12 workers contra un pool de 2 solo genera cola. Se ajusta el límite para
    // que el progreso que ve el usuario refleje lo que de verdad ocurre.
    if (useJavaScript) {
      limit = Math.min(limit, config.browser.poolSize);
    }

    let cursor = 0;

    async function worker() {
      while (cursor < urls.length) {
        if (signal?.aborted || truncated) return;
        // Frenado: no se coge nada más. `cursor` queda justo en el primer
        // pendiente, que es lo que se guarda para poder continuar.
        if (pausa?.pausado) return;

        const index = cursor;
        cursor += 1;
        const url = urls[index];

        onProgress?.({ current: index + 1, total: urls.length, url });

        // Los links vienen de HTML de terceros: revalidar antes de pedirlos
        if (!(await isUrlSafe(url))) {
          failures.push({ url, error: 'Destino bloqueado por política de seguridad' });
          processed += 1;
          continue;
        }

        try {
          // Caché de fichas (solo si quien llama la pide: Buscar y programadas). Con el filtro de
          // licencia no se usa, porque ese filtro necesita el documento entero.
          const opcionesCache = { extensions, withThumbnails, fichaComoFichero };
          let ficha =
            usarCache && licenseFilter !== 'open-only' ? cacheFichas.get(url, opcionesCache) : null;

          if (!ficha) {
            // La fase 2 iba SIEMPRE por HTTP plano, así que en sitios que sirven
            // el reproductor con JavaScript encontraba los enlaces pero ningún
            // fichero, y en los que bloquean clientes sin navegador fallaba entera.
            const html = useJavaScript
              ? await renderPageOrFallback(url, { signal, scroll: false })
              : await fetchHtmlWithRetry(url, { signal, timeout: config.http.fileScanTimeoutMs });

            // Un challenge servido con 200 llega por el camino bueno y se ve igual
            // de bien que una ficha: hay que mirar el contenido, no solo el estado.
            anotarBloqueo(analizarRespuesta({ html }));

            /**
             * UN solo parseo por ficha, repartido entre los cuatro extractores.
             *
             * De cada página de detalle se sacan los ficheros, la licencia, la
             * duración y el tamaño, y cada uno hacía su propio `cheerio.load()`
             * del MISMO documento: hasta cuatro parseos completos para leer
             * cuatro datos.
             *
             * Se declara AQUÍ, antes del filtro de licencia, porque ese filtro es
             * el primero que lo usa. Declararlo más abajo lo dejaba en zona
             * muerta temporal, que en este proyecto ya tumbó una barra entera.
             *
             * A las extensiones por sitio se les sigue pasando el HTML en crudo:
             * su contrato es público y puede que no usen cheerio.
             */
            const doc = asDocument(html);

            // Filtro de licencia: solo se conserva lo que el publicador declara
            // explícitamente como abierto. Sin declaración se asume cerrado,
            // porque por defecto una obra nace con todos los derechos reservados.
            if (licenseFilter === 'open-only') {
              const license = detectLicense(doc);
              if (!license.isOpen) {
                skippedByLicense.push({
                  url,
                  reason: license.declared
                    ? `licencia no abierta (${license.value})`
                    : 'sin licencia declarada',
                });
                processed += 1;
                continue;
              }
            }

            ficha = extraerFicha(html, doc, url, { extensions, withThumbnails, fichaComoFichero });
            if (usarCache && licenseFilter !== 'open-only') {
              cacheFichas.set(url, opcionesCache, ficha);
            }
          }

          if (ficha.descartados > 0) {
            descartados += ficha.descartados;
            logger.debug(`Descartados ${ficha.descartados} ficheros ajenos en ${url}`);
          }

          if (ficha.detalles.length > 0) {
            // Del mismo HTML sale también el tamaño que el sitio muestra en
            // pantalla. Se calcula una sola vez por ficha, aunque de ella
            // salgan varios ficheros.
            const declaredSize = withSizes ? ficha.declaredSize : null;
            const added = [];

            for (const detalle of ficha.detalles) {
              if (files.size >= config.crawl.maxFiles) {
                truncated = true;
                break;
              }
              if (!files.has(detalle.url)) {
                files.add(detalle.url);
                added.push(detalle.url);
                // Copia: lo que se toque después (pesos, sospecha) no debe ensuciar la caché.
                details.set(detalle.url, { ...detalle });
              }
            }

            if (withSizes) {
              for (const file of added) {
                if (signal?.aborted) break;

                // El HEAD es la fuente exacta, pero muchas URLs de fichero
                // redirigen a una dirección con token que no devuelve
                // content-length y vuelve null.
                // Se envía la ficha como Referer: sin ella los CDN con
                // protección de hotlinking devuelven 403 y el peso se pierde.
                const bytes = await fetchContentLength(file, { signal, referer: url });
                const meta = details.get(file);
                if (!meta) continue;

                if (bytes !== null) {
                  meta.sizeBytes = bytes;
                  meta.size = formatFileSize(bytes);
                  meta.sizeApproximate = false;
                  // Coherencia: una ficha que anuncia minutos y un fichero
                  // que pesa como un clip no pueden ser el mismo vídeo. Se
                  // marca en vez de descartar, porque el raro podría ser el
                  // dato de la ficha.
                  if (sizeLooksInconsistent(meta.durationSeconds, bytes)) {
                    meta.suspect = true;
                    meta.suspectReason =
                      'el peso no cuadra con la duración anunciada: puede ser una vista previa';
                    meta.duration = null;
                    meta.durationSeconds = null;
                  }
                } else if (declaredSize !== null) {
                  // Respaldo: lo que el sitio dice en la ficha. Va marcado
                  // como aproximado porque viene redondeado de origen, y
                  // ademas la ficha describe el video, no necesariamente
                  // este fichero concreto.
                  meta.sizeBytes = declaredSize;
                  meta.size = formatFileSize(declaredSize);
                  meta.sizeApproximate = true;
                }
              }
            }

            if (added.length > 0) {
              onFilesFound?.({ url, files: added, details: added.map(f => details.get(f)) });
            }
          }
        } catch (error) {
          // El cliente HTTP rechaza los 4xx, así que un bloqueo por código de
          // estado llega SIEMPRE por aquí y nunca por el camino normal. Sin el
          // log y sin el análisis, una racha de 429 quedaba solo como una lista
          // de `failures` sin motivo, que es lo que hacía imposible distinguir
          // "me están cerrando la puerta" de "esas fichas no tenían nada".
          logger.warn(`No se pudo procesar la ficha ${url}`, error.message);
          anotarBloqueo(analizarError(error));
          failures.push({ url, error: error.message });
        } finally {
          processed += 1;
          // Cortada a medias no cuenta como hecha: al retomar se vuelve a mirar.
          if (!signal?.aborted) onFichaHecha?.(url);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, () => worker()));

    return {
      files: [...files],
      details: [...details.values()],
      processed,
      failures,
      truncated,
      discardedFiles: descartados,
      skippedByLicense,
      // Interno, para que `crawl` lo funda en el `diagnostico` que ya viaja al
      // cliente: NO es un campo nuevo de la respuesta pública.
      bloqueo,
      // Lo que faltaba por mirar cuando se frenó
      pendientes: pausa?.pausado ? urls.slice(cursor) : [],
      paused: Boolean(pausa?.pausado),
    };
  }

  return { extraerFicha, findFiles };
};
