import { ajustes } from '../api.js';
import { el, clear, toast, enfocarAlAbrir } from '../dom.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';
import { createJdEnvio } from '../components/jdEnvio.js';
import { chooseDialog } from '../components/dialog.js';
import { altaSitiosDialog } from '../components/altaSitios.js';
import { palabras, contieneAlguna, textoDe } from '../filtros.js';
import { plegarAlbumes, claveAlbum } from '../albumes.js';

/** El «sitio» de lo encontrado en toda la web (no es una configuración guardada). */
const ID_WEB = -1;

/**
 * Qué escribió la persona en la caja única: un enlace (se sacan sus vídeos), un dominio suelto
 * («ejemplo.com»: se ofrece agregarlo como sitio) o un nombre / una palabra (se busca en todos).
 */
const ES_ENLACE = /^(?:https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S+)$/i;
const ES_DOMINIO = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/?$/i;

function tipoDeEntrada(texto) {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'palabra';
  // Uno o varios enlaces (como en la antigua pestaña Vídeos): se sacan sus vídeos.
  if (partes.every(p => ES_ENLACE.test(p))) return 'enlace';
  if (partes.length === 1 && ES_DOMINIO.test(partes[0])) return 'dominio';
  return 'palabra';
}

/**
 * Buscar: la pantalla de inicio. Se escribe un nombre y se busca en TODOS los sitios guardados a la
 * vez (las configuraciones cuya dirección lleva {q}); los resultados llegan mezclados y arriba hay
 * una pestaña por sitio para ver solo los de uno. Para ir a fondo en un sitio está el Explorador.
 */

const CLAVE_SITIOS = 'clipscout:buscar-apagados';

/**
 * Miniaturas que ya fallaron en esta página. La rejilla se rehace con cada tanda de resultados y
 * cada <img> nuevo volvía a pedir la misma imagen rota: estas salen ya como hueco, sin petición.
 */
const miniaturasRotas = new Set();

function leerApagados() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE_SITIOS) || '[]'));
  } catch {
    return new Set();
  }
}
function guardarApagados(apagados) {
  try {
    localStorage.setItem(CLAVE_SITIOS, JSON.stringify([...apagados]));
  } catch {
    // sin almacenamiento: se olvidan al recargar, no es crítico
  }
}

function nombreDeUrl(url) {
  try {
    const ultimo = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return ultimo
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/[-_.]+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

export function createBuscarView(root) {
  let sitios = []; // { id, nombre }
  const apagados = leerApagados();
  let estado = new Map(); // id → { fase: 'espera'|'busca'|'fin'|'error', total, error, bloqueo }
  let resultados = []; // { sitio, url, sourceUrl, title, thumbnail, duration, durationSeconds }
  let pestana = 'todos';
  let fuente = null;
  // La búsqueda corre en el servidor: la página solo la mira. Se guarda por dónde iba para
  // reengancharse si la conexión se corta (otra app, pantalla apagada…).
  let trabajo = null; // id de la búsqueda en el servidor
  let trabajoVisto = null; // la que se está mirando (sigue tras terminar, para marcarla en la cola)
  let enCola = null; // puesto en la cola mientras espera su turno (null = ya arrancó)
  let recibidos = 0; // eventos ya procesados
  let reintento = null;
  let enBiblioteca = new Map(); // sourceUrl → coincidencia de clipkeeper
  const nombresDelServidor = new Map(); // id → nombre, para los «sitios» que no son guardados
  // Enlaces pegados que, además de sus vídeos, son un listado: se ofrece recorrer sus fichas.
  let listados = new Map(); // id → url
  let sugeridos = []; // { dominio, videos }: sitios sin configurar que dieron vídeos en la web
  let ultimaBusqueda = '';

  /* ── Formulario ─────────────────────────────────────────────────── */
  const entrada = el('input', {
    className: 'input buscar__entrada',
    attrs: { type: 'search', autocomplete: 'off', enterkeyhint: 'search' },
  });
  atributo(entrada, 'placeholder', 'buscar.placeholder');
  atributo(entrada, 'aria-label', 'buscar.placeholder');

  const boton = el('button', { className: 'button buscar__boton', attrs: { type: 'submit' } });
  const parar = el('button', {
    className: 'button button--secondary buscar__boton',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => pararBusqueda() },
  });
  texto(parar, 'buscar.parar');

  const chipsSitios = el('div', { className: 'buscar__sitios' });
  const ayuda = el('p', { className: 'buscar__ayuda' });

  // Cuántas páginas de resultados mirar en cada sitio (se recuerda).
  const CLAVE_PAGINAS = 'clipscout:buscar-paginas';
  const paginas = el('select', { className: 'input buscar__paginas' });
  // Hasta 50: a veces se quiere barrer a fondo, y es la cola la que reparte el trabajo.
  for (const n of [1, 2, 3, 5, 10, 20, 30, 50]) {
    paginas.append(el('option', { attrs: { value: n }, text: n }));
  }
  try {
    paginas.value = localStorage.getItem(CLAVE_PAGINAS) || '2';
  } catch {
    paginas.value = '2';
  }
  paginas.addEventListener('change', () => {
    try {
      localStorage.setItem(CLAVE_PAGINAS, paginas.value);
    } catch {
      // sin almacenamiento
    }
  });
  const etiquetaPaginas = el('label', { className: 'buscar__opcion', children: [paginas] });

  // Alta de sitios con solo su dirección: clipscout la configura y la prueba.
  const agregar = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button', id: 'agregar-sitios' },
    on: { click: () => abrirAlta({ termino: entrada.value.trim() }) },
  });
  async function abrirAlta({ dominios = [], termino = '' } = {}) {
    const n = await altaSitiosDialog({ dominios, termino });
    if (n > 0) {
      toast(tp('alta.guardados', n), 'success', 4000);
      sugeridos = sugeridos.filter(s => !dominios.includes(s.dominio));
      await cargarSitios();
      pintarResultados();
    }
  }

  /**
   * «También en toda la web»: cualquier sitio que nombre lo buscado, aunque no esté configurado.
   * DESACTIVADA por defecto (trae mucho ruido y abre muchas páginas de desconocidos); la casilla
   * se recuerda en este navegador, así que quien ya la marcó la sigue teniendo marcada.
   * Solo se ve si hay SearXNG configurado.
   */
  const CLAVE_ABIERTA = 'clipscout:buscar-abierta';
  const abierta = el('input', { attrs: { type: 'checkbox' } });
  try {
    abierta.checked = localStorage.getItem(CLAVE_ABIERTA) === '1';
  } catch {
    abierta.checked = false;
  }
  abierta.addEventListener('change', () => {
    try {
      localStorage.setItem(CLAVE_ABIERTA, abierta.checked ? '1' : '0');
    } catch {
      // sin almacenamiento: vuelve a desmarcada al recargar
    }
  });
  const textoAbierta = el('span');
  texto(textoAbierta, 'buscar.webTodo');
  const etiquetaAbierta = el('label', {
    className: 'buscar__opcion',
    attrs: { hidden: '' },
    children: [abierta, textoAbierta],
  });
  atributo(etiquetaAbierta, 'title', 'buscar.webTodo.detalle');
  const textoPaginas = el('span');
  etiquetaPaginas.prepend(textoPaginas);

  // Varias búsquedas de golpe (una por línea, opcional «término → carpeta»): van todas a la cola.
  const botonVarias = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: { click: () => abrirVarias('') },
  });
  texto(botonVarias, 'buscar.varias');
  const textoVarias = el('textarea', {
    className: 'input buscar__varias-texto',
    attrs: { rows: 5, spellcheck: 'false' },
  });
  atributo(textoVarias, 'placeholder', 'buscar.varias.ej');
  atributo(textoVarias, 'aria-label', 'buscar.varias');
  const ayudaVarias = el('p', { className: 'field__hint' });
  texto(ayudaVarias, 'buscar.varias.hint');
  const encolar = el('button', { className: 'button button--small', attrs: { type: 'submit' } });
  const cancelarVarias = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        zonaVarias.hidden = true;
      },
    },
  });
  texto(cancelarVarias, 'aj.prog.cancelar');
  const zonaVarias = el('form', {
    className: 'buscar__varias',
    attrs: { hidden: '' },
    children: [
      textoVarias,
      ayudaVarias,
      el('div', { className: 'ajustes-acciones', children: [encolar, cancelarVarias] }),
    ],
    on: {
      submit: e => {
        e.preventDefault();
        encolarVarias();
      },
    },
  });
  const pintarEncolar = () => {
    encolar.textContent = t('buscar.varias.encolar', { n: leerLineas(textoVarias.value).length });
  };
  textoVarias.addEventListener('input', pintarEncolar);
  function abrirVarias(textoInicial) {
    if (textoInicial) textoVarias.value = textoInicial;
    zonaVarias.hidden = false;
    pintarEncolar();
    textoVarias.focus();
  }
  // Pegar una lista en la caja normal (que es de una línea y se comería los saltos) abre la de varias.
  entrada.addEventListener('paste', e => {
    const pegado = e.clipboardData?.getData('text') || '';
    if (pegado.split(/\r?\n/).filter(l => l.trim()).length > 1) {
      e.preventDefault();
      abrirVarias(pegado);
    }
  });

  // La cola: lo que está en marcha, lo que espera su turno y lo terminado hace poco.
  const listaCola = el('ul', { className: 'buscar__cola-lista' });
  const tituloCola = el('h3', { className: 'buscar__cola-titulo' });
  texto(tituloCola, 'buscar.cola');
  const zonaCola = el('section', {
    className: 'buscar__cola',
    attrs: { hidden: '' },
    children: [tituloCola, listaCola],
  });

  // Aviso fijo de uso responsable, siempre visible bajo la caja de búsqueda.
  const avisoTexto = el('span');
  texto(avisoTexto, 'aviso.buscar');
  const avisoEnlace = el('a', {
    attrs: { href: 'https://clipgeist.com/#uso', target: '_blank', rel: 'noopener' },
  });
  texto(avisoEnlace, 'aviso.enlace');
  const avisoUso = el('p', {
    className: 'buscar__aviso',
    attrs: { role: 'note' },
    children: [avisoTexto, ' ', avisoEnlace],
  });

  const form = el('form', {
    className: 'buscar__form',
    children: [
      el('div', { className: 'buscar__fila', children: [entrada, boton, parar] }),
      chipsSitios,
      el('div', {
        className: 'buscar__pie',
        children: [
          ayuda,
          el('span', { children: [agregar, botonVarias] }),
          el('span', {
            className: 'buscar__opciones',
            children: [etiquetaAbierta, etiquetaPaginas],
          }),
        ],
      }),
      avisoUso,
    ],
    on: {
      submit: e => {
        e.preventDefault();
        empezar();
      },
    },
  });

  /* ── Resultados ─────────────────────────────────────────────────── */
  const pestanas = el('div', { className: 'buscar__pestanas', attrs: { role: 'tablist' } });
  // Estado de cada sitio mientras busca: así se ve que sigue trabajando y por dónde va.
  const progreso = el('ul', { className: 'buscar__progreso', attrs: { 'aria-live': 'polite' } });
  const zonaSugeridos = el('div', { className: 'buscar__sugeridos', attrs: { hidden: '' } });
  const barra = el('div', { className: 'buscar__barra' });
  // Los filtros van en su propia fila y NO se reconstruyen al repintar: la rejilla se repinta con
  // cada tanda de resultados y un campo rehecho perdería el foco a mitad de escribir.
  const zonaFiltros = el('div', { className: 'buscar__filtros', attrs: { hidden: '' } });
  const rejilla = el('div', { className: 'buscar__rejilla' });
  const vacio = el('p', { className: 'buscar__vacio' });
  const zonaResultados = el('section', {
    className: 'buscar__resultados',
    attrs: { hidden: '' },
    children: [progreso, zonaSugeridos, pestanas, zonaFiltros, barra, vacio, rejilla],
  });

  const titulo = el('h2', { className: 'buscar__titulo', attrs: { id: 'buscar-heading' } });
  texto(titulo, 'buscar.titulo');

  root.append(
    el('div', {
      className: 'buscar',
      children: [titulo, form, zonaVarias, zonaCola, zonaResultados],
    })
  );

  /* ── Repetidos y filtros de la lista ─────────────────────────────────── */
  // url → { representante, n }: copias del mismo vídeo (mismo o distinto sitio). Se pliegan bajo
  // el primero, como en el Explorador; nunca se borra nada.
  let copias = new Map();
  let ocultarRepetidos = true;
  let minDuracion = 0; // minutos; 0 = cualquiera
  // Filtros de texto e idioma de la tarjeta de resultados. Deciden qué se MUESTRA de lo encontrado,
  // nunca qué se busca: lo oculto se cuenta y se puede ver («Ver ocultos»).
  let contener = []; // alguna de estas frases (ya normalizadas)
  let excluir = []; // ninguna de estas
  let idiomaFiltro = ''; // '' = cualquiera; un resultado «dudoso» no se oculta nunca
  let verOcultos = false;
  let soloFrase = false; // «frase exacta»: oculta (con contador) lo que no la lleva seguida
  let orden = 'llegada'; // 'llegada' | 'relevancia' | 'duracion'
  const textos = new WeakMap(); // resultado → texto normalizado (se repinta con cada tanda)
  const textoNormal = r => {
    if (!textos.has(r)) textos.set(r, textoDe(r));
    return textos.get(r);
  };
  /** Por qué un resultado no se muestra (o null). El orden es el de las explicaciones. */
  function motivoOculto(r) {
    if (r.bloqueada) return 'bloqueada';
    if (excluir.length && contieneAlguna(textoNormal(r), excluir)) return 'excluir';
    if (contener.length && !contieneAlguna(textoNormal(r), contener)) return 'contener';
    // Sin dato (un enlace pegado no tiene término) no se oculta: no se sabe.
    if (soloFrase && r.frase === false) return 'frase';
    if (idiomaFiltro && r.idioma && r.idioma !== 'dudoso' && r.idioma !== idiomaFiltro) {
      return 'idioma';
    }
    if (
      minDuracion &&
      !(Number.isFinite(r.durationSeconds) && r.durationSeconds >= minDuracion * 60)
    ) {
      return 'duracion';
    }
    return null;
  }
  const descartados = new Set(); // páginas quitadas a mano de esta búsqueda
  // El vídeo que se está reproduciendo en su tarjeta: { enlace, tarjeta, video }. Mientras dura la
  // búsqueda la rejilla se repinta entera con cada tanda de resultados; esa tarjeta se REUTILIZA y
  // se vuelve a insertar en el mismo paso, y así el navegador no pausa el vídeo.
  let reproduciendo = null;

  /**
   * ¿Hay un fichero de vídeo que reproducir, distinto de la ficha? Las listas HLS (.m3u8) y sus
   * trozos (.ts) no los abre un <video> por sí solos: esos se ven con «Abrir».
   */
  const archivoReproducible = r =>
    typeof r.url === 'string' &&
    /^https?:\/\//i.test(r.url) &&
    r.url !== (r.sourceUrl || '') &&
    !/\.(m3u8|ts)(\?|$)/i.test(r.url);

  function pararVideo() {
    if (!reproduciendo) return;
    const v = reproduciendo.video;
    v.pause();
    v.removeAttribute('src'); // corta la descarga que va por el servidor
    v.load();
    reproduciendo = null;
  }
  let hayWeb = false; // ¿hay SearXNG configurado? (entonces se pregunta al buscar)
  let destinoFijo = null; // null = preguntar al descargar; string = carpeta (''= la de por defecto)
  let reglaFija = null; // si la carpeta fija es nueva: qué persona/categoría/etiqueta lleva

  const esCopia = r => {
    const c = copias.get(r.url);
    return Boolean(c && c.representante !== r.url);
  };
  // Repetido = el MISMO vídeo (mismo fichero, p. ej. hallado por la búsqueda propia y por la web)
  // o una copia que detecta el servidor. Los vídeos distintos de un mismo álbum NO lo son.
  const clavePagina = r => r.url;
  const porPagina = () => {
    const n = new Map();
    for (const r of resultados) n.set(clavePagina(r), (n.get(clavePagina(r)) || 0) + 1);
    return n;
  };
  let cuentaPagina = new Map(); // resultados por página, para el «+N» de cada tarjeta
  const enPestana = r =>
    (pestana === 'todos' || r.sitio === pestana) && !descartados.has(r.sourceUrl || r.url);
  /** Lo que se ve. `conOcultos`: también lo que esconden los filtros (marcado como tal). */
  /**
   * Orden elegido. Los que no tienen el dato van siempre al final (la misma regla que la lista del
   * Explorador); el orden de llegada desempata, así la lista no baila con cada tanda.
   */
  const ordenar = lista => {
    if (orden === 'llegada') return lista;
    const valor = r =>
      orden === 'relevancia'
        ? r.relevancia
        : Number.isFinite(r.durationSeconds)
          ? r.durationSeconds
          : null;
    return lista
      .map((r, i) => ({ r, i, v: valor(r) }))
      .sort((a, b) => {
        const sa = Number.isFinite(a.v);
        const sb = Number.isFinite(b.v);
        if (sa !== sb) return sa ? -1 : 1;
        return (sa && b.v - a.v) || a.i - b.i;
      })
      .map(x => x.r);
  };
  /**
   * Álbumes: una ficha con varios ficheros llegaba como varios resultados sueltos. Se pliegan en
   * uno (el primero que pasa los filtros, que se aplican POR FICHERO: así la duración mínima mira
   * cada vídeo, no el álbum) con su contador, y se despliegan a mano. Plegar es una vista: nada
   * se quita, y descargar el álbum manda la ficha, que JDownloader ya abre entera.
   */
  const albumesAbiertos = new Set(); // fichas desplegadas
  let albumes = new Map(); // ficha → miembros visibles (los de la última lista pintada)
  const plegarLista = lista => {
    const r = plegarAlbumes(lista, albumesAbiertos);
    albumes = r.albumes;
    return r.lista;
  };
  const visibles = ({ plegar = ocultarRepetidos, conOcultos = false, porAlbum = true } = {}) => {
    const vistas = new Set();
    const lista = ordenar(resultados).filter(r => {
      if (!enPestana(r)) return false;
      if (!conOcultos && motivoOculto(r)) return false;
      if (!plegar) return true;
      if (esCopia(r) || vistas.has(clavePagina(r))) return false;
      vistas.add(clavePagina(r));
      return true;
    });
    return porAlbum ? plegarLista(lista) : lista;
  };
  const jd = createJdEnvio({ visibles: () => visibles().map(r => r.sourceUrl || r.url) });
  // La misma página (un álbum con varios vídeos) se manda una sola vez: JDownloader ya la abre entera.
  const descargar = links => {
    const unicos = [...new Set(links)];
    const titulo = new Map(resultados.map(r => [r.sourceUrl || r.url, r.title || '']));
    return jd.enviar(unicos, {
      ...(destinoFijo === null ? {} : { carpeta: destinoFijo, regla: reglaFija }),
      titulos: unicos.map(l => titulo.get(l) || ''),
    });
  };

  const filtroRepetidos = el('input', { attrs: { type: 'checkbox', checked: true } });
  filtroRepetidos.addEventListener('change', () => {
    ocultarRepetidos = filtroRepetidos.checked;
    pintarResultados();
  });
  const textoRepetidos = el('span');
  const etiquetaRepetidos = el('label', {
    className: 'buscar__opcion',
    children: [filtroRepetidos, textoRepetidos],
  });
  const duracion = el('select', { className: 'input buscar__paginas' });
  const textoDuracion = el('span');
  const etiquetaDuracion = el('label', {
    className: 'buscar__opcion',
    children: [textoDuracion, duracion],
  });
  duracion.addEventListener('change', () => {
    minDuracion = Number(duracion.value);
    pintarResultados();
  });

  const campoFiltro = (clave, alCambiar) => {
    const input = el('input', {
      className: 'input buscar__filtro',
      attrs: { type: 'search', autocomplete: 'off', spellcheck: 'false' },
    });
    atributo(input, 'placeholder', `${clave}.ej`);
    atributo(input, 'aria-label', clave);
    input.addEventListener('input', () => {
      alCambiar(palabras(input.value));
      pintarResultados();
    });
    const rotulo = el('span');
    texto(rotulo, clave);
    return el('label', { className: 'buscar__opcion', children: [rotulo, input] });
  };
  const filtroContener = campoFiltro('buscar.filtro.contener', v => (contener = v));
  const filtroExcluir = campoFiltro('buscar.filtro.excluir', v => (excluir = v));
  const idioma = el('select', { className: 'input buscar__paginas' });
  idioma.addEventListener('change', () => {
    idiomaFiltro = idioma.value;
    pintarResultados();
  });
  const textoIdioma = el('span');
  const etiquetaIdioma = el('label', {
    className: 'buscar__opcion',
    attrs: { title: '' },
    children: [textoIdioma, idioma],
  });
  function pintarIdiomas() {
    const actual = idioma.value || idiomaFiltro;
    clear(idioma);
    for (const v of ['', 'es', 'en', 'pt', 'fr', 'de', 'it']) {
      idioma.append(
        el('option', {
          attrs: { value: v },
          text: t(v ? `buscar.idioma.${v}` : 'buscar.idioma.cualquiera'),
        })
      );
    }
    idioma.value = actual;
    textoIdioma.textContent = t('buscar.idioma');
    etiquetaIdioma.title = t('buscar.idioma.titulo');
  }
  const frase = el('input', { attrs: { type: 'checkbox' } });
  frase.addEventListener('change', () => {
    soloFrase = frase.checked;
    pintarResultados();
  });
  const textoFrase = el('span');
  texto(textoFrase, 'buscar.frase');
  const etiquetaFrase = el('label', {
    className: 'buscar__opcion',
    children: [frase, textoFrase],
  });
  atributo(etiquetaFrase, 'title', 'buscar.frase.titulo');
  const selectOrden = el('select', { className: 'input buscar__paginas' });
  selectOrden.addEventListener('change', () => {
    orden = selectOrden.value;
    pintarResultados();
  });
  const textoOrden = el('span');
  texto(textoOrden, 'buscar.orden');
  const etiquetaOrden = el('label', {
    className: 'buscar__opcion',
    children: [textoOrden, selectOrden],
  });
  function pintarOrden() {
    clear(selectOrden);
    for (const v of ['llegada', 'relevancia', 'duracion']) {
      selectOrden.append(el('option', { attrs: { value: v }, text: t(`buscar.orden.${v}`) }));
    }
    selectOrden.value = orden;
  }
  // «Ver ocultos (N)»: lo que esconden los filtros se puede mirar sin quitar ninguno.
  const resumenOcultos = el('span', { className: 'buscar__ocultos' });
  const botonOcultos = el('button', {
    className: 'button button--ghost button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        verOcultos = !verOcultos;
        pintarResultados();
      },
    },
  });
  // «Descargar en»: un botón que abre la ventana de carpeta (qué es → nombre), no un desplegable.
  const destino = el('button', {
    className: 'button button--secondary button--small buscar__destino',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const r = await jd.nuevaCarpeta();
        if (!r) return;
        if (r.preguntar) {
          destinoFijo = null;
          reglaFija = null;
        } else {
          destinoFijo = r.carpeta;
          reglaFija = r.regla;
        }
        pintarDestinos();
      },
    },
  });
  const textoDestino = el('span');
  const etiquetaDestino = el('span', {
    className: 'buscar__opcion',
    children: [textoDestino, destino],
  });
  function pintarDestinos() {
    destino.textContent = `📁 ${
      destinoFijo === null ? t('buscar.destino.preguntar') : destinoFijo || t('video.jd.porDefecto')
    }`;
  }
  const descargarTodo = el('button', {
    className: 'button button--small',
    attrs: { type: 'button' },
    on: { click: () => descargar(visibles().map(r => r.sourceUrl || r.url)) },
  });
  jd.alCargar(() => {
    pintarDestinos();
    pintarResultados();
  });

  const yaLoTengo = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: { click: () => comprobarBiblioteca(true) },
  });
  texto(yaLoTengo, 'video.yaLoTengo');
  atributo(yaLoTengo, 'title', 'video.yaLoTengo.titulo');

  /* ── Sitios ─────────────────────────────────────────────────────── */
  function pintarSitios() {
    clear(chipsSitios);
    const activos = sitios.filter(s => !apagados.has(s.nombre));
    const todos = el('button', {
      className: `buscar__chip${activos.length === sitios.length ? ' buscar__chip--on' : ''}`,
      attrs: { type: 'button', 'aria-pressed': String(activos.length === sitios.length) },
      text: t('buscar.todos'),
      on: {
        click: () => {
          apagados.clear();
          guardarApagados(apagados);
          pintarSitios();
        },
      },
    });
    chipsSitios.append(todos);
    for (const s of sitios) {
      const on = !apagados.has(s.nombre);
      chipsSitios.append(
        el('button', {
          className: `buscar__chip${on ? ' buscar__chip--on' : ''}`,
          attrs: { type: 'button', 'aria-pressed': String(on) },
          text: s.nombre,
          on: {
            click: () => {
              // Con todos encendidos, tocar uno = buscar SOLO en ese (lo habitual al querer ir a uno).
              if (activos.length === sitios.length) {
                for (const x of sitios) if (x.id !== s.id) apagados.add(x.nombre);
              } else if (on) apagados.add(s.nombre);
              else apagados.delete(s.nombre);
              if (sitios.every(x => apagados.has(x.nombre))) apagados.clear();
              guardarApagados(apagados);
              pintarSitios();
            },
          },
        })
      );
    }
    ayuda.textContent =
      sitios.length === 0
        ? t('buscar.sinSitios')
        : activos.length === sitios.length
          ? t('buscar.ayuda.todos', { n: sitios.length })
          : tp('buscar.ayuda.algunos', activos.length);
    pintarModoEntrada();
    textoPaginas.textContent = t('buscar.paginas');
    textoRepetidos.textContent = t('buscar.ocultarRepetidos');
    textoDuracion.textContent = t('buscar.duracion');
    textoDestino.textContent = t('buscar.destino');
    const minActual = duracion.value || '0';
    clear(duracion);
    for (const n of [0, 1, 3, 5, 10, 20, 30]) {
      duracion.append(
        el('option', {
          attrs: { value: n },
          text: n ? t('buscar.duracion.min', { n }) : t('buscar.duracion.cualquiera'),
        })
      );
    }
    duracion.value = minActual;
    pintarDestinos();
    pintarIdiomas();
    pintarOrden();
    agregar.textContent = t('buscar.agregarSitios');
  }

  /** La ayuda y el botón dicen qué va a pasar con lo escrito (palabra o enlace). */
  function pintarModoEntrada() {
    const enlace = tipoDeEntrada(entrada.value) === 'enlace';
    boton.textContent = t(enlace ? 'buscar.boton.enlace' : 'buscar.boton');
    chipsSitios.hidden = enlace;
    if (enlace) ayuda.textContent = t('buscar.ayuda.enlace');
  }
  entrada.addEventListener('input', () => {
    const antes = chipsSitios.hidden;
    pintarModoEntrada();
    if (antes && !chipsSitios.hidden) pintarSitios();
  });

  async function cargarSitios() {
    try {
      const r = await fetch('/api/buscar/sitios').then(x => x.json());
      sitios = r.sitios || [];
      hayWeb = Boolean(r.web);
      etiquetaAbierta.hidden = !hayWeb;
    } catch {
      sitios = [];
    }
    pintarSitios();
  }

  /* ── Búsqueda ───────────────────────────────────────────────────── */
  /** Para la búsqueda EN EL SERVIDOR (cerrar la página ya no la para). */
  async function pararBusqueda() {
    const id = trabajo;
    terminar(true);
    if (id) {
      await fetch(`/api/buscar/trabajos/${id}/parar`, { method: 'POST' }).catch(() => {});
    }
  }

  function soltar() {
    clearTimeout(reintento);
    reintento = null;
    fuente?.close();
    fuente = null;
  }

  function terminar(cancelado = false) {
    soltar();
    trabajo = null;
    boton.hidden = false;
    parar.hidden = true;
    if (cancelado) {
      for (const [id, e] of estado) {
        if (e.fase === 'espera' || e.fase === 'busca') estado.set(id, { ...e, fase: 'fin' });
      }
    }
    pintarResultados();
    comprobarBiblioteca(false);
  }

  /** La búsqueda web trae más, pero también mucho que no es: se pregunta cada vez (null = cancelar). */
  async function preguntarWeb() {
    if (!hayWeb) return { conWeb: false, conAbierta: false };
    // «Toda la web» ya no se ofrece aquí: es la casilla del formulario, desmarcada por defecto.
    const r = await chooseDialog({
      titleKey: 'buscar.webPregunta',
      labelKey: 'buscar.webPregunta.texto',
      opciones: [
        { valor: 'no', titulo: t('buscar.webNo'), detalle: t('buscar.webNo.detalle') },
        { valor: 'si', titulo: t('buscar.webSi'), detalle: t('buscar.webSi.detalle') },
      ],
    });
    if (r === null) return null;
    return { conWeb: r === 'si', conAbierta: abierta.checked };
  }

  async function empezar(opciones = {}) {
    const q = (opciones.url || entrada.value).trim();
    if (opciones.url) entrada.value = opciones.url;
    if (!q) {
      entrada.focus();
      return;
    }
    const tipo = tipoDeEntrada(q);
    // «ejemplo.com» a secas: no hay nada que buscar en él todavía; se ofrece agregarlo.
    if (tipo === 'dominio') return abrirAlta({ dominios: [q] });
    const esEnlace = tipo === 'enlace';
    let conWeb = false;
    let conAbierta = false;
    if (!esEnlace) {
      const web = await preguntarWeb();
      if (web === null) return;
      ({ conWeb, conAbierta } = web);
    }
    const elegidos = esEnlace ? [] : sitios.filter(s => !apagados.has(s.nombre));
    if (!esEnlace && elegidos.length === 0 && !conAbierta) return;
    fuente?.close();
    resultados = [];
    descartados.clear();
    copias = new Map();
    enBiblioteca = new Map();
    pestana = 'todos';
    estado = new Map(elegidos.map(s => [s.id, { fase: 'espera', total: 0 }]));
    if (conAbierta) estado.set(ID_WEB, { fase: 'espera', total: 0 });
    sugeridos = [];
    if (!opciones.listado) listados = new Map();
    ultimaBusqueda = q;
    zonaResultados.hidden = false;
    boton.hidden = true;
    parar.hidden = false;

    const query = new URLSearchParams(
      esEnlace ? { url: q, paginas: paginas.value } : { q, paginas: paginas.value }
    );
    if (opciones.listado) query.set('listado', '1');
    if (conWeb) query.set('web', '1');
    if (conAbierta) query.set('abierta', '1');
    if (!esEnlace && elegidos.length < sitios.length) {
      query.set('sitios', elegidos.map(s => s.id).join(','));
    }
    try {
      // Fuera ?q= / ?searchTerm=: si quedara, recargar la página volvería a lanzar la búsqueda.
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      url.searchParams.delete('searchTerm');
      url.searchParams.delete('prellenar');
      window.history.replaceState(null, '', url);
    } catch {
      // sin URL: no pasa nada
    }

    let r;
    try {
      const resp = await fetch('/api/buscar/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(query)),
      });
      r = await resp.json();
      if (!resp.ok) throw new Error(r.error || `HTTP ${resp.status}`);
    } catch (error) {
      toast(error.message, 'error', 6000);
      terminar();
      return;
    }
    conectar(r.id, 0);
    pintarResultados();
    refrescarCola();
  }

  /** «término → carpeta» por línea (también «->», «=>» o un tabulador); las vacías no cuentan. */
  function leerLineas(textoLineas) {
    return String(textoLineas || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const [termino, ...resto] = l.split(/\s*(?:→|->|=>|\t)\s*/);
        const carpeta = resto.join('/').trim();
        return tipoDeEntrada(termino) === 'enlace'
          ? { url: termino.trim(), carpeta }
          : { q: termino.trim(), carpeta };
      });
  }

  async function encolarVarias() {
    const lineas = leerLineas(textoVarias.value);
    if (lineas.length === 0) return textoVarias.focus();
    const web = lineas.some(l => l.q) ? await preguntarWeb() : { conWeb: false, conAbierta: false };
    if (web === null) return;
    const elegidos = sitios.filter(x => !apagados.has(x.nombre));
    try {
      const resp = await fetch('/api/buscar/varias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busquedas: lineas,
          paginas: paginas.value,
          web: web.conWeb,
          abierta: web.conAbierta,
          ...(elegidos.length < sitios.length ? { sitios: elegidos.map(x => x.id) } : {}),
        }),
      });
      const r = await resp.json();
      if (r.ids?.length) toast(tp('buscar.varias.encoladas', r.ids.length), 'success', 4000);
      if (r.errores?.length) {
        toast(r.errores.map(e => `${e.q || '—'}: ${e.error}`).join(' · '), 'error', 8000);
      }
      if (r.ids?.length) {
        textoVarias.value = '';
        zonaVarias.hidden = true;
        // Si no se está mirando ninguna, se mira la primera de la tanda.
        if (!trabajo) await refrescarCola({ verId: r.ids[0] });
        else await refrescarCola();
      }
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }

  let colaActual = [];
  let relojCola = null;
  async function refrescarCola({ verId = null } = {}) {
    try {
      const r = await fetch('/api/buscar/cola').then(x => x.json());
      colaActual = r.busquedas || [];
    } catch {
      return;
    }
    pintarCola();
    if (verId) {
      const b = colaActual.find(x => x.id === verId);
      if (b) ver(b);
    }
  }
  relojCola = setInterval(() => {
    if (document.visibilityState !== 'hidden') refrescarCola();
  }, 4000);

  function pintarCola() {
    // Se enseña cuando hay algo más que la búsqueda que se mira: si no, es ruido.
    zonaCola.hidden = !colaActual.some(b => b.id !== trabajoVisto);
    if (zonaCola.hidden) return;
    listaCola.replaceChildren(
      ...colaActual.slice(0, 15).map(b => {
        const marca =
          b.estado === 'curso'
            ? t('buscar.cola.curso')
            : b.estado === 'cola'
              ? t('buscar.cola.esperando', { n: b.posicion })
              : b.quitada
                ? t('buscar.cola.quitada')
                : tp('buscar.resultados', b.total);
        const acciones = [];
        if (b.id !== trabajoVisto) {
          acciones.push(
            el('button', {
              className: 'button button--secondary button--small',
              attrs: { type: 'button' },
              text: t('buscar.cola.ver'),
              on: { click: () => ver(b) },
            })
          );
        }
        if (b.estado !== 'fin') {
          acciones.push(
            el('button', {
              className: 'button button--ghost button--small',
              attrs: { type: 'button' },
              text: t(b.estado === 'cola' ? 'buscar.cola.quitar' : 'buscar.parar'),
              on: {
                click: async () => {
                  await fetch(`/api/buscar/cola/${encodeURIComponent(b.id)}`, {
                    method: 'DELETE',
                  }).catch(() => {});
                  refrescarCola();
                },
              },
            })
          );
        }
        return el('li', {
          className: `buscar__cola-fila buscar__cola-fila--${b.estado}${b.id === trabajoVisto ? ' buscar__cola-fila--vista' : ''}`,
          children: [
            el('span', {
              className: b.estado === 'fin' ? 'buscar__hecho' : 'buscar__girando',
              text: b.estado === 'fin' ? '✓' : '',
            }),
            el('strong', { text: b.q }),
            b.carpeta ? el('span', { className: 'buscar__sitio', text: `→ ${b.carpeta}` }) : null,
            b.origen === 'programada'
              ? el('span', { className: 'buscar__sitio', text: t('buscar.cola.programada') })
              : null,
            el('span', { className: 'buscar__cola-estado', text: marca }),
            el('span', { className: 'buscar__acciones', children: acciones }),
          ],
        });
      })
    );
  }

  /** Mirar otra búsqueda del servidor (de la cola o terminada): se vuelve a pintar desde cero. */
  function ver(b) {
    pararVideo();
    entrada.value = b.q;
    ultimaBusqueda = b.q;
    resultados = [];
    estado = new Map();
    descartados.clear();
    copias = new Map();
    enBiblioteca = new Map();
    listados = new Map();
    sugeridos = [];
    pestana = 'todos';
    enCola = null;
    // La carpeta con la que se encoló pasa a ser el «Descargar en» de lo que encuentre.
    if (b.carpeta) {
      destinoFijo = b.carpeta;
      reglaFija = null;
      pintarDestinos();
    }
    conectar(b.id, 0);
    pintarCola();
    pintarResultados();
  }

  /** Se suscribe a la búsqueda `id` del servidor desde el evento `desde`. */
  function conectar(id, desde) {
    soltar();
    trabajo = id;
    trabajoVisto = id;
    recibidos = desde;
    zonaResultados.hidden = false;
    boton.hidden = true;
    parar.hidden = false;
    fuente = new EventSource(`/api/buscar/trabajos/${id}/stream?desde=${desde}`);
    fuente.onmessage = ev => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === 'no_existe') return terminar();
      if (Number.isInteger(m.seq)) {
        if (m.seq < recibidos) return; // ya visto (al reengancharse)
        recibidos = m.seq + 1;
      }
      if (m.type === 'en_cola') {
        enCola = m.posicion;
        refrescarCola();
      } else if (m.type === 'inicio' || m.type === 'reanudada') {
        enCola = null;
        refrescarCola();
      } else if (m.type === 'sitios') {
        for (const x of m.sitios || []) {
          nombresDelServidor.set(x.id, x.nombre);
          if (!estado.has(x.id)) estado.set(x.id, { fase: 'espera', total: 0 });
        }
      } else if (m.type === 'sitio_inicio') {
        estado.set(m.sitio, { ...estado.get(m.sitio), fase: 'busca' });
      } else if (m.type === 'sitio_progreso') {
        const previo = estado.get(m.sitio) || {};
        estado.set(
          m.sitio,
          m.web
            ? { ...previo, web: true, hechos: 0, enlaces: 0 }
            : {
                ...previo,
                modo: m.modo ?? previo.modo,
                hechos: m.hechos ?? previo.hechos ?? 0,
                enlaces: m.enlaces ?? previo.enlaces,
              }
        );
      } else if (m.type === 'resultados') {
        for (const it of m.items) resultados.push({ ...it, sitio: m.sitio });
        estado.set(m.sitio, {
          ...estado.get(m.sitio),
          total: (estado.get(m.sitio)?.total || 0) + m.items.length,
        });
      } else if (m.type === 'sitio_fin') {
        estado.set(m.sitio, {
          ...estado.get(m.sitio),
          fase: m.error ? 'error' : 'fin',
          error: m.error,
          bloqueo: m.bloqueo,
          recortado: m.recortado,
        });
      } else if (m.type === 'duracion') {
        // La duración que faltaba, pedida después a la ficha: solo rellena, nunca cambia una.
        const nuevas = new Map((m.items || []).map(d => [d.url, d]));
        for (const r of resultados) {
          const d = nuevas.get(r.url);
          if (d && !Number.isFinite(r.durationSeconds)) {
            r.durationSeconds = d.durationSeconds;
            r.duration = d.duration;
          }
        }
      } else if (m.type === 'listado_disponible') {
        listados.set(m.sitio, m.url);
      } else if (m.type === 'sitios_sugeridos') {
        sugeridos = m.sugeridos || [];
      } else if (m.type === 'duplicados') {
        copias = new Map();
        for (const g of m.grupos) {
          for (const u of g.miembros) {
            copias.set(u, { representante: g.representante, n: g.miembros.length });
          }
        }
      } else if (m.type === 'fin') return terminar();
      else if (m.type === 'error') {
        toast(m.message, 'error', 6000);
        return terminar();
      }
      pintarResultados();
    };
    // La conexión se cortó (otra app, la pantalla se apagó, la red): la búsqueda sigue en el
    // servidor, así que se vuelve a mirar desde el último evento visto.
    fuente.onerror = () => {
      if (!fuente || trabajo !== id) return;
      fuente.close();
      fuente = null;
      clearTimeout(reintento);
      reintento = setTimeout(() => {
        if (trabajo === id) conectar(id, recibidos);
      }, 3000);
    };
  }

  /**
   * Pregunta a clipkeeper cuáles ya están en la biblioteca: por título, o por duración + la persona
   * buscada (los ficheros renombrados ya no llevan el título del sitio). En tandas de 200, el tope
   * de clipkeeper por petición: antes, de una búsqueda grande solo se miraban los 200 primeros.
   */
  async function comprobarBiblioteca(avisar) {
    const lista = resultados.filter(
      r => r.title || nombreDeUrl(r.url) || Number.isFinite(r.durationSeconds)
    );
    if (lista.length === 0) return;
    try {
      const persona = ultimaBusqueda || entrada.value.trim();
      const r = { conectado: true, error: null, resultados: [] };
      for (let i = 0; i < lista.length; i += 200) {
        const tanda = lista.slice(i, i + 200);
        const parte = await ajustes.yaLoTengo(
          tanda.map(x => x.title || nombreDeUrl(x.url) || ''),
          tanda.map(x => (Number.isFinite(x.durationSeconds) ? x.durationSeconds : null)),
          persona,
          // Para el rendimiento por sitio: la comprobación automática al terminar cuenta (el
          // servidor la cuenta una sola vez por búsqueda); el botón, no.
          {
            enlaces: tanda.map(x => x.sourceUrl || x.url),
            contar: avisar || !trabajoVisto ? false : `${trabajoVisto}#${i}`,
          }
        );
        if (!parte.conectado || parte.error) {
          Object.assign(r, { conectado: parte.conectado, error: parte.error });
          break;
        }
        r.resultados.push(...parte.resultados);
      }
      if (!r.conectado || r.error) {
        if (avisar) toast(r.error || t('video.yaLoTengo.sinConexion'), 'error', 6000);
        return;
      }
      enBiblioteca = new Map();
      r.resultados.forEach((res, i) => {
        if (res.coincidencias.length) {
          enBiblioteca.set(lista[i].sourceUrl || lista[i].url, res.coincidencias[0]);
        }
      });
      if (avisar) {
        toast(
          enBiblioteca.size
            ? tp('video.yaLoTengo.resultado', enBiblioteca.size)
            : t('video.yaLoTengo.ninguno'),
          'success',
          4000
        );
      }
      pintarResultados();
    } catch (error) {
      if (avisar) toast(error.message, 'error', 6000);
    }
  }

  /* ── Pintar ─────────────────────────────────────────────────────── */
  const nombreSitio = id =>
    id === ID_WEB
      ? t('buscar.webAbierta')
      : sitios.find(s => s.id === id)?.nombre || nombresDelServidor.get(id) || '';
  const dominioDe = url => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  function pestanaBoton(id, etiqueta, n, e) {
    const activa = pestana === id;
    const marca = !e
      ? ''
      : e.fase === 'busca' || e.fase === 'espera'
        ? ' ⏳'
        : e.fase === 'error'
          ? ' ⚠'
          : e.bloqueo
            ? ' ⚠'
            : '';
    return el('button', {
      className: `buscar__pestana${activa ? ' buscar__pestana--activa' : ''}${e?.fase === 'error' ? ' buscar__pestana--error' : ''}`,
      attrs: {
        type: 'button',
        role: 'tab',
        'aria-selected': String(activa),
        title:
          e?.error ||
          (e?.bloqueo ? t('buscar.bloqueo') : e?.recortado ? t('buscar.recortado') : ''),
      },
      children: [
        `${etiqueta} `,
        el('span', { className: 'buscar__n', text: `${n}${e?.recortado ? '+' : ''}${marca}` }),
      ],
      on: {
        click: () => {
          pestana = id;
          pintarResultados();
        },
      },
    });
  }

  function tarjeta(r) {
    const enlace = r.sourceUrl || r.url;
    // Por FICHERO, no por ficha: los vídeos de un álbum comparten ficha y cada uno tiene su tarjeta.
    if (reproduciendo?.url === r.url) return reproduciendo.tarjeta;
    const nombreDelSitio = r.sitio === ID_WEB ? dominioDe(enlace) : nombreSitio(r.sitio);
    const tengo = enBiblioteca.get(enlace);
    const imagen =
      r.thumbnail && !miniaturasRotas.has(r.thumbnail)
        ? el('img', {
            attrs: {
              src: `/api/thumbnail?url=${encodeURIComponent(r.thumbnail)}`,
              alt: '',
              loading: 'lazy',
            },
            // Si el sitio no la da, el hueco de siempre en vez de una imagen rota
            on: {
              error: e => {
                miniaturasRotas.add(r.thumbnail);
                e.currentTarget.replaceWith(el('span', { className: 'buscar__sin', text: '▶' }));
              },
            },
          })
        : el('span', { className: 'buscar__sin', text: '▶' });
    const acciones = [
      el('a', {
        className: 'button button--secondary button--small',
        attrs: { href: enlace, target: '_blank', rel: 'noopener noreferrer' },
        text: t('buscar.abrir'),
      }),
    ];
    if (archivoReproducible(r)) {
      acciones.unshift(
        el('button', {
          className: 'button button--secondary button--small buscar__play',
          attrs: { type: 'button' },
          text: t('buscar.ver'),
          on: { click: e => alternarVideo(r, enlace, e.currentTarget) },
        })
      );
    }
    if (jd.configurado()) {
      acciones.push(
        el('button', {
          className: 'button button--small',
          attrs: { type: 'button' },
          text: t('buscar.jd'),
          on: { click: () => descargar([enlace]) },
        })
      );
    }
    const oculto = motivoOculto(r);
    const kAlbum = claveAlbum(r);
    const grupoAlbum = kAlbum ? albumes.get(kAlbum) : null;
    const esCabezaAlbum = Boolean(grupoAlbum && grupoAlbum[0] === r);
    const abierto = Boolean(kAlbum && albumesAbiertos.has(kAlbum));
    if (esCabezaAlbum) {
      acciones.push(
        el('button', {
          className: 'button button--ghost button--small buscar__album-boton',
          attrs: { type: 'button', 'aria-expanded': String(abierto) },
          text: abierto
            ? t('buscar.album.plegar')
            : t('buscar.album.ver', { n: grupoAlbum.length }),
          on: {
            click: () => {
              if (abierto) albumesAbiertos.delete(kAlbum);
              else albumesAbiertos.add(kAlbum);
              pintarResultados();
            },
          },
        })
      );
    }
    return el('article', {
      className: `buscar__tarjeta${tengo ? ' buscar__tarjeta--tengo' : ''}${oculto ? ' buscar__tarjeta--oculta' : ''}${grupoAlbum && !esCabezaAlbum ? ' buscar__tarjeta--miembro' : ''}`,
      children: [
        oculto
          ? el('span', {
              className: 'buscar__motivo',
              text:
                oculto === 'bloqueada'
                  ? t('buscar.oculto.bloqueada.palabra', { palabra: r.bloqueada })
                  : t(`buscar.oculto.${oculto}`),
            })
          : null,
        el('a', {
          className: 'buscar__imagen',
          attrs: { href: enlace, target: '_blank', rel: 'noopener noreferrer' },
          children: [
            imagen,
            r.duration ? el('span', { className: 'buscar__duracion', text: r.duration }) : null,
            tengo ? el('span', { className: 'buscar__tengo', text: t('buscar.loTienes') }) : null,
            (() => {
              const extra =
                (copias.get(r.url)?.representante === r.url ? copias.get(r.url).n - 1 : 0) +
                (ocultarRepetidos ? (cuentaPagina.get(clavePagina(r)) || 1) - 1 : 0);
              return extra > 0
                ? el('span', {
                    className: 'buscar__copias',
                    text: `+${extra}`,
                    attrs: { title: tp('buscar.copias', extra) },
                  })
                : null;
            })(),
            esCabezaAlbum
              ? el('span', {
                  className: 'buscar__album',
                  text: `▣ ${grupoAlbum.length}`,
                  attrs: { title: tp('buscar.album', grupoAlbum.length) },
                })
              : null,
            r.web
              ? el('span', {
                  className: 'buscar__web',
                  text: '🌐',
                  attrs: { title: t('buscar.web.resultado') },
                })
              : null,
          ],
        }),
        el('div', {
          className: 'buscar__texto',
          children: [
            el('strong', {
              text: r.title || nombreDeUrl(r.url) || enlace,
              attrs: { title: r.title || enlace },
            }),
            el('span', {
              className: 'buscar__sitio',
              text: Number.isFinite(r.relevancia)
                ? `${nombreDelSitio} · ${r.relevancia} %`
                : nombreDelSitio,
              attrs: Number.isFinite(r.relevancia)
                ? { title: t('buscar.relevancia', { n: r.relevancia }) }
                : {},
            }),
          ],
        }),
        el('div', { className: 'buscar__acciones', children: acciones }),
        el('button', {
          className: 'buscar__descartar',
          attrs: {
            type: 'button',
            title: t('buscar.descartar'),
            'aria-label': t('buscar.descartar'),
          },
          text: '✕',
          on: {
            click: () => {
              descartados.add(enlace);
              pintarResultados();
            },
          },
        }),
      ],
    });
  }

  /**
   * Reproduce el vídeo dentro de su tarjeta, en lugar de la miniatura. Pasa por /api/media (el
   * servidor), por lo mismo que las miniaturas: el navegador no habla con el sitio, y muchos solo
   * sirven el fichero a quien abrió la ficha. Uno a la vez: empezar otro para el anterior.
   */
  function alternarVideo(r, enlace, boton) {
    const tarjetaActual = boton.closest('.buscar__tarjeta');
    if (reproduciendo?.url === r.url) {
      pararVideo();
      pintarResultados();
      return;
    }
    const habia = Boolean(reproduciendo);
    pararVideo();
    const video = el('video', {
      className: 'buscar__video',
      attrs: {
        controls: '',
        autoplay: '',
        playsinline: '',
        preload: 'metadata',
        src: `/api/media?url=${encodeURIComponent(r.url)}&ref=${encodeURIComponent(r.sourceUrl || '')}`,
      },
      on: {
        error: () => {
          if (reproduciendo?.video === video) toast(t('buscar.videoError'), 'error', 6000);
        },
      },
    });
    const caja = el('div', {
      className: 'buscar__imagen buscar__imagen--video',
      children: [video],
    });
    tarjetaActual.querySelector('.buscar__imagen').replaceWith(caja);
    boton.textContent = t('buscar.cerrarVideo');
    reproduciendo = { enlace, url: r.url, tarjeta: tarjetaActual, video };
    // La tarjeta del vídeo anterior vuelve a su miniatura
    if (habia) pintarResultados();
  }

  function lineaSitio(id, e) {
    let texto;
    if (e.fase === 'espera') texto = t('buscar.estado.cola');
    else if (e.fase === 'busca' && e.web) texto = t('buscar.estado.web');
    else if (e.fase === 'busca' && e.modo === 'pagina') texto = t('buscar.estado.pagina');
    else if (e.fase === 'busca' && e.modo === 'listado' && !e.enlaces) {
      texto = t('buscar.estado.listado');
    } else if (e.fase === 'busca' && e.enlaces) {
      texto = t('buscar.estado.revisando', { hechos: e.hechos || 0, total: e.enlaces });
    } else if (e.fase === 'busca') texto = t('buscar.estado.buscando');
    else if (e.fase === 'error') texto = t('buscar.estado.error', { error: e.error });
    else texto = tp('buscar.resultados', e.total || 0);
    const enCurso = e.fase === 'busca' || e.fase === 'espera';
    return el('li', {
      className: `buscar__linea${enCurso ? ' buscar__linea--curso' : ''}${e.fase === 'error' ? ' buscar__linea--error' : ''}`,
      children: [
        el('span', {
          className: enCurso ? 'buscar__girando' : 'buscar__hecho',
          text: enCurso ? '' : e.fase === 'error' ? '⚠' : '✓',
        }),
        el('strong', { text: nombreSitio(id) }),
        el('span', { text: texto }),
      ],
    });
  }

  function pintarResultados() {
    if (zonaResultados.hidden) return;
    clear(progreso);
    const quedan = [...estado.values()].filter(
      e => e.fase === 'espera' || e.fase === 'busca'
    ).length;
    progreso.append(
      el('li', {
        className: 'buscar__resumen',
        children: [
          el('span', {
            text: enCola
              ? t('buscar.estado.enCola')
              : quedan
                ? t('buscar.estado.quedan', { n: quedan, total: estado.size })
                : t('buscar.estado.terminado'),
          }),
          quedan
            ? el('button', {
                className: 'button button--secondary button--small',
                attrs: { type: 'button' },
                text: t('buscar.parar'),
                on: { click: () => pararBusqueda() },
              })
            : null,
        ],
      })
    );
    for (const [id, e] of estado) progreso.append(lineaSitio(id, e));
    clear(pestanas);
    const buscando = [...estado.values()].some(e => e.fase === 'espera' || e.fase === 'busca');
    pestanas.append(
      pestanaBoton(
        'todos',
        t('buscar.todos'),
        resultados.length,
        buscando ? { fase: 'busca' } : null
      )
    );
    for (const [id, e] of estado) {
      if (nombreSitio(id)) pestanas.append(pestanaBoton(id, nombreSitio(id), e.total || 0, e));
    }
    pintarSugeridos();

    const lista = visibles();
    clear(barra);
    if (lista.length > 0) {
      if (descartados.size) {
        barra.append(
          el('button', {
            className: 'button button--ghost button--small',
            attrs: { type: 'button' },
            text: tp('buscar.descartados', descartados.size),
            on: {
              click: () => {
                descartados.clear();
                pintarResultados();
              },
            },
          })
        );
      }
      const sueltos = visibles({ porAlbum: false }).length;
      const repetidos = ocultarRepetidos
        ? visibles({ plegar: false, porAlbum: false }).length - sueltos
        : 0;
      const enAlbumes = sueltos - lista.length;
      // `visibles` deja en `albumes` lo de la última llamada: se recalcula con la lista pintada.
      visibles();
      barra.append(
        el('span', {
          className: 'buscar__cuenta',
          text:
            tp('buscar.resultados', lista.length) +
            (repetidos ? ` · ${tp('buscar.repetidos', repetidos)}` : '') +
            (enAlbumes > 0 ? ` · ${tp('buscar.enAlbumes', enAlbumes)}` : ''),
        }),
        yaLoTengo
      );
      if (jd.configurado()) {
        descargarTodo.textContent = t('buscar.descargarTodo', { n: lista.length });
        barra.append(etiquetaDestino, descargarTodo);
      }
    }
    pintarFiltros();

    const e = pestana === 'todos' ? null : estado.get(pestana);
    vacio.hidden = lista.length > 0;
    vacio.textContent =
      e?.fase === 'error'
        ? t('buscar.errorSitio', { error: e.error })
        : buscando || e?.fase === 'busca' || e?.fase === 'espera'
          ? t('buscar.buscando')
          : t('buscar.nada');

    clear(rejilla);
    cuentaPagina = porPagina();
    for (const r of verOcultos ? visibles({ conOcultos: true }) : lista) {
      rejilla.append(tarjeta(r));
    }
  }

  /** Cuántos esconde cada filtro, en la pestaña que se mira (sin contar los quitados a mano). */
  function contarOcultos() {
    const n = new Map();
    for (const r of resultados) {
      if (!enPestana(r)) continue;
      const m = motivoOculto(r);
      if (m) n.set(m, (n.get(m) || 0) + 1);
    }
    return n;
  }

  function pintarFiltros() {
    zonaFiltros.hidden = resultados.length === 0;
    if (zonaFiltros.hidden) return;
    if (!zonaFiltros.firstChild) {
      zonaFiltros.append(
        filtroContener,
        filtroExcluir,
        etiquetaIdioma,
        etiquetaFrase,
        etiquetaOrden,
        etiquetaDuracion,
        etiquetaRepetidos,
        el('span', { className: 'buscar__ocultos-fila', children: [resumenOcultos, botonOcultos] })
      );
    }
    const ocultos = contarOcultos();
    const total = [...ocultos.values()].reduce((a, b) => a + b, 0);
    resumenOcultos.textContent = total
      ? `${tp('buscar.ocultos', total)} (${[...ocultos]
          .map(([m, n]) => t(`buscar.oculto.${m}.n`, { n }))
          .join(', ')})`
      : '';
    botonOcultos.hidden = total === 0 && !verOcultos;
    botonOcultos.textContent = t(verOcultos ? 'buscar.ocultos.esconder' : 'buscar.ocultos.ver');
  }

  function pintarSugeridos() {
    clear(zonaSugeridos);
    zonaSugeridos.hidden = sugeridos.length === 0 && listados.size === 0;
    for (const [id, url] of listados) {
      zonaSugeridos.append(
        el('span', { text: t('buscar.listado', { sitio: nombreSitio(id) }) }),
        el('button', {
          className: 'button button--secondary button--small',
          attrs: { type: 'button' },
          text: t('buscar.listado.recorrer'),
          on: {
            click: () => {
              listados.delete(id);
              empezar({ url, listado: true });
            },
          },
        })
      );
    }
    if (sugeridos.length === 0) return;
    zonaSugeridos.append(el('span', { text: t('buscar.sugeridos') }));
    for (const s of sugeridos) {
      zonaSugeridos.append(
        el('button', {
          className: 'button button--secondary button--small',
          attrs: { type: 'button', title: tp('buscar.resultados', s.videos) },
          text: `+ ${s.dominio} (${s.videos})`,
          on: { click: () => abrirAlta({ dominios: [s.dominio], termino: ultimaBusqueda }) },
        })
      );
    }
  }

  alCambiarIdioma(() => {
    pintarSitios();
    pintarResultados();
  });

  // Viene con ?q= (o ?searchTerm=, como enlaza clipkeeper): se busca directamente.
  const inicial = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get('q') || p.get('searchTerm') || '';
    } catch {
      return '';
    }
  })();
  // ?prellenar=: deja el texto escrito, pero la búsqueda la lanza la persona.
  const prellenado = (() => {
    try {
      return new URLSearchParams(window.location.search).get('prellenar') || '';
    } catch {
      return '';
    }
  })();
  if (inicial || prellenado) entrada.value = inicial || prellenado;
  /** Al abrir la página: si hay una búsqueda (en marcha o reciente) en el servidor, se muestra. */
  async function reengancharse() {
    try {
      const { busqueda } = await fetch('/api/buscar/actual').then(x => x.json());
      if (!busqueda) return;
      ver(busqueda);
    } catch {
      // sin búsqueda previa: la pantalla queda vacía, como siempre
    }
  }

  cargarSitios().then(() => {
    refrescarCola();
    const hash = window.location.hash;
    if (inicial && (hash === '' || hash.startsWith('#/buscar'))) empezar();
    else if (!prellenado) reengancharse();
  });

  return {
    focus: () => enfocarAlAbrir(entrada),
    // Solo deja de mirar: la búsqueda sigue en el servidor.
    teardown: () => {
      soltar();
      clearInterval(relojCola);
    },
  };
}
