/**
 * English dictionary.
 *
 * Must contain EXACTLY the same keys as `es.js` — there is a test that fails
 * otherwise, because a forgotten translation raises no error at runtime: the
 * string simply shows up in the other language and the selector looks broken.
 *
 * Note: some strings deliberately contain `{q}` and `{page}`. Those are the
 * URL templates the user types, not interpolation slots, and they survive
 * because `t()` leaves unknown placeholders untouched. There is a test.
 */
export const en = {
  /* ── Header and navigation ─────────────────────────────────────── */
  'app.subtitulo': "Explore a site's links and resources",
  'app.saltar': 'Skip to content',
  'nav.aria': 'Tools',
  'nav.explorador': 'Explorer',
  'nav.videos': 'Videos',
  'tema.cambiar': 'Switch theme',
  'tema.actual': 'Theme: {modo}',
  'tema.modo.system': 'system',
  'tema.modo.light': 'light',
  'tema.modo.dark': 'dark',
  'idioma.aria': 'Language',
  'idioma.es': 'Spanish',
  'idioma.en': 'English',
  'idioma.cambiado': 'Language: English',

  /* ── Document head (<title> and meta description) ──────────────── */
  'head.explorer.titulo': 'Link explorer — clipscout',
  'head.explorer.desc':
    'Walk the pages of a section, pull out the links matching a pattern and look for files inside each one.',
  'head.video.titulo': 'Video analysis — clipscout',
  'head.video.desc':
    'Analyse a single URL in depth and find the videos inside it, with their duration and size.',

  /* ── Service status ────────────────────────────────────────────── */
  'salud.comprobando': 'Verifying service…',
  'salud.activo': 'Service up · browser {estado} · max. {paginas} pages per search',
  'salud.navegador.disponible': 'available',
  'salud.navegador.desactivado': 'disabled',
  'salud.error': 'Could not reach the server. Falling back to the default limits.',

  /* ── Network errors ────────────────────────────────────────────── */
  'api.sinConexion': 'Could not reach the server: {mensaje}',
  'api.errorHttp': 'Error {status}',
  'api.sseCaida': 'Lost the connection to the server during the search.',

  /* ── Clipboard ─────────────────────────────────────────────────── */
  'copiar.estaUrl': 'Copy this URL',
  'copiar.urlCopiada': 'URL copied',
  'copiar.fallo': 'Could not copy',

  /* ── Modal dialog (own prompt/confirm) ──────────────────────────── */
  'dialogo.aceptar': 'Accept',
  'dialogo.cancelar': 'Cancel',

  /* ── Saved setups bar ──────────────────────────────────────────── */
  'perfiles.etiqueta': 'Setup',
  'perfiles.aria': 'Saved setups',
  'perfiles.elige': '— Pick a saved setup —',
  'perfiles.guardar': 'Save',
  'perfiles.borrar': 'Delete',
  'perfiles.copiarEnlace': 'Copy link',
  'perfiles.copiarEnlace.title': 'Copies a link that opens the app with this setup',
  'perfiles.enlaceCopiado': 'Link copied to the clipboard',
  'perfiles.cargada': 'Setup “{nombre}” loaded',
  'perfiles.nombrePrompt': 'Name for this setup:',
  'perfiles.nombreVacio': 'The name cannot be empty',
  'perfiles.guardado': '“{nombre}” saved',
  'perfiles.confirmarSobrescritura': 'A setup named “{nombre}” already exists. Overwrite it?',
  'perfiles.confirmarBorrado': 'Delete the setup “{nombre}”?',
  'perfiles.borrado': '“{nombre}” deleted',
  'perfiles.noGuardado': 'Could not save: {mensaje}',
  'perfiles.noCargadas': 'Could not load the saved setups: {mensaje}',

  /* ── Progress ──────────────────────────────────────────────────── */
  'progreso.fase1': '1 · Walk the pages',
  'progreso.fase2': '2 · Look for files',
  'progreso.enEspera': 'Waiting',
  'progreso.cancelar': 'Cancel',
  'progreso.ficherosAria': 'Files found',
  'progreso.descargando': 'Downloading the first page…',
  'progreso.paginaDe': 'Page {actual} of {total} · {enlaces} links',
  'progreso.topeAlcanzado': ' (limit reached)',
  'progreso.resumenFase1.uno': '{enlaces} links across {n} page{sufijo}',
  'progreso.resumenFase1.varios': '{enlaces} links across {n} pages{sufijo}',
  'progreso.analizando': 'Scanning {total} pages…',
  'progreso.deTotal': '{actual} of {total} · {url}',
  'progreso.direccion': 'Address {actual} of {total} · {url}',
  'progreso.hallados.uno': '{n} file found',
  'progreso.hallados.varios': '{n} files found',
  'progreso.frenar': 'Stop',
  'progreso.frenar.title':
    'Stops here and groups what was found. You can continue where you left off.',
  'progreso.frenando': 'Stopping…',
  'progreso.frenada': 'Stopped: {n} links not checked',
  'explorer.continuar': 'Continue where I left off',
  'explorer.continuar.title': 'Carries on with the {n} links left unchecked',
  'aviso.frenada': 'Exploration stopped',
  'aviso.frenada.body':
    '{n} links were left unchecked. What was found so far is already grouped and sorted. Press “Continue where I left off” to carry on, or keep just this.',
  'error.trabajoCaducado': 'That stopped exploration is no longer available',
  'error.trabajoCaducado.body':
    'It is kept in memory and expires, or the server restarted. You have to start again.',
  'progreso.cancelada': 'Search cancelled',

  /* ── Range filters ─────────────────────────────────────────────── */
  'rango.minimo': '{label}, minimum',
  'rango.maximo': '{label}, maximum',
  'rango.sinDatos': 'no data',

  /* ── Result list ───────────────────────────────────────────────── */
  'resultados.titulo': 'Results',
  'resultados.cero': '0 results',
  'resultados.total.uno': '{n} result',
  'resultados.total.varios': '{n} results',
  'resultados.mostrando': 'showing {visibles} of {total}',
  'resultados.plegados': '{n} collapsed as duplicates',
  'resultados.copiar': 'Copy all',
  'resultados.descargar': 'Download .txt',
  'resultados.exportar': 'Export ▾',
  'resultados.copiados': '{n} links copied',
  'resultados.noCopiado': 'Could not copy to the clipboard',
  'resultados.descargados': '{n} links downloaded',
  'resultados.csv': 'CSV',
  'resultados.json': 'JSON',
  'resultados.lista': 'List',
  'resultados.lista.title': 'One URL per line, to paste into a download manager',
  'resultados.exportados': '{n} results exported as {formato}',
  'resultados.ocultar': 'Remove this result',
  'resultados.deshacer': 'Undo',
  'resultados.deshacer.title': 'Brings back the last ones you removed',
  'resultados.restaurar': 'Restore removed ({n})',
  'resultados.restaurar.title': 'Brings back every result you have removed',
  'resultados.ocultados': '{n} removed',
  'resultados.grupo.desplegar': 'Show the {n} grouped',
  'resultados.grupo.plegar': 'Hide the grouped ones',
  'resultados.grupo.noEsDuplicado': 'Not a duplicate',
  'resultados.grupo.noEsDuplicado.title': 'Take it out of the group and back into the main list',
  'resultados.grupo.sacado': 'Taken out of the group',
  'resultados.grupo.agrupadoPor': 'Grouped by {motivo}',
  'resultados.grupo.elegido': 'chosen',
  'resultados.grupo.elegido.title':
    'This is the one shown when collapsed: the heaviest of the group',
  'resultados.sinCoincidencias': 'No matches',
  'resultados.sinCoincidencias.texto':
    'No result passes the current filters. Try widening the ranges or turning the switches off.',
  'resultados.noObtenido': 'Could not determine {dato}',
  'resultados.dudoso': '⚠ unverified',
  'resultados.dudoso.title': 'Could not confirm that this file belongs to its page.',
  'resultados.dudoso.titleMotivo':
    '{motivo}. Its duration is hidden because the one on the page belongs to another video.',
  'resultados.duplicados.title': '{n} more result(s) grouped here by {motivo}: {miembros}',
  'resultados.duplicados.motivoPorDefecto': 'matching signals',
  'resultados.pesoAprox': 'Approximate size, taken from the site page',
  'resultados.pesoExacto': 'Exact size, reported by the server',
  'resultados.primeros': 'Showing the first {n} of {total}. Download the .txt to see them all.',

  'columnas.enlace': 'Link',
  'columnas.duracion': 'Length',
  'columnas.peso': 'Size',

  'filtros.buscar': 'Filter results…',
  'filtros.buscar.aria': 'Filter results',
  'filtros.excluir': 'Hide the ones containing… (240p, sample)',
  'filtros.excluir.aria': 'Hide results containing this text',
  'filtros.excluir.title': 'Separate several terms with commas',
  'filtros.ordenar.aria': 'Sort results',
  'filtros.orden.aparicion': 'Order found',
  'filtros.orden.duracion': 'Longest first',
  'filtros.orden.tamano': 'Largest first',
  'filtros.ocultarSinDuracion': 'Hide without length',
  'filtros.ocultarSinDuracion.title':
    'Removes results whose length could not be determined. The range slider on its own does NOT remove them.',
  'filtros.ocultarSinPeso': 'Hide without size',
  'filtros.ocultarSinPeso.title':
    'Removes results whose size could not be determined. The range slider on its own does NOT remove them.',
  'filtros.agrupar.uno': 'Group {n} duplicate',
  'filtros.agrupar.varios': 'Group {n} duplicates',
  'filtros.agrupar.title':
    'Groups results that look like the same content. Turn it off to see them all.',
  'filtros.modoDup.label': 'How to group duplicates',
  'filtros.modoDup.seguro': 'Safe duplicates (two signals)',
  'filtros.modoDup.duracion': 'Aggressive: by length only',
  'filtros.modoDup.aviso':
    'Aggressive mode: it groups EVERYTHING with the same length. Length does not identify a video, so two different videos of equal length will end up together. Nothing is deleted: expand the group or go back to safe mode to see them all.',
  'filtros.nota':
    'The ranges only trim among results that have the data. They leave the ones without it alone: to remove those, use the switches.',
  'filtros.sinPeso':
    'No result carries a size. You get it by turning on “Find out how big each file is” in the advanced settings, before exploring.',

  /* ── Explorer: header ──────────────────────────────────────────── */
  'explorer.titulo': 'Walk a site page by page',
  'explorer.subtitulo': 'Goes through the pages of a section and returns whatever it finds.',
  'explorer.vacio.titulo': 'No results yet',
  'explorer.vacio.texto': 'Paste an address and press “Explore now”.',

  /* ── Explorer: step rail ─────────────────────────────────────────── */
  'explorer.pasos.titulo': 'Walkthrough progress',
  'explorer.pasos.configurar': 'Configure',
  'explorer.pasos.progreso': 'Progress',
  'explorer.pasos.resultados': 'Results',

  /* ── Explorer: where to start ──────────────────────────────────── */
  'explorer.url.label': 'Addresses to explore',
  'explorer.url.hint':
    'Paste each address as it is. If you write {q} where the searched word would go and {page} where the page number goes, the site is saved once and you only change the word. The link pattern, file type and page range apply equally to all of them. If the site is paginated and you are going to use "Set it up for me", paste an address that already includes the page (for example, with page=2 or /page/2).',
  'explorer.url.placeholder': 'https://example.com/gallery?q=cats',
  'explorer.urls.agregar': '+ Add another address',
  'explorer.urls.quitar': 'Remove this address',
  'explorer.urls.extra.aria': 'Additional address to explore',
  'explorer.termino.label': 'Looking for a particular word? (optional)',
  'explorer.termino.hint':
    'It goes wherever the address has {q}. If the address has no {q}, this field does nothing.',
  'explorer.termino.placeholder': 'cats',
  'explorer.termino.mostrar': 'Search for a particular word →',
  'explorer.termino.ocultar': 'No particular word ←',

  /* ── Explorer: what to get ─────────────────────────────────────── */
  'explorer.objetivo.pregunta': 'What do you want to get?',
  'explorer.objetivo.enlaces': 'Just the list of links',
  'explorer.objetivo.enlaces.breve': 'Links only',
  'explorer.objetivo.enlaces.hint':
    'Walks the pages and gives you the addresses it finds. This is the fastest option.',
  'explorer.objetivo.ficheros': 'The files inside',
  'explorer.objetivo.ficheros.breve': 'The files inside',
  'explorer.objetivo.ficheros.hint':
    'Also opens every link and looks for the files inside. Takes considerably longer.',
  'explorer.tipoArchivo': 'What kind of file?',
  'explorer.preset.video': 'Video',
  'explorer.preset.audio': 'Audio',
  'explorer.preset.imagen': 'Images',
  'explorer.preset.otro': '+ Other',
  'explorer.preset.otro.title': 'Type the extensions by hand',
  'explorer.extensiones.label': 'Extensions to look for, comma separated',
  'explorer.extensiones.hint': 'With the leading dot. For example: .pdf, .zip',

  /* ── Explorer: collapsed setup summary ─────────────────────────── */
  'explorer.resumen.editar': 'Edit',
  'explorer.resumen.nuevaBusqueda': '↺ New search',
  'explorer.resumen.url': 'Addresses',
  'explorer.resumen.tipo': 'Type',
  'explorer.resumen.rango': 'Pages',
  'explorer.resumen.tipo.soloEnlaces': 'links only',
  'explorer.resumen.rango.valor': '{desde}–{hasta}',
  'explorer.resumen.rango.sinPaginado': 'no paging',
  'explorer.resumen.direcciones.uno': '{n} address',
  'explorer.resumen.direcciones.varios': '{n} addresses',

  /* ── Explorer: actions ─────────────────────────────────────────── */
  'explorer.explorar': 'Explore now',
  'explorer.explorando': 'Exploring…',
  'explorer.detectar': 'Set it up for me',
  'explorer.detectar.title':
    'Opens the address, analyses it and fills in the form. It is always a suggestion: review it.',
  'explorer.analizando': 'Analysing…',
  'explorer.limpiar': 'Clear',

  /* ── Explorer: advanced settings ───────────────────────────────── */
  'explorer.avanzados': 'Advanced settings (optional)',
  'explorer.modo.pregunta': 'How does the site move between pages?',
  'explorer.modo.auto': 'Detect automatically (recommended)',
  'explorer.modo.auto.breve': 'Automatic',
  'explorer.modo.auto.hint':
    'Works for almost every site: uses whatever the address already carries.',
  'explorer.modo.manual': 'Set the patterns by hand',
  'explorer.modo.manual.breve': 'By hand',
  'explorer.modo.manual.hint':
    'To say exactly which links to follow and how the site numbers its pages.',
  'explorer.modo.scroll': 'Infinite scroll',
  'explorer.modo.scroll.breve': 'Scroll',
  'explorer.modo.scroll.hint':
    'For sites with no page buttons that load more results as you scroll down. Here “up to” counts loads, not pages.',
  'explorer.modo.resumen':
    'You are still using {que}. Press “Set the patterns by hand” to see or change them.',
  'explorer.modo.resumen.enlaces': 'links “{valor}”',
  'explorer.modo.resumen.parametro': 'parameter “{valor}”',
  'explorer.modo.resumen.y': ' and ',
  'explorer.patron.label': 'Which links to follow? (link pattern)',
  'explorer.patron.hint':
    'Empty = all of them. “/videos/” keeps the ones containing it. Between slashes and with some symbol it is a regular expression: /\\/videos\\/\\d+/ only takes the numbered pages.',
  'explorer.parametro.label': 'How does it number the pages? (parameter name)',
  'explorer.parametro.hint':
    'Just the name, for example “page”. If the number goes inside the address, leave this empty: write {page} in the starting address instead.',
  'explorer.desde.label': 'From page',
  'explorer.hasta.label': 'Up to which page?',
  'explorer.hasta.hint': 'At most {max} pages at a time.',
  'explorer.rango.titulo': 'Page range to explore',
  'explorer.rango.anterior': 'Previous page range',
  'explorer.rango.siguiente': 'Next page range',
  'explorer.paginado.activo': 'Enable/disable paging',
  'explorer.rapidez.label': 'How fast? (pages at a time)',
  'explorer.rapidez.hint':
    'Between 1 and {max}. The higher it is, the sooner it finishes and the more it loads the site. Default is {defecto}.',
  'explorer.navegador.label': 'Open with a browser',
  'explorer.navegador.hint':
    'Opens every page the way a real browser would, running its JavaScript. Needed when the site shows nothing without it. Much slower: count several seconds per link.',
  'explorer.peso.label': 'Find out how big each file is',
  'explorer.peso.breve': 'Size',
  'explorer.peso.hint':
    'Asks for the size of every file without downloading it. Lets you sort by size and tell a full video from a preview clip. Slower.',
  'explorer.miniaturas.label': 'Fetch a thumbnail for each result',
  'explorer.miniaturas.breve': 'Thumbnail',
  'explorer.miniaturas.hint':
    'Requests a preview image per page. THIS server downloads and serves them, not your browser: the explored sites never see your connection. Slower, and it makes more requests to the site.',
  'explorer.licencia.label': 'Only openly licensed material',
  'explorer.licencia.hint':
    'Keeps only the pages that declare an open licence (Creative Commons, public domain, CC0…). Anything without a declared licence is dropped: by default a work is born with all rights reserved, so the absence of a licence does not mean it is free.',

  /* ── Explorer: pagination examples ─────────────────────────────── */
  'ejemplos.titulo': 'Go to page 2 on the site and look at what changes in its address:',
  'ejemplos.campo.parametro': 'Parameter name',
  'ejemplos.campo.url': 'Starting address',

  /* ── Explorer: results KPIs ──────────────────────────────────────── */
  'kpi.archivos': 'Files found',
  'kpi.enlaces': 'Links found',
  'kpi.direcciones': 'Addresses analyzed',
  'kpi.duplicados': 'Duplicate groups',
  'kpi.ocultos': 'Manually hidden',
  'kpi.detalle': '{paginas} pages walked in {segundos}s',
  'kpi.detalle.fallidas': ' · {n} failed',

  /* ── Explorer: stats (previous bar, see KPIs above) ──────────────── */
  'stats.enlaces': 'Links',
  'stats.paginas': 'Pages walked',
  'stats.ficheros': 'Files',
  'stats.duracion': 'Took',
  'stats.fallidas': 'Failed pages',

  /* ── Explorer: suggested setup ─────────────────────────────────── */
  'propuesta.titulo': 'Here is what I suggest',
  'propuesta.cerrar': 'Close the suggestion',
  'propuesta.hint':
    'It is a suggestion, not the truth: review it and fix whatever does not fit. {conNavegador} links were analysed with a browser and {sinNavegador} without one.',
  'propuesta.campo.patron': 'Which links to follow?',
  'propuesta.campo.paginacion': 'How it moves between pages',
  'propuesta.campo.navegador': 'Open with a browser',
  'propuesta.campo.extensiones': 'What to get',
  'propuesta.campo.alternativo': 'Alternative pattern',
  'propuesta.alternativo.motivo':
    'Broader than the suggested one. Use it if the suggested one leaves out results you did want.',
  'propuesta.vacio': '(empty)',
  'propuesta.si': 'yes',
  'propuesta.no': 'no',
  'propuesta.parametro': 'parameter “{valor}”',
  'propuesta.confianza': '{nivel} confidence',
  'propuesta.aviso': 'Worth knowing',
  'propuesta.lista': 'Suggestion ready: review it before exploring',
  'propuesta.fallo': 'Could not analyse the page',

  /* ── Explorer: validation and alerts ───────────────────────────── */
  'error.faltaUrl': 'The address is missing',
  'error.faltaUrl.detectar': 'In step 1, write the address of the page you want to analyse.',
  'error.faltaUrl.explorar': 'In step 1, write the page you want to start from.',
  'error.urlInvalida': 'Invalid address',
  'error.urlInvalida.body': 'The address must start with http:// or https://',
  'error.faltaTermino': 'The word to search for is missing',
  'error.faltaTermino.body':
    'The starting address contains {q}, so you have to say what to search for in “Looking for a particular word?”.',
  'error.faltaParametro': 'You have not said how it numbers the pages',
  'error.faltaParametro.body':
    'You asked for pages {desde} to {hasta}, but without knowing how the site moves between pages only one will be downloaded. Open “Advanced settings”, pick “Set the patterns by hand” and write the parameter name (for example “page”), or put {page} in the starting address.',
  'error.rangoInvalido': 'Invalid page range',
  'error.rangoInvalido.body': 'The last page cannot be lower than the first one.',
  'error.rangoGrande': 'Page range too large',
  'error.rangoGrande.body':
    'You asked for {pedidas} pages and the maximum per search is {max}. Lower “Up to which page?” to {sugerido} or less.',
  'error.busquedaFallo': 'The search failed',

  'aviso.scrollCortado': 'Scrolling stopped before the listing ran out',
  'aviso.scrollCortado.body':
    'After {cargas} loads, {motivo}. The site very likely had more results: the ones you see are incomplete. Raise “Up to which page?” to ask for more loads, or narrow the link pattern to bring fewer per load.',
  'aviso.tope.rondas': 'the maximum number of loads was reached',
  'aviso.tope.elementos': 'the element limit was reached',
  'aviso.tope.tiempo': 'the scrolling time ran out',
  'aviso.tope.navegador': 'the browser stopped responding',

  'aviso.patronSinCasar': 'The link pattern left every link out',
  'aviso.patronSinCasar.body':
    '{vistos} links were found across the pages walked and NONE match “{patron}”. Try one of the most frequent ones: {pistas}. Or leave it empty to collect them all.',
  'aviso.patronSinCasar.sinPistas':
    '{vistos} links were found across the pages walked and NONE match “{patron}”. Try leaving the pattern empty to see what the page brings.',
  'aviso.bloqueo': 'The site may be blocking automated requests',
  'aviso.bloqueo.body':
    'This is a suspicion, not a certainty: {motivos}. If results come back empty or partial, try turning on “Open with a browser” in the advanced settings, and lowering the speed.',

  'aviso.soloEnlaces': 'Only links were collected, not files',
  'aviso.soloEnlaces.body':
    'Step 2 has “Just the list of links” selected, so no link was opened. Pick “The files inside”, choose the type you are after and explore again.',

  'aviso.sinVerificar': '{n} unverified file(s)',
  'aviso.sinVerificar.body':
    'It could not be confirmed that they belong to their page: they may be ads or previews. They are flagged and shown WITHOUT a length, because the page length belongs to another video. Check them before downloading.',
  'aviso.descartados': '{n} file(s) dropped for not belonging to their page',
  'aviso.descartados.body':
    'They were ads or previews of the related videos. The ones you see do share an identifier with the page they came from.',

  'aviso.truncado': 'Results truncated',
  'aviso.truncado.body':
    'The application limit was reached ({enlaces} links / {ficheros} files). Narrow the link pattern or the page range to get fewer results.',

  'aviso.licencia': '{n} pages dropped over licensing',
  'aviso.licencia.body':
    'They did not declare an open licence, so they were skipped. Remember that the absence of a licence means “all rights reserved”, not “free”.',

  'aviso.tiempoAgotado': 'The time limit ran out',
  'aviso.tiempoAgotado.body':
    'The run went over {minutos} minutes and stopped, so the results are incomplete. With “Open with a browser” every link takes several seconds: reduce the page range or narrow the link pattern to check fewer links.',

  'aviso.sinFicheros': 'Links were found but no files',
  'aviso.sinFicheros.conNavegador':
    '{n} pages were checked with a browser without finding files of that type. The links may not be detail pages (redirects to other sites, for instance) or the file may be requested through an API that leaves no trace in the HTML.',
  'aviso.sinFicheros.sinNavegador':
    '{n} pages were checked without finding files of that type. Try turning on “Open with a browser” in the advanced settings: it now also applies when opening each link.',

  /* ── Video view ────────────────────────────────────────────────── */
  'video.titulo': 'Pull the videos out of one or more pages',
  'video.subtitulo':
    'Paste each address and it tells you what videos are on it and how it found them.',
  'video.url.label': 'Addresses to analyse',
  'video.url.hint':
    'Each address is analysed separately, and in four ways: what shows up after loading it, what it requests over the network, embedded players, and addresses hidden in its code. Duplicates across addresses are grouped at the end.',
  'video.url.placeholder': 'https://example.com/video/12345',
  'video.urls.agregar': '+ Add another address',
  'video.urls.quitar': 'Remove this address',
  'video.urls.extra.aria': 'Additional address to analyse',
  'video.faltaUrl.body': 'Paste at least one address to analyse.',
  'video.navegador.label': 'Open with a browser',
  'video.navegador.hint':
    'Opens the page the way a real browser would and watches what it requests. Finds videos that are not written in the page.',
  'video.peso.label': 'Find out how big each file is',
  'video.peso.hint': 'Asks for the size of every video without downloading it. Slower.',
  'video.miniatura.label': 'Fetch thumbnail',
  'video.miniatura.hint': 'A preview image per video, if the site offers one.',
  'video.analizar': 'Analyse',
  'video.analizando': 'Analysing…',
  'video.cancelar': 'Cancel',
  'video.cancelado': 'Analysis cancelled',
  'video.limpiar': 'Clear',
  'video.stats.videos': 'Videos',
  'video.stats.formatos': 'Formats',
  'video.stats.vias': 'Ways with results',
  'video.sinNavegador': 'The browser could not be used',
  'video.sinNavegador.body':
    'Only the HTML was analysed. Videos loaded by JavaScript may not show up.',
  'video.vacio.titulo': 'No videos yet',
  'video.vacio.texto': 'Paste the address of a page and press “Analyse”.',
  'video.sinResultados.titulo': 'No videos found',
  'video.sinResultados.texto':
    'Try turning on “Open with a browser”: many sites do not show the player until the page is really opened.',
  'video.detectadoPor': 'Found via: {via}',
  'video.desconocido': 'unknown',
  'video.todos': 'All ({n})',
  'video.abrir': 'Open',
  'video.fallo': 'Could not analyse the page',
  'video.aviso.parcial': '{analizadas} of {total} addresses analysed',
  'video.aviso.parcial.body':
    'The rest could not be analysed: the address may be mistyped or the site may not have responded. Check the list before continuing.',
  'video.columnas.tipo': 'Type',
  'video.columnas.detectado': 'Found via',
  'video.vista.cajas': 'Grid view',
  'video.vista.lista': 'List view',

  /* ── Video view: live progress (stream) ──────────────────────────── */
  'video.progreso.direccion': 'Analysing address {actual} of {total}: {url}',
  'video.progreso.direccionUnica': 'Analysing: {url}',
  'video.progreso.via.puppeteer': 'Browser-based explorer',
  'video.progreso.via.cheerio': 'Page HTML',
  'video.progreso.via.knownPlayers': 'Known players',
  'video.progreso.via.scriptAnalysis': 'Links in the source code',
  'video.progreso.estado.pendiente': 'Pending',
  'video.progreso.estado.curso': 'In progress…',
  'video.progreso.estado.resuelto': 'Done',
  'video.progreso.via.sinResultado': 'no result',
  'video.progreso.via.encontrados.uno': 'found 1 video',
  'video.progreso.via.encontrados.varios': 'found {n} videos',

  /* ── Ajustes y clip crew ───────────────────────────────────────── */
  'nav.ajustes': 'Settings',
  'crew.aria': 'clip crew apps',
  'head.ajustes.titulo': 'Settings — clipscout',
  'head.ajustes.desc': 'Identity, API key and connections with the other clip crew apps.',
  'aj.esta.titulo': 'This app',
  'aj.esta.hint': '{app} · version {version}',
  'aj.instancia.label': 'Instance name',
  'aj.instancia.placeholder': 'For example: Home finder',
  'aj.instancia.hint': 'The name the other clip crew apps will see.',
  'aj.url.label': 'URL of this app',
  'aj.url.hint':
    'The address the other apps use to reach this one. If you leave it empty, the one you are using now is used: {url}',
  'aj.guardar': 'Save',
  'aj.guardado': 'Settings saved',
  'aj.clave.titulo': 'API key',
  'aj.clave.hint':
    'The other clip crew apps need it to connect to this one: paste it under their Settings → Connections.',
  'aj.clave.mostrar': 'Show',
  'aj.clave.ocultar': 'Hide',
  'aj.clave.copiar': 'Copy',
  'aj.clave.copiada': 'Key copied',
  'aj.clave.noCopia': 'Could not copy automatically: select it and copy it by hand.',
  'aj.clave.regenerar': 'Regenerate',
  'aj.clave.confirmar':
    'Generate a new key? Apps connected with the current key will stop talking to this one until you connect them again.',
  'aj.clave.nueva': 'New key generated',
  'aj.con.titulo': 'Connected apps',
  'aj.con.hint':
    'clipscout finds videos, clonbuster sets duplicates aside and clipkeeper organizes them. Connect them with their URL and API key.',
  'aj.con.anadir': '+ Add connection',
  'aj.con.vacio': 'No apps connected yet.',
  'aj.con.app': 'App',
  'aj.con.url': 'URL address',
  'aj.con.clave': "That app's API key",
  'aj.con.clave.hint': 'In the other app: Settings → General → API key.',
  'aj.con.nombre': 'Name (optional)',
  'aj.con.nombre.placeholder': "The other app's name is used",
  'aj.con.reciproca': 'Also connect in the opposite direction',
  'aj.con.probar': 'Test',
  'aj.con.guardar': 'Save connection',
  'aj.con.cancelar': 'Cancel',
  'aj.con.quitar': 'Remove',
  'aj.con.quitarConfirmar':
    'Remove the connection with “{nombre}”? The other app is not told: remove it there too if you want.',
  'aj.con.quitada': 'Connection removed',
  'aj.con.comprobando': 'Checking…',
  'aj.con.conectada': 'Connected · v{version}',
  'aj.con.sinConexion': 'Not connected',
  'aj.con.responde': '✓ Responds: {instancia} · {app} v{version}',
  'aj.con.dos': 'Connected both ways',
  'aj.con.guardada': 'Connection saved',
  'aj.con.vueltaError': 'Connected, but could not register the other way: {error}',
  'aj.app.clipkeeper': 'catalogs, plays and organizes',
  'aj.app.clonbuster': 'spots and sets aside duplicates',
  'aj.app.clipscout': 'another instance',
  'crew.actual': '{app} (you are here)',
  'crew.ir': 'Go to {nombre}',
  'crew.noConectada': '{app}: not connected (Settings → Connections)',
  'video.yaLoTengo': 'Do I have it?',
  'video.yaLoTengo.titulo': 'Ask clipkeeper which videos in this list are already in your library',
  'video.yaLoTengo.sinConexion':
    'Connect clipkeeper under Settings → Connections to see what you already have.',
  'video.yaLoTengo.resultado.uno': '1 video is already in your library',
  'video.yaLoTengo.resultado.varios': '{n} videos are already in your library',
  'video.yaLoTengo.ninguno': 'None of these are in your library.',
  'video.enBiblioteca': '✓ In your library',
  'video.verEnClipkeeper': 'Open in clipkeeper',
  'aj.jd.titulo': 'JDownloader',
  'aj.jd.hint':
    'Send found videos to JDownloader 2 through its local API. In JDownloader: Advanced settings → enable «RemoteAPI: Deprecated API enabled» and disable «… localhost only»; publish port 3128.',
  'aj.jd.url': 'JDownloader API URL',
  'aj.jd.url.hint': 'Usually http://<jdownloader-ip>:3128. Leave it empty to turn it off.',
  'aj.jd.autostart':
    'Start downloading as soon as it arrives (otherwise it waits in the link grabber)',
  'aj.jd.responde': '✓ Responds: JDownloader {version} · downloads to {carpeta}',
  'aj.jd.guardado': 'JDownloader saved',
  'aj.jd.quitado': 'JDownloader turned off',
  'video.jd.todos': 'Send to JDownloader',
  'video.jd.todos.titulo': 'Send every visible video to JDownloader',
  'video.jd.boton': 'JDownloader',
  'video.jd.boton.titulo': 'Send this video to JDownloader',
  'video.jd.carpeta':
    'Subfolder inside JDownloader downloads for {n} video(s) (e.g. the person’s name). Empty = default folder.',
  'video.jd.enviados': '{n} sent to JDownloader',
  'video.jd.enviadosA': '{n} sent to JDownloader → {carpeta}',
  'aj.jd.biblioteca': 'clipkeeper library it downloads to',
  'aj.jd.biblioteca.hint':
    'The clipkeeper library that is the same folder as JDownloader’s download folder. Its subfolders show up as destinations when sending, and whatever lands in each one inherits its people and tags.',
  'aj.jd.biblioteca.ninguna': '— None (type the subfolder by hand) —',
  'video.jd.elegir': 'Which folder do these {n} video(s) go to? They go together, in one package.',
  'video.jd.porDefecto': 'Default folder',
  'video.jd.porDefecto.detalle': 'JDownloader’s download folder, no subfolder',
  'video.jd.nueva': 'New folder: “{nombre}”',
  'dialogo.buscar': 'Search…',

  /* ── Buscar (en todos los sitios a la vez) ─────────────────────── */
  'nav.buscar': 'Search',
  'head.buscar.titulo': 'Search — clipscout',
  'head.buscar.desc': 'Search for a name on all your saved sites at once.',
  'buscar.titulo': 'Search all your sites',
  'buscar.placeholder': 'A person’s name, a title…',
  'buscar.boton': 'Search',
  'buscar.paginas': 'Pages per site',
  'buscar.recortado':
    'There is more: only the first results of this site were checked. Use the Explorer to go deeper.',
  'buscar.web': 'Also on the web',
  'buscar.web.titulo':
    'Also searches “site:site name” on search engines (Google, Bing…) to find videos whose title does not say the name.',
  'buscar.web.resultado': 'Found with the web search',
  'buscar.estado.cola': 'queued…',
  'buscar.estado.buscando': 'searching…',
  'buscar.estado.revisando': 'checking {hechos} of {total} pages…',
  'buscar.estado.web': 'also searching the web…',
  'buscar.estado.error': 'error: {error}',
  'buscar.estado.quedan': 'Searching: {n} of {total} sites left',
  'buscar.estado.terminado': 'Search finished',
  'aj.apar.titulo': 'Appearance',
  'aj.apar.idioma': 'Language',
  'aj.apar.tema': 'Theme',
  'aj.apar.hint': 'Remembered in this browser.',
  'aj.web.titulo': 'Web search and network',
  'aj.web.hint':
    'The “Google-like” search of the Search tab (with your own SearXNG) and the sites that must not go through the VPN.',
  'aj.web.url': 'SearXNG address',
  'aj.web.url.hint': 'Empty = no web search.',
  'aj.web.motores': 'Search engines',
  'aj.web.motores.hint':
    'The ones SearXNG queries, comma-separated. If one blocks (Test tells you), remove it.',
  'aj.web.paginas': 'Result pages per site',
  'aj.web.sinProxy': 'Sites without VPN',
  'aj.web.sinProxy.hint':
    'One domain per line. They go direct, without the proxy: for those that block the VPN exit.',
  'aj.web.responde': '✓ Responds: {n} test results. Not responding: {fallan}',
  'jd.ultima': 'the last one you used',
  'jd.tipo.titulo': 'New folder',
  'jd.tipo.label':
    'What is “{nombre}”? That way the folder goes where it belongs and whatever arrives is already catalogued.',
  'jd.tipo.actriz': 'An actress',
  'jd.tipo.actor': 'An actor',
  'jd.tipo.artista': 'An artist or channel',
  'jd.tipo.categoria': 'A category',
  'jd.tipo.etiqueta': 'A tag',
  'jd.tipo.carpeta': 'Just a folder (no data)',
  'jd.reglaError': 'Sent, but clipkeeper did not register the folder: {error}',
  'buscar.repetidos.uno': '1 duplicate',
  'buscar.repetidos.varios': '{n} duplicates',
  'buscar.copias.uno': '1 more copy of this video (on this or another site)',
  'buscar.copias.varios': '{n} more copies of this video (on this or another site)',
  'buscar.ocultarRepetidos': 'Hide duplicates',
  'buscar.duracion': 'Minimum length',
  'buscar.duracion.cualquiera': 'any',
  'buscar.duracion.min': '{n} min',
  'buscar.destino': 'Download to',
  'buscar.destino.preguntar': 'Ask every time',
  'buscar.descargarTodo': '⬇ Download all ({n})',
  'jd.nueva.nombre': 'Folder name (for example, the person’s name):',
  'buscar.destino.nueva': '+ New folder…',
  'carpeta.titulo': 'Where should it go?',
  'carpeta.que': 'What is it?',
  'carpeta.nombre': 'Name of the {tipo} (or tap an existing one):',
  'carpeta.tipo.actriz': 'Actress',
  'carpeta.tipo.actor': 'Actor',
  'carpeta.tipo.artista': 'Artist or channel',
  'carpeta.tipo.categoria': 'Category',
  'carpeta.tipo.etiqueta': 'Tag',
  'carpeta.ultima': 'Last one: {carpeta}',
  'carpeta.placeholder': 'Type the name…',
  'carpeta.aceptar': 'Save here',
  'carpeta.volver': 'Back',
  'buscar.descartar': 'Dismiss this result',
  'buscar.descartados.uno': '1 dismissed · restore',
  'buscar.descartados.varios': '{n} dismissed · restore',
  'buscar.webPregunta': 'Also search the web?',
  'buscar.webPregunta.texto':
    'The web search finds videos whose title does not say the name, but it also brings plenty that is unrelated.',
  'buscar.webNo': 'Only my sites',
  'buscar.webNo.detalle': 'Faster and cleaner',
  'buscar.webSi': 'My sites and the web',
  'buscar.webSi.detalle': 'More results (marked 🌐), with more noise',
  'buscar.parar': 'Stop',
  'buscar.todos': 'All',
  'buscar.ayuda.todos': 'Searches your {n} saved sites at once. Tap one to search only there.',
  'buscar.ayuda.algunos.uno': 'Searches only the selected site. “All” searches every site again.',
  'buscar.ayuda.algunos.varios':
    'Searches the {n} selected sites. “All” searches every site again.',
  'buscar.sinSitios':
    'No sites to search yet: in the Explorer, save a configuration with the search term inside its address.',
  'buscar.resultados.uno': '1 result',
  'buscar.resultados.varios': '{n} results',
  'buscar.buscando': 'Searching…',
  'buscar.nada': 'Nothing found.',
  'buscar.errorSitio': 'This site returned an error: {error}',
  'buscar.bloqueo': 'The site may be throttling requests: some results are missing.',
  'buscar.abrir': 'Open',
  'buscar.jd': '⬇ Download',
  'buscar.loTienes': '✓ Already have it',
};
