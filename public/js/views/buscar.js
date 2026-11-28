import { cargarMiniatura } from '../miniaturas.js';
import { ajustes, fase7 } from '../api.js';
import { el, clear, toast, enfocarAlAbrir, copyToClipboard } from '../dom.js';
import { t, tp, texto, atributo, alCambiarIdioma, idiomaActual } from '../i18n/index.js';
import { createJdEnvio } from '../components/jdEnvio.js';
import { altaSitiosDialog } from '../components/altaSitios.js';
import { palabras, normalizar as normalizarTexto } from '../filtros.js';
import { claveAlbum } from '../albumes.js';
import { abrirHoja, menuAcciones } from '../hojas.js';
import { paraDescargarTodo, fechaCorta } from '../unaMano.js';
import { carpetaPropuesta } from '../carpetas.js';
import {
  calcularLista,
  crearTextoNormal,
  enlaceDe,
  nombreDeUrl,
  tamanosPrimeros,
  tipoDeEntrada,
} from '../buscarModelo.js';

/** El «sitio» de lo encontrado en toda la web (no es una configuración guardada). */
const ID_WEB = -1;

/**
 * Buscar: la pantalla de inicio. Se escribe un nombre y se busca en TODOS los sitios guardados a la
 * vez (las configuraciones cuya dirección lleva {q}); los resultados llegan mezclados y arriba hay
 * una marca por sitio, con su recuento y su estado, para ver solo los de uno.
 *
 * Fase 3 (cómoda con una mano): la caja va en la cabecera, con UN solo botón «Filtros (N)» al
 * lado que abre una hoja con dos partes, «Qué buscar» (sitios, páginas, web, varias, vista) y
 * «Filtrar resultados». Los resultados salen grandes (dos por fila en el móvil) o en lista
 * compacta, a elegir y recordado en el dispositivo; con selección múltiple (pulsación larga o la
 * casilla) y las acciones abajo. «Ya lo tengo» y lo ya enviado se ocultan por defecto, con su
 * contador, y nunca entran en «Descargar todo».
 */

const CLAVE_SITIOS = 'clipscout:buscar-apagados';
/** Sitios «no buscar por defecto» ya apagados una vez: si luego se encienden a mano, se respeta. */
const CLAVE_FUERA = 'clipscout:buscar-fuera-aplicados';
/** «Usar también el buscador web»: antes se preguntaba en cada búsqueda; ahora se recuerda. */
const CLAVE_WEB = 'clipscout:buscar-web';
/** Vista de los resultados: 'grande' (por defecto) o 'compacta'. Por dispositivo. */
const CLAVE_VISTA = 'clipscout:buscar-vista';

/**
 * Miniaturas que ya fallaron en esta página. Una fila rehecha volvía a pedir la misma imagen rota:
 * estas salen ya como hueco, sin petición.
 */
const miniaturasRotas = new Set();

const leer = (clave, defecto) => {
  try {
    return localStorage.getItem(clave) ?? defecto;
  } catch {
    return defecto;
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // sin almacenamiento: se olvida al recargar, no es crítico
  }
};

function leerApagados() {
  try {
    return new Set(JSON.parse(leer(CLAVE_SITIOS, '[]')));
  } catch {
    return new Set();
  }
}
const guardarApagados = apagados => guardar(CLAVE_SITIOS, JSON.stringify([...apagados]));

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
  let trabajoVisto = null; // la que se está mirando (sigue tras terminar)
  let enCola = null; // puesto en la cola mientras espera su turno (null = ya arrancó)
  let parada = false; // la persona la paró (aquí o en otro dispositivo): «Búsqueda parada»
  let recibidos = 0; // eventos ya procesados
  let reintento = null;
  let enBiblioteca = new Map(); // ficha → coincidencia de clipkeeper
  let enviados = new Map(); // ficha → fecha en que se mandó a JDownloader (CS-N7)
  const nombresDelServidor = new Map(); // id → nombre, para los «sitios» que no son guardados
  // Enlaces pegados que, además de sus vídeos, son un listado: se ofrece recorrer sus fichas.
  let listados = new Map(); // id → url
  let sugeridos = []; // { dominio, videos }: sitios sin configurar que dieron vídeos en la web
  let ultimaBusqueda = '';

  /* ── Cabecera: la caja de búsqueda ──────────────────────────────── */
  const entrada = el('input', {
    className: 'input buscar__entrada',
    // `text` y no `search`: el navegador no añade su propia cruz junto a «Limpiar» (CS-UX-005).
    attrs: { type: 'text', inputmode: 'search', autocomplete: 'off', enterkeyhint: 'search' },
  });
  atributo(entrada, 'placeholder', 'buscar.placeholder');
  atributo(entrada, 'aria-label', 'buscar.placeholder');

  const icono = nombre => (window.cgIcono ? window.cgIcono(nombre) : document.createTextNode(''));
  const boton = el('button', {
    className: 'cg-boton cg-boton--icono cg-boton--principal buscar__boton',
    attrs: { type: 'submit' },
    children: [icono('buscar')],
  });
  // EL botón de filtros (solo hay uno): qué buscar y cómo filtrar lo encontrado, en una hoja.
  const botonFiltros = el('button', {
    className: 'cg-boton buscar__boton-filtros',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    on: { click: () => abrirFiltros() },
  });
  // «Limpiar»: vacía la caja y lo que se ve, y al volver ya no aparece la última búsqueda (que sigue
  // en Actividad y, si estaba en marcha, sigue buscando).
  const botonLimpiar = el('button', {
    className: 'cg-boton cg-boton--icono cg-boton--fantasma buscar__limpiar',
    attrs: { type: 'button', hidden: '' },
    children: [icono('cerrar')],
    on: { click: () => limpiarPantalla() },
  });
  atributo(botonLimpiar, 'aria-label', 'buscar.limpiar');
  atributo(botonLimpiar, 'title', 'buscar.limpiar');
  const formCaja = el('form', {
    className: 'buscar__fila',
    attrs: { role: 'search' },
    children: [entrada, botonLimpiar, boton, botonFiltros],
    on: {
      submit: e => {
        e.preventDefault();
        entrada.blur(); // en el móvil baja el teclado y deja ver los resultados
        empezar();
      },
    },
  });
  const titulo = el('h1', {
    className: 'cg-cabecera-titulo buscar__titulo-oculto',
    attrs: { id: 'buscar-heading' },
  });
  texto(titulo, 'buscar.titulo');
  const cabecera = document.createElement('cg-cabecera');
  cabecera.className = 'buscar__cabecera';
  cabecera.append(titulo, formCaja);

  /* ── Opciones de la búsqueda (hoja): sitios, páginas, web, varias ─ */
  const CLAVE_PAGINAS = 'clipscout:buscar-paginas';
  const paginas = el('select', { className: 'input buscar__paginas' });
  // Hasta 50: a veces se quiere barrer a fondo, y es la cola la que reparte el trabajo.
  for (const n of [1, 2, 3, 5, 10, 20, 30, 50]) {
    paginas.append(el('option', { attrs: { value: n }, text: n }));
  }
  paginas.value = leer(CLAVE_PAGINAS, '2');
  /*
   * «Rápida / Normal / A fondo» en vez de un número a secas (§5.5: 1–50 no dice lo que cuesta).
   * El desplegable sigue debajo para afinar (hasta 50); si el número no es uno de los tres, no se
   * marca ninguno.
   */
  const MODOS_PAGINAS = [
    { id: 'rapida', n: 1 },
    { id: 'normal', n: 2 },
    { id: 'fondo', n: 5 },
  ];
  const chipsPaginas = document.createElement('cg-chips');
  chipsPaginas.setAttribute('unico', '');
  chipsPaginas.className = 'buscar__modos';
  for (const m of MODOS_PAGINAS) {
    chipsPaginas.append(
      el('button', {
        attrs: { type: 'button', value: String(m.n), 'data-modo': m.id },
        children: [el('span')],
      })
    );
  }
  function pintarModos() {
    for (const b of chipsPaginas.querySelectorAll('button[data-modo]')) {
      b.setAttribute('aria-pressed', String(b.value === paginas.value));
      b.lastElementChild.textContent = t(`buscar.modo.${b.dataset.modo}`);
      b.title = tp('buscar.modo.paginas', Number(b.value));
    }
  }
  chipsPaginas.addEventListener('cg-cambiado', e => {
    const v = e.detail?.chip?.value;
    if (!v || v === paginas.value) return;
    paginas.value = v;
    paginas.dispatchEvent(new Event('change'));
  });
  paginas.addEventListener('change', () => {
    guardar(CLAVE_PAGINAS, paginas.value);
    pintarModos();
    pintarInicio();
  });

  /**
   * «También en toda la web»: cualquier sitio que nombre lo buscado, aunque no esté configurado.
   * DESACTIVADA por defecto (trae mucho ruido); se recuerda en este navegador. Solo con SearXNG.
   */
  const CLAVE_ABIERTA = 'clipscout:buscar-abierta';
  const abierta = el('input', { attrs: { type: 'checkbox' } });
  abierta.checked = leer(CLAVE_ABIERTA, '0') === '1';
  abierta.addEventListener('change', () => {
    guardar(CLAVE_ABIERTA, abierta.checked ? '1' : '0');
    pintarBotonFiltros();
  });
  // «Usar también el buscador web» (resultados 🌐): antes un diálogo en cada búsqueda.
  const conWeb = el('input', { attrs: { type: 'checkbox' } });
  conWeb.checked = leer(CLAVE_WEB, '0') === '1';
  conWeb.addEventListener('change', () => {
    guardar(CLAVE_WEB, conWeb.checked ? '1' : '0');
    pintarBotonFiltros();
  });

  let hayWeb = false; // ¿hay SearXNG configurado?
  const casilla = (input, clave, detalleClave) =>
    el('label', {
      className: 'cs-casilla',
      children: [
        input,
        el('span', {
          children: [t(clave), detalleClave ? el('small', { text: t(detalleClave) }) : null],
        }),
      ],
    });

  const chipsSitios = el('div', { className: 'buscar__sitios' });

  /** Vista de los resultados: grandes (dos por fila en el móvil) o lista compacta. */
  const compacta = el('input', { attrs: { type: 'checkbox' } });
  compacta.checked = leer(CLAVE_VISTA, 'grande') === 'compacta';
  compacta.addEventListener('change', () => {
    guardar(CLAVE_VISTA, compacta.checked ? 'compacta' : 'grande');
    aplicarVista();
  });

  /** «Qué buscar», la primera parte de la hoja de filtros (lo que antes era «Opciones»). */
  function parteQueBuscar(hoja) {
    pintarSitios();
    return [
      el('h3', { className: 'cs-hoja-titulo', text: t('buscar.parte.que') }),
      el('p', { className: 'field__label', text: t('buscar.sitios.titulo') }),
      chipsSitios,
      el('p', { className: 'cs-nota', text: textoAyudaSitios() }),
      el('p', { className: 'field__label', text: t('buscar.modo.titulo') }),
      (pintarModos(), chipsPaginas),
      // CS-UX-008: la profundidad manda; el número exacto, plegado.
      el('details', {
        className: 'buscar__avanzado',
        children: [
          el('summary', { text: t('buscar.avanzado') }),
          el('label', {
            className: 'field buscar__paginas-fino',
            children: [
              el('span', { className: 'field__label', text: t('buscar.paginas') }),
              paginas,
            ],
          }),
        ],
      }),
      hayWeb ? casilla(conWeb, 'buscar.web.siempre', 'buscar.webSi.detalle') : null,
      hayWeb ? casilla(abierta, 'buscar.webTodo', 'buscar.webTodo.detalle') : null,
      // CS-N6: sin buscador web no se esconde sin más: se dice qué falta y dónde se pone.
      hayWeb
        ? null
        : el('p', {
            className: 'cs-nota buscar__sin-web',
            children: [
              el('span', { text: `${t('buscar.sinWeb')} ` }),
              el('a', {
                attrs: { href: '#/ajustes/busqueda' },
                text: t('buscar.sinWeb.como'),
                on: { click: () => hoja.cerrar() },
              }),
            ],
          }),
      el('div', {
        className: 'cs-fila-botones',
        children: [
          el('button', {
            className: 'cg-boton',
            attrs: { type: 'button' },
            text: t('buscar.agregarSitios'),
            on: {
              click: () => {
                hoja.cerrar();
                abrirAlta({ termino: entrada.value.trim() });
              },
            },
          }),
          el('button', {
            className: 'cg-boton',
            attrs: { type: 'button' },
            text: t('buscar.varias'),
            on: {
              click: () => {
                hoja.cerrar();
                abrirVarias('');
              },
            },
          }),
        ],
      }),
    ].filter(Boolean);
  }

  /** Lo que difiere de lo normal en «Qué buscar»: cuenta en «Filtros (N)». */
  function queBuscarActivo() {
    const a = [];
    const activos = sitios.filter(x => !apagados.has(x.nombre)).length;
    if (sitios.length && activos < sitios.length) {
      a.push(t('buscar.marca.sitios', { n: activos, total: sitios.length }));
    }
    if (hayWeb && conWeb.checked) a.push(t('buscar.marca.web'));
    if (hayWeb && abierta.checked) a.push(t('buscar.marca.webTodo'));
    return a;
  }

  // Alta de sitios con solo su dirección: clipscout la configura y la prueba.
  async function abrirAlta({ dominios = [], termino = '' } = {}) {
    const n = await altaSitiosDialog({ dominios, termino });
    if (n > 0) {
      toast(tp('alta.guardados', n), 'success', 4000);
      sugeridos = sugeridos.filter(s => !dominios.includes(s.dominio));
      await cargarSitios();
      pintarResultados();
    }
  }

  /* ── Varias búsquedas de golpe (una por línea, «término → carpeta») ── */
  function abrirVarias(textoInicial) {
    const area = el('textarea', {
      className: 'input buscar__varias-texto',
      attrs: { rows: 6, spellcheck: 'false', placeholder: t('buscar.varias.ej') },
    });
    atributo(area, 'aria-label', 'buscar.varias');
    area.value = textoInicial || '';
    const encolar = el('button', {
      className: 'cg-boton cg-boton--principal',
      attrs: { type: 'button' },
    });
    const pintarEncolar = () => {
      encolar.textContent = t('buscar.varias.encolar', { n: leerLineas(area.value).length });
    };
    pintarEncolar();
    area.addEventListener('input', pintarEncolar);
    const hoja = abrirHoja({
      titulo: t('buscar.varias'),
      contenido: [area, el('p', { className: 'field__hint', text: t('buscar.varias.hint') })],
      pie: [encolar],
    });
    encolar.addEventListener('click', async () => {
      if (await encolarVarias(area.value)) hoja.cerrar();
      else area.focus();
    });
    setTimeout(() => area.focus(), 300);
  }
  // Pegar una lista en la caja normal (que es de una línea y se comería los saltos) abre la de varias.
  entrada.addEventListener('paste', e => {
    const pegado = e.clipboardData?.getData('text') || '';
    if (pegado.split(/\r?\n/).filter(l => l.trim()).length > 1) {
      e.preventDefault();
      abrirVarias(pegado);
    }
  });

  /* ── Antes de buscar: qué va a pasar y los primeros pasos ───────── */
  const resumenInicio = el('p', { className: 'buscar__resumen-inicio' });
  const botonAgregar = el('button', {
    className: 'cg-boton',
    attrs: { type: 'button', id: 'agregar-sitios' },
    on: { click: () => abrirAlta({ termino: entrada.value.trim() }) },
  });
  const botonVarias = el('button', {
    className: 'cg-boton',
    attrs: { type: 'button' },
    on: { click: () => abrirVarias('') },
  });
  /*
   * CS-N9: lo último buscado (en el servidor: igual en el móvil y en el ordenador), a un toque.
   * Se ve antes de la primera búsqueda y, después, al tocar la caja (filtrado por lo escrito).
   */
  const recientes = el('section', {
    className: 'buscar__recientes',
    attrs: { hidden: '', 'aria-labelledby': 'buscar-recientes-titulo' },
    // Tocar una no debe quitar el foco de la caja antes del clic (se cerraría la lista).
    on: { pointerdown: e => e.target.closest('button') && e.preventDefault() },
  });
  let historial = [];
  let cajaEnfocada = false;
  async function pintarRecientes() {
    try {
      ({ busquedas: historial = [] } = await (await fetch('/api/buscar/historial')).json());
    } catch {
      historial = [];
    }
    mostrarRecientes();
  }
  function mostrarRecientes() {
    const escrito = normalizarTexto(entrada.value.trim());
    const lista = historial
      .filter(b => !escrito || normalizarTexto(b.q).includes(escrito))
      .filter(b => normalizarTexto(b.q) !== escrito)
      .slice(0, 8);
    recientes.hidden = lista.length === 0 || !(cajaEnfocada || !zonaInicio.hidden);
    if (recientes.hidden) return;
    recientes.replaceChildren(
      el('h2', {
        className: 'buscar__recientes-titulo',
        attrs: { id: 'buscar-recientes-titulo' },
        text: t('buscar.recientes'),
      }),
      el('div', {
        className: 'buscar__recientes-lista',
        children: lista.map(b =>
          el('button', {
            className: 'cg-boton buscar__reciente',
            attrs: { type: 'button', title: t('buscar.recientes.repetir', { q: b.q }) },
            text: b.q,
            on: {
              click: () => {
                entrada.value = b.q;
                cajaEnfocada = false;
                entrada.blur();
                pintarInicio();
                empezar();
              },
            },
          })
        ),
      }),
      escrito
        ? null
        : el('button', {
            className: 'cg-boton cg-boton--fantasma buscar__recientes-borrar',
            attrs: { type: 'button' },
            text: t('buscar.recientes.borrar'),
            on: {
              click: async () => {
                // Sin pregunta y con «Deshacer» (SU-UX-011): solo es historial.
                const antes = historial;
                await fetch('/api/buscar/historial', { method: 'DELETE' }).catch(() => {});
                pintarRecientes();
                window.cgAviso?.(t('buscar.recientes.borrado'), {
                  deshacer: async () => {
                    await fetch('/api/buscar/historial', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ busquedas: antes }),
                    }).catch(() => {});
                    pintarRecientes();
                  },
                });
              },
            },
          })
    );
  }
  entrada.addEventListener('focus', () => {
    cajaEnfocada = true;
    mostrarRecientes();
  });
  // En iPhone, tocar un botón de «Recientes» quita antes el foco de la caja (se esconde el
  // teclado): si la lista se ocultaba al momento, el toque caía en el vacío y no hacía nada.
  // Se espera un poco a ocultarla para que el toque llegue al botón.
  entrada.addEventListener('blur', () => {
    cajaEnfocada = false;
    setTimeout(() => {
      if (!cajaEnfocada) mostrarRecientes();
    }, 300);
  });
  entrada.addEventListener('input', () => mostrarRecientes());
  const zonaInicio = el('section', {
    className: 'buscar__inicio',
    children: [
      resumenInicio,
      el('div', {
        className: 'cs-fila-botones',
        children: [botonAgregar, botonVarias],
      }),
    ],
  });

  /*
   * Proxy de salida caído (la VPN de detrás no responde): aviso fijo arriba en vez de que cada
   * sitio tarde su tiempo máximo en dar «error». El servidor lo comprueba cada minuto; aquí se
   * pregunta al abrir, al buscar y mientras se mira la pantalla.
   */
  const avisoProxy = el('div', {
    className: 'cs-aviso-proxy',
    attrs: { role: 'alert', hidden: '' },
    children: [
      el('span', { className: 'cs-aviso-proxy__texto', text: t('proxy.caido') }),
      el('a', {
        className: 'cg-boton',
        attrs: { href: '#/ajustes/sistema' },
        text: t('proxy.revisar'),
      }),
    ],
  });
  function pintarProxy(e) {
    // El motivo (rechazada, sin respuesta…) se ve en Ajustes → Sistema: aquí, corto.
    avisoProxy.hidden = !(e && e.configurado && e.ok === false);
  }
  async function comprobarProxy() {
    try {
      pintarProxy(await fetch('/api/ajustes/proxy').then(x => x.json()));
    } catch {
      // sin respuesta del servidor: ya lo dirá la propia búsqueda
    }
  }

  // Otras búsquedas en marcha (la cola entera está en Actividad).
  const otras = el('a', { className: 'buscar__otras', attrs: { href: '#/actividad', hidden: '' } });

  /* ── Resultados ─────────────────────────────────────────────────── */
  // Una sola fila con la marca de cada sitio: recuento y estado (⏳ buscando, ⚠ error). Sustituye
  // a la lista de progreso + las pestañas por sitio de antes.
  const marcasSitios = document.createElement('cg-chips');
  marcasSitios.setAttribute('unico', '');
  marcasSitios.className = 'buscar__pestanas';
  // «Filtros (N)», junto a la caja: N cuenta lo activo de las dos partes de la hoja.
  const pintarBotonFiltros = () => {
    const n = filtrosActivos().length + queBuscarActivo().length;
    const hijos = [icono('filtros'), el('span', { text: t('buscar.filtros') })];
    if (n) hijos.push(el('span', { className: 'buscar__cuenta-filtros', text: n }));
    botonFiltros.replaceChildren(...hijos);
    botonFiltros.setAttribute(
      'aria-label',
      n ? `${t('buscar.filtros')} (${n})` : t('buscar.filtros')
    );
  };
  marcasSitios.addEventListener('cg-cambiado', e => {
    const id = e.detail?.chip?.dataset.sitio;
    if (id === undefined) return;
    pestana = id === 'todos' ? 'todos' : Number(id);
    pintarResultados();
  });
  // Filtros activos, cada uno con su ✕ (solo si hay alguno).
  const marcasFiltros = el('div', { className: 'buscar__marcas', attrs: { hidden: '' } });
  const lineaEstado = el('div', { className: 'buscar__estado' });
  const estadoGiro = el('span', { className: 'buscar__girando', attrs: { 'aria-hidden': 'true' } });
  // CS-18: el texto de estado cambia con cada tanda (cada 80 ms); con `aria-live` un lector de
  // pantalla lo recitaba sin parar. Ahora se anuncia aparte, solo cuando cambia la fase
  // (en cola, buscando, terminada, parada).
  const estadoTexto = el('span');
  const anuncioEstado = el('span', {
    className: 'visually-hidden',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  let ultimoAnuncio = '';
  const contadorBoton = alPulsar =>
    el('button', {
      className: 'buscar__contador',
      attrs: { type: 'button', hidden: '' },
      on: { click: alPulsar },
    });
  const cuentaTengo = contadorBoton(() => {
    filtroTengo.checked = false;
    ocultarTengo = false;
    pintarResultados();
  });
  const cuentaEnviados = contadorBoton(() => {
    filtroEnviados.checked = false;
    ocultarEnviados = false;
    pintarResultados();
  });
  const cuentaDescartados = contadorBoton(() => {
    descartados.clear();
    pintarResultados();
  });
  const botonParar = el('button', {
    className: 'cg-boton cg-boton--fantasma buscar__parar',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => pararBusqueda() },
  });
  // «Recoger» (CS-N1), a la derecha de la línea de estado: a mano en cuanto hay resultados.
  const botonRecoger = el('button', {
    className: 'cg-boton buscar__recoger',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => abrirRecogerHoja() },
  });
  texto(botonRecoger, 'recoger.boton');
  // Fase 7 (FO-1): «Fotos», los álbumes de lo buscado. Solo si algún sitio tiene álbumes o hay
  // búsqueda web; el módulo se carga al abrirlo.
  const botonFotos = el('button', {
    className: 'cg-boton buscar__fotos',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => abrirFotosHoja() },
  });
  texto(botonFotos, 'fotos.boton');
  // CS-UX-009: la vista de los resultados (grandes o lista) junto a ellos, no en Filtros.
  const botonVista = el('button', {
    className: 'cg-boton cg-boton--fantasma cg-boton--icono buscar__vista',
    attrs: { type: 'button' },
    on: {
      click: () => {
        compacta.checked = !compacta.checked;
        compacta.dispatchEvent(new Event('change'));
        pintarBotonVista();
      },
    },
  });
  function pintarBotonVista() {
    botonVista.replaceChildren(icono(compacta.checked ? 'rejilla' : 'lista'));
    const txt = t(compacta.checked ? 'buscar.vista.grande' : 'buscar.vista.compacta');
    botonVista.setAttribute('aria-label', txt);
    botonVista.title = txt;
  }
  pintarBotonVista();
  let hayFotos = false;
  fase7
    .fotosDisponible()
    .then(r => {
      hayFotos = Boolean(r.sitios?.length || r.web);
      pintarResultados();
    })
    .catch(() => {});
  lineaEstado.append(
    el('button', {
      className: 'buscar__estado-texto',
      attrs: { type: 'button', 'aria-haspopup': 'dialog' },
      children: [estadoGiro, estadoTexto, anuncioEstado],
      on: { click: () => abrirProgreso() },
    }),
    cuentaTengo,
    cuentaEnviados,
    cuentaDescartados,
    botonParar,
    botonRecoger,
    botonFotos,
    botonVista
  );
  const zonaSugeridos = el('div', { className: 'buscar__sugeridos', attrs: { hidden: '' } });
  const rejilla = el('div', {
    className: 'buscar__rejilla',
    attrs: { role: 'listbox', 'aria-multiselectable': 'true' },
  });
  /** Grande (por defecto: dos por fila en el móvil) o lista compacta, según la casilla. */
  function aplicarVista() {
    rejilla.classList.toggle('buscar__rejilla--grande', !compacta.checked);
  }
  aplicarVista();
  const vacio = el('div', { className: 'buscar__vacio cs-vacio' });
  // «Descargar todo» y la carpeta, abajo (al alcance del pulgar), encima de la barra.
  const pieAccion = el('div', { className: 'buscar__pie-accion', attrs: { hidden: '' } });
  const zonaResultados = el('section', {
    className: 'buscar__resultados',
    attrs: { hidden: '' },
    children: [
      el('div', { className: 'buscar__fila-marcas', children: [marcasSitios] }),
      marcasFiltros,
      lineaEstado,
      zonaSugeridos,
      vacio,
      rejilla,
      pieAccion,
    ],
  });

  // Barra de selección (sustituye a la de navegación mientras hay algo elegido).
  const barraSeleccion = document.createElement('cg-barra-accion');
  barraSeleccion.className = 'buscar__barra-seleccion';
  const accionSel = (icono2, clave, fn) => {
    const b = el('button', { attrs: { type: 'button', 'data-icono': icono2 }, on: { click: fn } });
    texto(b, clave);
    return b;
  };
  const selDescargar = accionSel('descargar', 'buscar.sel.descargar', () => descargarSeleccion());
  const selTodos = accionSel('check', 'buscar.sel.todos', () => seleccionarTodos());
  const selQuitar = accionSel('cerrar', 'buscar.sel.quitar', () => quitarSeleccion());
  const selPrimeros = accionSel('lista', 'buscar.sel.primeros', () => elegirPrimeros());
  // CS-N10: copiar o exportar los enlaces elegidos. cg-ui no tiene icono de copiar: se pone aquí
  // el SVG con la misma clase (cg-ui no añade el suyo si el botón ya lleva uno).
  const selCopiar = accionSel('copiar', 'buscar.sel.copiar', () => copiarSeleccion());
  {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'cg-icono');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const hoja = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x: 8, y: 8, width: 12, height: 12, rx: 2 })) {
      hoja.setAttribute(k, String(v));
    }
    const detras = document.createElementNS(ns, 'path');
    detras.setAttribute(
      'd',
      'M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8'
    );
    svg.append(hoja, detras);
    selCopiar.prepend(svg);
  }
  barraSeleccion.append(selDescargar, selTodos, selPrimeros, selCopiar, selQuitar);

  root.append(
    cabecera,
    el('div', {
      className: 'buscar',
      children: [avisoProxy, recientes, otras, zonaInicio, zonaResultados],
    }),
    barraSeleccion
  );

  /* ── Repetidos y filtros de la lista ─────────────────────────────────── */
  // url → { representante, n }: copias del mismo vídeo (mismo o distinto sitio). Se pliegan bajo
  // el primero, como en el Explorador; nunca se borra nada.
  let copias = new Map();
  let ocultarRepetidos = true;
  let ocultarTengo = true; // CS-41: lo que ya está en la biblioteca, fuera por defecto
  let ocultarEnviados = true; // CS-N7: lo ya mandado a JDownloader, también
  let minDuracion = 0; // minutos; 0 = cualquiera
  // Filtros de texto e idioma. Deciden qué se MUESTRA de lo encontrado, nunca qué se busca: lo
  // oculto se cuenta y se puede ver («Ver ocultos»).
  let contener = []; // alguna de estas frases (ya normalizadas)
  let excluir = []; // ninguna de estas
  let idiomaFiltro = ''; // '' = cualquiera; un resultado «dudoso» no se oculta nunca
  let verOcultos = false;
  let soloFrase = false; // «frase exacta»: oculta (con contador) lo que no la lleva seguida
  let orden = 'llegada'; // 'llegada' | 'relevancia' | 'duracion'
  const textoNormal = crearTextoNormal(); // resultado → texto normalizado (una vez)
  const descartados = new Set(); // fichas quitadas a mano de esta búsqueda

  /**
   * ¿Hay un fichero de vídeo que reproducir, distinto de la ficha? Las listas HLS (.m3u8) y sus
   * trozos (.ts) no los abre un <video> por sí solos: esos se ven con «Abrir».
   */
  const archivoReproducible = r =>
    typeof r.url === 'string' &&
    /^https?:\/\//i.test(r.url) &&
    r.url !== (r.sourceUrl || '') &&
    !/\.(m3u8|ts)(\?|$)/i.test(r.url);

  let destinoFijo = null; // null = preguntar al descargar; string = carpeta (''= la de por defecto)
  let reglaFija = null; // si la carpeta fija es nueva: qué persona/categoría/etiqueta lleva
  // La carpeta la puso la app sola (§5.5) porque lo buscado coincide con una carpeta o persona:
  // la siguiente búsqueda la puede cambiar por otra; una elegida a mano, no.
  let destinoPropuesto = false;

  // Repetido = el mismo vídeo o una copia que detecta el servidor (ver buscarModelo.js).
  const clavePagina = r => r.url;
  let cuentaPagina = new Map(); // resultados por página, para el «+N» de cada fila
  const enPestana = r =>
    (pestana === 'todos' || r.sitio === pestana) && !descartados.has(enlaceDe(r));
  /**
   * Álbumes: una ficha con varios ficheros llegaba como varios resultados sueltos. Se pliegan en
   * uno (el primero que pasa los filtros, que se aplican POR FICHERO: así la duración mínima mira
   * cada vídeo, no el álbum) con su contador, y se despliegan a mano. Plegar es una vista: nada
   * se quita, y descargar el álbum manda la ficha, que JDownloader ya abre entera.
   */
  const albumesAbiertos = new Set(); // fichas desplegadas
  let albumes = new Map(); // ficha → miembros visibles (los de la última lista pintada)
  /** Lo que se ve de lo encontrado, en una sola pasada (CS-14; la lógica, en buscarModelo.js). */
  function calcular() {
    const pasada = calcularLista(resultados, {
      orden,
      enPestana,
      ocultarRepetidos,
      copias,
      albumesAbiertos,
      verOcultos,
      filtros: {
        ocultarTengo,
        ocultarEnviados,
        enBiblioteca,
        enviados,
        contener,
        excluir,
        soloFrase,
        idioma: idiomaFiltro,
        minDuracion,
        textoNormal,
      },
    });
    albumes = pasada.albumes;
    return pasada;
  }
  let ultimaPasada = null;
  const visibles = () => (ultimaPasada || calcular()).lista;

  const jd = createJdEnvio({ visibles: () => visibles().map(enlaceDe) });
  // La misma página (un álbum con varios vídeos) se manda una sola vez: JDownloader ya la abre entera.
  async function descargar(links) {
    const titulo = new Map(resultados.map(r => [enlaceDe(r), r.title || '']));
    const duracionDe = new Map(resultados.map(r => [enlaceDe(r), r.durationSeconds ?? null]));
    const unicos = [...new Set(links)];
    return descargarCon(unicos, {
      ...(destinoFijo === null ? {} : { carpeta: destinoFijo, regla: reglaFija }),
      titulos: unicos.map(l => titulo.get(l) || ''),
      duraciones: unicos.map(l => duracionDe.get(l) ?? null),
    });
  }
  /** Manda con carpeta, regla y títulos dados (también «Recoger») y lo apunta como enviado. */
  async function descargarCon(links, opciones) {
    const unicos = [...new Set(links)];
    if (!unicos.length) return null;
    // NU-1: lo buscado viaja para que el servidor sepa qué personas van (C2).
    const r = await jd.enviar(unicos, { termino: ultimaBusqueda, ...opciones });
    if (r) {
      // Memoria de lo enviado: desde ya salen ocultos (con su contador) y fuera de «todo».
      const ahora = Date.now();
      for (const l of unicos) enviados.set(l, ahora);
      pintarResultados();
    }
    return r;
  }

  /* ── Filtros (hoja) ─────────────────────────────────────────────── */
  const campoFiltro = (clave, alCambiar) => {
    const input = el('input', {
      className: 'input buscar__filtro',
      attrs: { type: 'search', autocomplete: 'off', spellcheck: 'false' },
    });
    atributo(input, 'placeholder', `${clave}.ej`);
    input.addEventListener('input', () => {
      alCambiar(palabras(input.value));
      pintarResultados();
    });
    return input;
  };
  const filtroContener = campoFiltro('buscar.filtro.contener', v => (contener = v));
  const filtroExcluir = campoFiltro('buscar.filtro.excluir', v => (excluir = v));
  const duracion = el('select', { className: 'input' });
  duracion.addEventListener('change', () => {
    minDuracion = Number(duracion.value);
    pintarResultados();
  });
  const idioma = el('select', { className: 'input' });
  idioma.addEventListener('change', () => {
    idiomaFiltro = idioma.value;
    pintarResultados();
  });
  const selectOrden = el('select', { className: 'input' });
  selectOrden.addEventListener('change', () => {
    orden = selectOrden.value;
    pintarResultados();
  });
  const casillaFiltro = (inicial, alCambiar) => {
    const c = el('input', { attrs: { type: 'checkbox' } });
    c.checked = inicial;
    c.addEventListener('change', () => {
      alCambiar(c.checked);
      pintarResultados();
    });
    return c;
  };
  const frase = casillaFiltro(false, v => (soloFrase = v));
  const filtroRepetidos = casillaFiltro(true, v => (ocultarRepetidos = v));
  const filtroTengo = casillaFiltro(true, v => (ocultarTengo = v));
  const filtroEnviados = casillaFiltro(true, v => (ocultarEnviados = v));
  const filtroVerOcultos = casillaFiltro(false, v => (verOcultos = v));

  function pintarSelects() {
    const minActual = duracion.value || String(minDuracion);
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
    clear(idioma);
    for (const v of ['', 'es', 'en', 'pt', 'fr', 'de', 'it']) {
      idioma.append(
        el('option', {
          attrs: { value: v },
          text: t(v ? `buscar.idioma.${v}` : 'buscar.idioma.cualquiera'),
        })
      );
    }
    idioma.value = idiomaFiltro;
    clear(selectOrden);
    for (const v of ['llegada', 'relevancia', 'duracion']) {
      selectOrden.append(el('option', { attrs: { value: v }, text: t(`buscar.orden.${v}`) }));
    }
    selectOrden.value = orden;
  }

  let hojaFiltros = null;
  let verN = null;
  function abrirFiltros() {
    const campo = (clave, control, ayuda) =>
      el('label', {
        className: 'field',
        attrs: ayuda ? { title: t(ayuda) } : {},
        children: [el('span', { className: 'field__label', text: t(clave) }), control],
      });
    verN = el('button', {
      className: 'cg-boton cg-boton--principal',
      attrs: { type: 'button' },
      on: { click: () => hojaFiltros?.cerrar() },
    });
    const limpiar = el('button', {
      className: 'cg-boton',
      attrs: { type: 'button' },
      text: t('buscar.filtros.limpiar'),
      on: { click: () => limpiarFiltros() },
    });
    let hoja = null;
    const cerrarla = { cerrar: () => hoja?.cerrar() };
    hojaFiltros = hoja = abrirHoja({
      titulo: t('buscar.filtros'),
      clase: 'buscar__hoja-filtros',
      contenido: [
        ...parteQueBuscar(cerrarla),
        el('h3', { className: 'cs-hoja-titulo', text: t('buscar.parte.filtrar') }),
        campo('buscar.orden', selectOrden),
        campo('buscar.filtro.contener', filtroContener),
        campo('buscar.filtro.excluir', filtroExcluir),
        campo('buscar.duracion', duracion),
        campo('buscar.idioma', idioma, 'buscar.idioma.titulo'),
        casilla(frase, 'buscar.frase', 'buscar.frase.titulo'),
        casilla(filtroRepetidos, 'buscar.ocultarRepetidos'),
        casilla(filtroTengo, 'buscar.ocultarTengo', 'buscar.ocultarTengo.detalle'),
        casilla(filtroEnviados, 'buscar.ocultarEnviados'),
        casilla(filtroVerOcultos, 'buscar.ocultos.ver'),
        el('div', {
          className: 'cs-fila-botones',
          children: [
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button', title: t('video.yaLoTengo.titulo') },
              text: t('video.yaLoTengo'),
              on: { click: () => comprobarBiblioteca(true) },
            }),
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('buscar.programar'),
              on: {
                click: () => {
                  hojaFiltros.cerrar();
                  programar();
                },
              },
            }),
          ],
        }),
      ],
      pie: [limpiar, verN],
    });
    hojaFiltros.addEventListener(
      'cg-cerrar',
      () => {
        hojaFiltros = null;
        verN = null;
        pintarInicio();
        pintarResultados();
      },
      { once: true }
    );
    pintarVerN();
    pintarResultados();
  }
  /** El botón principal del pie: «Ver N» con resultados; «Listo» antes de buscar. */
  function pintarVerN() {
    if (verN && zonaResultados.hidden) verN.textContent = t('buscar.filtros.listo');
  }

  /** Los filtros activos (lo que difiere de lo de fábrica), para las marcas y el «Filtros (N)». */
  function filtrosActivos() {
    const a = [];
    if (contener.length) {
      a.push({
        texto: t('buscar.marca.contener', { v: contener.join(', ') }),
        quitar: () => {
          filtroContener.value = '';
          contener = [];
        },
      });
    }
    if (excluir.length) {
      a.push({
        texto: t('buscar.marca.excluir', { v: excluir.join(', ') }),
        quitar: () => {
          filtroExcluir.value = '';
          excluir = [];
        },
      });
    }
    if (minDuracion) {
      a.push({
        texto: t('buscar.marca.duracion', { n: minDuracion }),
        quitar: () => {
          duracion.value = '0';
          minDuracion = 0;
        },
      });
    }
    if (idiomaFiltro) {
      a.push({
        texto: t(`buscar.idioma.${idiomaFiltro}`),
        quitar: () => {
          idioma.value = '';
          idiomaFiltro = '';
        },
      });
    }
    if (soloFrase) {
      a.push({
        texto: t('buscar.frase'),
        quitar: () => {
          frase.checked = false;
          soloFrase = false;
        },
      });
    }
    if (!ocultarRepetidos) {
      a.push({
        texto: t('buscar.marca.repetidos'),
        quitar: () => {
          filtroRepetidos.checked = true;
          ocultarRepetidos = true;
        },
      });
    }
    if (!ocultarTengo) {
      a.push({
        texto: t('buscar.marca.tengo'),
        quitar: () => {
          filtroTengo.checked = true;
          ocultarTengo = true;
        },
      });
    }
    if (!ocultarEnviados) {
      a.push({
        texto: t('buscar.marca.enviados'),
        quitar: () => {
          filtroEnviados.checked = true;
          ocultarEnviados = true;
        },
      });
    }
    if (verOcultos) {
      a.push({
        texto: t('buscar.ocultos.ver'),
        quitar: () => {
          filtroVerOcultos.checked = false;
          verOcultos = false;
        },
      });
    }
    return a;
  }
  function limpiarFiltros() {
    for (const f of filtrosActivos()) f.quitar();
    pintarInicio();
    pintarResultados();
  }

  /** «Repetir cada…»: una programada con lo de esta búsqueda ya puesto (en Actividad). */
  function programar() {
    window.dispatchEvent(
      new CustomEvent('clipscout:programar', {
        detail: {
          termino: ultimaBusqueda || entrada.value.trim(),
          carpeta: destinoFijo || '',
          contener: filtroContener.value,
          excluir: filtroExcluir.value,
          minutosMinimo: minDuracion,
        },
      })
    );
  }

  /* ── «Descargar en» y «Descargar todo» ──────────────────────────── */
  // Un botón que abre la ventana de carpeta (qué es → nombre), no un desplegable.
  const destino = el('button', {
    className: 'cg-boton buscar__destino',
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
        destinoPropuesto = false;
        pintarDestinos();
      },
    },
  });
  function pintarDestinos() {
    const nombre =
      destinoFijo === null
        ? t('buscar.destino.preguntar')
        : destinoFijo || t('video.jd.porDefecto');
    // Dos líneas: «Descargar en» pequeño y la carpeta entera debajo (antes salía «Pregun…»).
    destino.replaceChildren(
      icono('carpeta'),
      el('span', {
        className: 'buscar__destino-texto',
        children: [
          el('small', {
            text: t(destinoPropuesto ? 'buscar.destino.propuesta' : 'buscar.destino'),
          }),
          el('span', { text: nombre }),
        ],
      })
    );
    destino.title = `${t('buscar.destino')}: ${nombre}`;
    destino.setAttribute('aria-label', destino.title);
  }

  /** Al buscar un nombre: si coincide con una carpeta o persona del catálogo, se propone sola. */
  function proponerCarpeta(q) {
    if (destinoFijo !== null && !destinoPropuesto) return; // elegida a mano: manda
    const p = carpetaPropuesta(q, {
      existentes: (jd.destinos() || []).map(d => d.carpeta),
      catalogo: jd.catalogo(),
      personas: jd.personas(),
    });
    if (p) {
      destinoFijo = p.carpeta;
      reglaFija = p.regla;
      destinoPropuesto = true;
    } else if (destinoPropuesto) {
      destinoFijo = null;
      reglaFija = null;
      destinoPropuesto = false;
    }
    pintarDestinos();
  }
  const descargarTodo = el('button', {
    className: 'cg-boton cg-boton--principal buscar__descargar-todo',
    attrs: { type: 'button' },
    on: {
      click: () => descargar(paraDescargarTodo(visibles(), { tengo: enBiblioteca, enviados })),
    },
  });
  /*
   * «Recoger» (CS-N1): de lo encontrado, los N que llevan el nombre, que no tengo y los más
   * largos, con la propuesta a la vista y un solo botón. El módulo se carga al abrirlo.
   */
  async function abrirRecogerHoja() {
    const id = trabajoVisto || trabajo;
    if (!id) return;
    const { abrirRecoger } = await import('./recoger.js');
    abrirRecoger({
      busqueda: id,
      nombre: ultimaBusqueda || entrada.value.trim(),
      minDuracion,
      destino: () => ({ carpeta: destinoFijo, regla: reglaFija }),
      elegirCarpeta: () => jd.elegirCarpeta(),
      enviar: (links, opciones) => descargarCon(links, opciones),
      jdConfigurado: jd.configurado(),
    });
  }
  /** FO-1…FO-5: la hoja de álbumes de lo buscado y «Mandar a una persona». */
  async function abrirFotosHoja() {
    const q = ultimaBusqueda || entrada.value.trim();
    if (!q) return;
    const { abrirFotos } = await import('./fotos.js');
    abrirFotos({ q, jdConfigurado: jd.configurado() });
  }
  pieAccion.append(destino, descargarTodo);
  jd.alCargar(() => {
    pintarDestinos();
    pintarResultados();
  });

  /* ── Selección múltiple (CS-40) ──────────────────────────────────── */
  const seleccion = window.cgSeleccion
    ? window.cgSeleccion(rejilla, {
        item: '.buscar__tarjeta',
        lista: true,
        clave: n => n.dataset.id,
        alCambiar: claves => {
          barraSeleccion.cuenta = claves.length;
          pintarCasillas();
        },
      })
    : null;
  barraSeleccion.addEventListener('cg-cancelar', e => {
    e.preventDefault();
    seleccion?.limpiar();
  });
  function pintarCasillas() {
    const elegidas = new Set(seleccion?.claves || []);
    for (const c of rejilla.querySelectorAll('.buscar__casilla')) {
      c.setAttribute(
        'aria-checked',
        String(elegidas.has(c.closest('.buscar__tarjeta').dataset.id))
      );
    }
    selDescargar.hidden = !jd.configurado();
  }
  async function descargarSeleccion() {
    const r = await descargar(seleccion?.claves || []);
    if (r) seleccion.limpiar();
  }
  function seleccionarTodos() {
    // Todos los de la lista filtrada, no solo los que se ven en pantalla.
    seleccion?.poner(visibles().map(enlaceDe));
  }
  /** «Los N primeros» de la lista tal como se ve (filtros y orden incluidos). */
  function elegirPrimeros() {
    const lista = visibles().map(enlaceDe);
    const tamanos = tamanosPrimeros(lista.length);
    menuAcciones({
      titulo: t('buscar.sel.primeros.titulo'),
      subtitulo: tp('buscar.resultados', lista.length),
      acciones: tamanos.map(n => ({
        texto: t('buscar.sel.primeros.n', { n }),
        fn: () => seleccion?.poner(lista.slice(0, n)),
      })),
    });
  }
  /** CS-N10: los elegidos al portapapeles (uno por línea) o a un fichero .txt / .csv. */
  function copiarSeleccion() {
    const claves = seleccion?.claves || [];
    if (!claves.length) return;
    const porEnlace = new Map(resultados.map(r => [enlaceDe(r), r]));
    const filas = claves.map(l => porEnlace.get(l) || { url: l });
    const nombre = `clipscout-${(ultimaBusqueda || 'enlaces').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`;
    const bajar = (texto, tipo, ext) => {
      const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
      const a = el('a', { attrs: { href: url, download: `${nombre}.${ext}` } });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    menuAcciones({
      titulo: t('buscar.copiar.titulo'),
      subtitulo: tp('buscar.resultados', claves.length),
      acciones: [
        {
          texto: t('buscar.copiar.portapapeles'),
          fn: async () => {
            const ok = await copyToClipboard(claves.join('\n'));
            toast(ok ? tp('buscar.copiar.copiados', claves.length) : t('resultados.noCopiado'));
          },
        },
        {
          texto: t('buscar.copiar.txt'),
          fn: () => bajar(`${claves.join('\n')}\n`, 'text/plain;charset=utf-8', 'txt'),
        },
        {
          texto: t('buscar.copiar.csv'),
          // El módulo de exportar solo se pide al usarlo (no entra en la carga inicial).
          fn: async () => {
            const { csvDeResultados } = await import('../exportFormats.js');
            bajar(csvDeResultados(filas), 'text/csv;charset=utf-8', 'csv');
          },
        },
      ],
    });
  }
  function quitarSeleccion() {
    const quitar = seleccion?.claves || [];
    quitarDeLaLista(quitar);
    seleccion.limpiar();
  }
  /** Quitar de la lista es reversible: sin pregunta, con «Deshacer». */
  function quitarDeLaLista(enlaces) {
    if (!enlaces.length) return;
    for (const e of enlaces) descartados.add(e);
    pintarResultados();
    const aviso = window.cgAviso
      ? window.cgAviso(tp('buscar.quitados', enlaces.length), {
          deshacer: () => {
            for (const e of enlaces) descartados.delete(e);
            pintarResultados();
          },
        })
      : null;
    return aviso;
  }

  /*
   * Deslizar una fila (§5.5): hacia la izquierda la quita de la lista (con «Deshacer»), hacia la
   * derecha la manda a descargar (si hay JDownloader). Solo con el dedo y fuera del modo selección;
   * `touch-action: pan-y` en las filas deja el desplazamiento vertical al navegador, así que aquí
   * no se bloquea nada (escuchas pasivas) y no cambia cómo se desplaza la lista.
   */
  const UMBRAL_DESLIZAR = 96;
  let gesto = null;
  let anularClic = false;
  const soltarFila = fila => {
    fila.classList.remove('buscar__tarjeta--deslizando');
    fila.removeAttribute('data-deslizar');
    fila.style.transform = '';
  };
  rejilla.addEventListener(
    'touchstart',
    e => {
      gesto = null;
      if (e.touches.length !== 1 || seleccion?.modo) return;
      const fila = e.target.closest('.buscar__tarjeta');
      if (!fila || e.target.closest('.buscar__casilla, .buscar__mas, video')) return;
      gesto = { fila, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, eje: null };
    },
    { passive: true }
  );
  rejilla.addEventListener(
    'touchmove',
    e => {
      if (!gesto || seleccion?.modo) return;
      const dx = e.touches[0].clientX - gesto.x;
      const dy = e.touches[0].clientY - gesto.y;
      if (!gesto.eje) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        gesto.eje = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
        if (gesto.eje === 'x') gesto.fila.classList.add('buscar__tarjeta--deslizando');
      }
      if (gesto.eje !== 'x') return;
      // Sin JDownloader no hay «descargar»: a la derecha no pasa del umbral.
      gesto.dx = dx > 0 && !jd.configurado() ? Math.min(dx, UMBRAL_DESLIZAR / 2) : dx;
      gesto.fila.style.transform = `translateX(${gesto.dx}px)`;
      const accion =
        gesto.dx <= -UMBRAL_DESLIZAR ? 'quitar' : gesto.dx >= UMBRAL_DESLIZAR ? 'descargar' : '';
      if (accion) {
        gesto.fila.dataset.deslizar = accion;
        gesto.fila.dataset.textoDeslizar = t(`buscar.deslizar.${accion}`);
      } else gesto.fila.removeAttribute('data-deslizar');
    },
    { passive: true }
  );
  const acabarGesto = cancelado => {
    const g = gesto;
    gesto = null;
    if (!g || g.eje !== 'x') return;
    anularClic = true;
    setTimeout(() => (anularClic = false), 400);
    const accion = cancelado ? '' : g.fila.dataset.deslizar || '';
    soltarFila(g.fila);
    const enlace = g.fila.dataset.id;
    if (accion === 'quitar') quitarDeLaLista([enlace]);
    else if (accion === 'descargar') descargar([enlace]);
  };
  rejilla.addEventListener('touchend', () => acabarGesto(false), { passive: true });
  rejilla.addEventListener('touchcancel', () => acabarGesto(true), { passive: true });
  // Tras deslizar, el «clic» que manda el navegador al soltar no abre la ficha.
  rejilla.addEventListener(
    'click',
    e => {
      if (!anularClic) return;
      anularClic = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  /* ── Sitios ─────────────────────────────────────────────────────── */
  function textoAyudaSitios() {
    const activos = sitios.filter(s => !apagados.has(s.nombre));
    return sitios.length === 0
      ? t('buscar.sinSitios')
      : activos.length === sitios.length
        ? t('buscar.ayuda.todos', { n: sitios.length })
        : tp('buscar.ayuda.algunos', activos.length);
  }
  function pintarSitios() {
    clear(chipsSitios);
    const activos = sitios.filter(s => !apagados.has(s.nombre));
    const chip = (textoChip, on, fn) =>
      el('button', {
        className: `buscar__chip${on ? ' buscar__chip--on' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(on) },
        text: textoChip,
        on: { click: fn },
      });
    chipsSitios.append(
      chip(t('buscar.todos'), activos.length === sitios.length, () => {
        apagados.clear();
        guardarApagados(apagados);
        pintarSitios();
      })
    );
    for (const s of sitios) {
      const on = !apagados.has(s.nombre);
      chipsSitios.append(
        chip(s.nombre, on, () => {
          // Con todos encendidos, tocar uno = buscar SOLO en ese (lo habitual al querer ir a uno).
          if (activos.length === sitios.length) {
            for (const x of sitios) if (x.id !== s.id) apagados.add(x.nombre);
          } else if (on) apagados.add(s.nombre);
          else apagados.delete(s.nombre);
          if (sitios.every(x => apagados.has(x.nombre))) apagados.clear();
          guardarApagados(apagados);
          pintarSitios();
        })
      );
    }
    const nota = chipsSitios.parentElement?.querySelector(':scope > .cs-nota');
    if (nota) nota.textContent = textoAyudaSitios();
    pintarBotonFiltros();
  }

  /** Antes de buscar: a cuántos sitios irá y con cuántas páginas; o el primer paso si no hay. */
  function pintarInicio() {
    const enlace = tipoDeEntrada(entrada.value) === 'enlace';
    boton.setAttribute('aria-label', t(enlace ? 'buscar.boton.enlace' : 'buscar.boton'));
    boton.title = boton.getAttribute('aria-label');
    const activos = sitios.filter(s => !apagados.has(s.nombre));
    if (enlace) resumenInicio.textContent = t('buscar.ayuda.enlace');
    else if (sitios.length === 0) resumenInicio.textContent = t('buscar.sinSitios');
    else {
      resumenInicio.textContent = t('buscar.resumenInicio', {
        activos: activos.length,
        total: sitios.length,
        paginas: paginas.value,
      });
    }
    pintarBotonFiltros();
    botonAgregar.textContent = t('buscar.agregarSitios');
    botonAgregar.className = sitios.length === 0 ? 'button' : 'cg-boton';
    botonVarias.textContent = t('buscar.varias');
    // CS-UX-007: con sitios, los dos ya están en la hoja Filtros; en el inicio solo sin ninguno.
    botonAgregar.hidden = sitios.length > 0;
    botonVarias.hidden = true;
  }
  entrada.addEventListener('input', pintarInicio);

  /** Los marcados en Ajustes como «no buscar por defecto» salen apagados la primera vez. */
  function aplicarFueraPorDefecto() {
    let aplicados;
    try {
      aplicados = new Set(JSON.parse(leer(CLAVE_FUERA, '[]')));
    } catch {
      aplicados = new Set();
    }
    const nuevos = sitios.filter(s => s.porDefecto === false && !aplicados.has(s.nombre));
    if (nuevos.length === 0) return;
    for (const s of nuevos) {
      apagados.add(s.nombre);
      aplicados.add(s.nombre);
    }
    guardarApagados(apagados);
    guardar(CLAVE_FUERA, JSON.stringify([...aplicados]));
  }

  async function cargarSitios() {
    try {
      const r = await fetch('/api/buscar/sitios').then(x => x.json());
      sitios = r.sitios || [];
      hayWeb = Boolean(r.web);
      aplicarFueraPorDefecto();
    } catch {
      sitios = [];
    }
    pintarSitios();
    pintarInicio();
  }

  /* ── Búsqueda ───────────────────────────────────────────────────── */
  /** Para la búsqueda EN EL SERVIDOR (cerrar la página ya no la para). */
  async function pararBusqueda() {
    // Parada AL INSTANTE en la pantalla, aunque el servidor tarde unos segundos en cortar las
    // peticiones en vuelo (un sitio que no responde puede tardar su tope entero).
    const id = trabajo || trabajoVisto;
    parada = true;
    terminar(true);
    if (id) {
      await fetch(`/api/buscar/trabajos/${id}/parar`, { method: 'POST' }).catch(() => {});
    }
  }

  /**
   * Repintado agrupado: como mucho uno cada 80 ms. Al darle a «Ver» a una búsqueda llegan de golpe
   * todos sus eventos (800 en una búsqueda grande) y repintar con cada uno colgaba el navegador.
   */
  let relojPintado = null;
  function pintarPronto() {
    if (relojPintado) return;
    relojPintado = setTimeout(() => {
      relojPintado = null;
      pintarResultados();
    }, 80);
  }

  function soltar() {
    clearTimeout(reintento);
    reintento = null;
    clearTimeout(relojPintado); // quien suelta pinta él mismo (terminar) o cambia de búsqueda
    relojPintado = null;
    fuente?.close();
    fuente = null;
  }

  function terminar(cancelado = false) {
    soltar();
    trabajo = null;
    if (cancelado) {
      for (const [id, e] of estado) {
        if (e.fase === 'espera' || e.fase === 'busca') estado.set(id, { ...e, fase: 'fin' });
      }
    }
    pintarResultados();
    comprobarBiblioteca(false);
    comprobarEnviados();
  }

  /** Vacía lo de la búsqueda anterior antes de mirar otra. */
  function reiniciar() {
    resultados = [];
    estado = new Map();
    descartados.clear();
    copias = new Map();
    enBiblioteca = new Map();
    enviados = new Map();
    sugeridos = [];
    pestana = 'todos';
    enCola = null;
    parada = false;
    filas.clear();
    seleccion?.limpiar();
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
    const web = !esEnlace && hayWeb && conWeb.checked;
    const conAbierta = !esEnlace && hayWeb && abierta.checked;
    const elegidos = esEnlace ? [] : sitios.filter(s => !apagados.has(s.nombre));
    if (!esEnlace && elegidos.length === 0 && !conAbierta) {
      // Antes no hacía nada ni avisaba (CS-18).
      toast(sitios.length ? t('buscar.ningunSitio') : t('buscar.sinSitios'), 'error', 6000);
      if (!sitios.length) abrirAlta({ termino: q });
      return;
    }
    fuente?.close();
    reiniciar();
    estado = new Map(elegidos.map(s => [s.id, { fase: 'espera', total: 0 }]));
    if (conAbierta) estado.set(ID_WEB, { fase: 'espera', total: 0 });
    if (!opciones.listado) listados = new Map();
    ultimaBusqueda = q;
    if (!esEnlace) proponerCarpeta(q);
    mostrarResultados();

    const query = new URLSearchParams(
      esEnlace ? { url: q, paginas: paginas.value } : { q, paginas: paginas.value }
    );
    if (opciones.listado) query.set('listado', '1');
    if (web) query.set('web', '1');
    if (conAbierta) query.set('abierta', '1');
    if (destinoPropuesto && destinoFijo) query.set('carpeta', destinoFijo);
    // Siempre la lista: sin ella el servidor se salta los «no buscar por defecto», y aquí lo que
    // manda es lo que está encendido.
    if (!esEnlace && elegidos.length > 0) {
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
    pintarRecientes();
  }

  function mostrarResultados() {
    zonaResultados.hidden = false;
    zonaInicio.hidden = true;
    mostrarRecientes();
    pintarLimpiar();
  }

  function pintarLimpiar() {
    botonLimpiar.hidden = !entrada.value.trim() && zonaResultados.hidden;
  }
  entrada.addEventListener('input', pintarLimpiar);

  /** «Limpiar»: la pantalla vuelve al principio y el servidor olvida la última búsqueda. */
  function limpiarPantalla() {
    soltar();
    trabajo = null;
    trabajoVisto = null;
    entrada.value = '';
    ultimaBusqueda = '';
    reiniciar();
    listados = new Map();
    zonaResultados.hidden = true;
    zonaInicio.hidden = false;
    pintarInicio();
    pintarLimpiar();
    mostrarRecientes();
    fetch('/api/buscar/actual', { method: 'DELETE' }).catch(() => {});
    entrada.focus();
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

  async function encolarVarias(textoLineas) {
    const lineas = leerLineas(textoLineas);
    if (lineas.length === 0) return false;
    const elegidos = sitios.filter(x => !apagados.has(x.nombre));
    const hayPalabras = lineas.some(l => l.q);
    try {
      const resp = await fetch('/api/buscar/varias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busquedas: lineas,
          paginas: paginas.value,
          web: hayPalabras && hayWeb && conWeb.checked,
          abierta: hayPalabras && hayWeb && abierta.checked,
          ...(elegidos.length ? { sitios: elegidos.map(x => x.id) } : {}),
        }),
      });
      const r = await resp.json();
      if (r.ids?.length) toast(tp('buscar.varias.encoladas', r.ids.length), 'success', 4000);
      if (r.errores?.length) {
        toast(r.errores.map(e => `${e.q || '—'}: ${e.error}`).join(' · '), 'error', 8000);
      }
      if (!r.ids?.length) return false;
      // Si no se está mirando ninguna, se mira la primera de la tanda.
      if (!trabajo) await refrescarCola({ verId: r.ids[0] });
      else await refrescarCola();
      return true;
    } catch (error) {
      toast(error.message, 'error', 6000);
      return false;
    }
  }

  /** Solo para el aviso «N búsquedas más en marcha» (la cola entera está en Actividad). */
  async function refrescarCola({ verId = null } = {}) {
    let cola;
    try {
      cola = (await fetch('/api/buscar/cola').then(x => x.json())).busquedas || [];
    } catch {
      return;
    }
    const n = cola.filter(b => b.estado !== 'fin' && b.id !== trabajoVisto).length;
    otras.hidden = n === 0;
    otras.textContent = `${tp('buscar.otras', n)} · ${t('buscar.otras.ver')} ›`;
    if (verId) {
      const b = cola.find(x => x.id === verId);
      if (b) ver(b);
    }
  }
  // Solo mientras se mira Buscar (antes, cada 4 s aunque no hubiera nada, CS-18).
  let vueltasCola = 0;
  const relojCola = setInterval(() => {
    if (root.hidden || document.visibilityState === 'hidden') return;
    refrescarCola();
    // El proxy, cada minuto (el servidor lo prueba solo; aquí solo se lee su estado).
    vueltasCola = (vueltasCola + 1) % 12;
    if (vueltasCola === 0) comprobarProxy();
  }, 5000);

  /** Mirar otra búsqueda del servidor (desde Actividad o al reengancharse). */
  function ver(b) {
    entrada.value = b.q;
    ultimaBusqueda = b.q;
    reiniciar();
    listados = new Map();
    // La carpeta con la que se encoló pasa a ser el «Descargar en» de lo que encuentre.
    if (b.carpeta) {
      destinoFijo = b.carpeta;
      reglaFija = null;
      destinoPropuesto = false;
      pintarDestinos();
    }
    conectar(b.id, 0);
    pintarResultados();
  }
  window.addEventListener('clipscout:ver-busqueda', e => {
    if (e.detail) ver(e.detail);
  });

  /** Se suscribe a la búsqueda `id` del servidor desde el evento `desde`. */
  function conectar(id, desde) {
    soltar();
    trabajo = id;
    trabajoVisto = id;
    recibidos = desde;
    mostrarResultados();
    // Desde el principio, resumido (CS-12): lo ya encontrado llega de una vez, sin cada progreso.
    fuente = new EventSource(
      `/api/buscar/trabajos/${id}/stream?desde=${desde}${desde === 0 ? '&resumen=1' : ''}`
    );
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
      } else if (m.type === 'inicio' || m.type === 'reanudada') {
        enCola = null;
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
          error: m.error === 'proxy_caido' ? t('proxy.sitio') : m.error,
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
      } else if (m.type === 'proxy_caido') {
        pintarProxy({ configurado: true, ok: false, error: m.error });
      } else if (m.type === 'listado_disponible') {
        listados.set(m.sitio, m.url);
      } else if (m.type === 'sitios_sugeridos') {
        sugeridos = m.sugeridos || [];
      } else if (m.type === 'duplicados') {
        // Las parciales (mientras dura la búsqueda) traen solo los grupos nuevos o que crecieron.
        if (!m.parcial) copias = new Map();
        for (const g of m.grupos) {
          for (const u of g.miembros) {
            copias.set(u, { representante: g.representante, n: g.miembros.length });
          }
        }
      } else if (m.type === 'fin') {
        if (m.parada) parada = true;
        return terminar(Boolean(m.cancelada));
      } else if (m.type === 'error') {
        toast(m.message, 'error', 6000);
        return terminar();
      }
      pintarPronto();
    };
    // La conexión se cortó (otra app, la pantalla se apagó, la red): la búsqueda sigue en el
    // servidor, así que se vuelve a mirar desde el último evento visto.
    // Antes de reintentar se pregunta al servidor: si la sesión caducó, el 401 lleva a la pantalla
    // de acceso (CS-13) en vez de reintentar cada 3 s para siempre.
    fuente.onerror = () => {
      if (!fuente || trabajo !== id) return;
      fuente.close();
      fuente = null;
      clearTimeout(reintento);
      reintento = setTimeout(async () => {
        if (trabajo !== id) return;
        const r = await fetch('/api/buscar/actual').catch(() => null);
        if (r?.status === 401) return;
        if (trabajo === id) conectar(id, recibidos);
      }, 3000);
    };
  }

  /**
   * Pregunta a clipkeeper cuáles ya están en la biblioteca: por título, o por duración + la persona
   * buscada (los ficheros renombrados ya no llevan el título del sitio). Por tandas, para mirar la
   * lista entera.
   */
  async function comprobarBiblioteca(avisar) {
    const lista = resultados.filter(
      r => r.title || nombreDeUrl(r.url) || Number.isFinite(r.durationSeconds)
    );
    if (lista.length === 0) return;
    try {
      const persona = ultimaBusqueda || entrada.value.trim();
      const r = { conectado: true, error: null, resultados: [] };
      // Tandas de 50: 200 títulos con sus enlaces pasaban de los 64 KB que admite el servidor.
      for (let i = 0; i < lista.length; i += 50) {
        const tanda = lista.slice(i, i + 50);
        const parte = await ajustes.yaLoTengo(
          tanda.map(x => x.title || nombreDeUrl(x.url) || ''),
          tanda.map(x => (Number.isFinite(x.durationSeconds) ? x.durationSeconds : null)),
          persona,
          // Para el rendimiento por sitio: la comprobación automática al terminar cuenta (el
          // servidor la cuenta una sola vez por búsqueda); el botón, no.
          {
            enlaces: tanda.map(enlaceDe),
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
        if (res.coincidencias.length) enBiblioteca.set(enlaceDe(lista[i]), res.coincidencias[0]);
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

  /** Memoria de lo ya enviado (CS-N7): lo apuntado en los paquetes del servidor. */
  async function comprobarEnviados() {
    const enlaces = [...new Set(resultados.map(enlaceDe))];
    if (!enlaces.length) return;
    try {
      for (let i = 0; i < enlaces.length; i += 200) {
        const r = await ajustes.enviadosJd(enlaces.slice(i, i + 200));
        for (const [l, fecha] of Object.entries(r.enviados || {})) {
          if (!enviados.has(l)) enviados.set(l, fecha);
        }
      }
    } catch {
      return; // sin datos: no se oculta nada
    }
    pintarResultados();
  }

  /* ── Pintar ─────────────────────────────────────────────────────── */
  // CS-S12: los enlaces vienen de páginas de terceros: solo http(s) es navegable (como safeLink);
  // cualquier otro esquema («javascript:»…) no lleva a ningún sitio.
  const hrefSeguro = u => (/^https?:\/\//i.test(String(u || '')) ? u : '#');
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

  function marcaSitio(id, etiqueta, n, e) {
    const activa = pestana === id;
    const marca = !e
      ? ''
      : e.fase === 'busca' || e.fase === 'espera'
        ? ' ⏳'
        : e.fase === 'error' || e.bloqueo
          ? ' ⚠'
          : '';
    return el('button', {
      className: e?.fase === 'error' ? 'buscar__pestana--error' : '',
      attrs: {
        type: 'button',
        'aria-pressed': String(activa),
        'data-sitio': String(id),
        title:
          e?.error ||
          (e?.bloqueo ? t('buscar.bloqueo') : e?.recortado ? t('buscar.recortado') : ''),
      },
      children: [
        `${etiqueta} `,
        el('span', { className: 'buscar__n', text: `${n}${e?.recortado ? '+' : ''}${marca}` }),
      ],
    });
  }

  /**
   * Filas reutilizables (CS-14): cada resultado guarda su fila y la «firma» de lo que enseña. Con
   * cada tanda solo se crean las nuevas y las que cambiaron; el resto se recoloca (o ni eso).
   */
  const filas = new Map(); // r.url → { firma, nodo }
  function firmaDe(r, pasada) {
    const enlace = enlaceDe(r);
    const k = claveAlbum(r);
    const grupo = k ? albumes.get(k) : null;
    return [
      r.title,
      r.duration,
      enBiblioteca.has(enlace) ? 1 : 0,
      enviados.get(enlace) || 0,
      pasada.motivos.get(r) || '',
      copias.get(r.url)?.n || 0,
      ocultarRepetidos ? cuentaPagina.get(clavePagina(r)) || 1 : 0,
      grupo
        ? `${grupo[0] === r ? 'c' : 'm'}${grupo.length}${albumesAbiertos.has(k) ? 'a' : ''}`
        : '',
      jd.configurado() ? 1 : 0,
    ].join('|');
  }
  function filaDe(r, pasada) {
    const firma = firmaDe(r, pasada);
    const guardada = filas.get(r.url);
    if (guardada && guardada.firma === firma) return guardada.nodo;
    const nodo = tarjeta(r, pasada);
    filas.set(r.url, { firma, nodo });
    return nodo;
  }
  /** Deja en `caja` exactamente `nodos`, en ese orden, moviendo lo mínimo. */
  function reconciliar(caja, nodos) {
    let actual = caja.firstChild;
    for (const n of nodos) {
      if (n === actual) {
        actual = actual.nextSibling;
        continue;
      }
      caja.insertBefore(n, actual);
    }
    while (actual) {
      const siguiente = actual.nextSibling;
      actual.remove();
      actual = siguiente;
    }
  }

  function tarjeta(r, pasada) {
    const enlace = enlaceDe(r);
    const nombreDelSitio = r.sitio === ID_WEB ? dominioDe(enlace) : nombreSitio(r.sitio);
    const tengo = enBiblioteca.get(enlace);
    const enviado = enviados.get(enlace);
    const tituloFila = r.title || nombreDeUrl(r.url) || enlace;
    const imagen =
      r.thumbnail && !miniaturasRotas.has(r.thumbnail)
        ? cargarMiniatura(
            el('img', {
              attrs: {
                alt: '',
                loading: 'lazy',
                decoding: 'async',
              },
              // Si el sitio no la da, el hueco de siempre en vez de una imagen rota
              on: {
                error: e => {
                  miniaturasRotas.add(r.thumbnail);
                  e.currentTarget.replaceWith(
                    el('span', { className: 'buscar__sin', children: [icono('play')] })
                  );
                },
              },
            }),
            `/api/thumbnail?url=${encodeURIComponent(r.thumbnail)}&s=${r.thumbnailFirma || ''}`
          )
        : el('span', { className: 'buscar__sin', children: [icono('play')] });
    const oculto = pasada.motivos.get(r);
    const kAlbum = claveAlbum(r);
    const grupoAlbum = kAlbum ? albumes.get(kAlbum) : null;
    const esCabezaAlbum = Boolean(grupoAlbum && grupoAlbum[0] === r);
    const extra =
      (copias.get(r.url)?.representante === r.url ? copias.get(r.url).n - 1 : 0) +
      (ocultarRepetidos ? (cuentaPagina.get(clavePagina(r)) || 1) - 1 : 0);
    // CS-UX-010: una línea corta (la duración ya va sobre la miniatura; la relevancia ordena).
    const meta = [
      nombreDelSitio,
      extra > 0 ? `+${extra}` : null,
      esCabezaAlbum ? tp('buscar.album.n', grupoAlbum.length) : null,
    ].filter(Boolean);
    const estadoFila = oculto
      ? oculto === 'bloqueada'
        ? t('buscar.oculto.bloqueada.palabra', { palabra: r.bloqueada })
        : t(`buscar.oculto.${oculto}`)
      : tengo
        ? t('buscar.loTienes')
        : enviado
          ? t('buscar.enviadoEl', { fecha: fechaCorta(enviado, idiomaActual()) })
          : '';
    return el('article', {
      className: `buscar__tarjeta${tengo ? ' buscar__tarjeta--tengo' : ''}${enviado ? ' buscar__tarjeta--enviado' : ''}${oculto ? ' buscar__tarjeta--oculta' : ''}${grupoAlbum && !esCabezaAlbum ? ' buscar__tarjeta--miembro' : ''}`,
      attrs: { 'data-id': enlace, role: 'option', 'aria-label': tituloFila },
      children: [
        el('button', {
          className: 'buscar__casilla',
          attrs: {
            type: 'button',
            role: 'checkbox',
            'aria-checked': 'false',
            'aria-label': t('buscar.seleccionar', { titulo: tituloFila }),
          },
          on: {
            click: () => {
              // En modo selección ya alterna cgSeleccion (captura el clic de toda la fila).
              if (!seleccion?.modo) seleccion?.alternar(enlace);
            },
          },
        }),
        el('a', {
          className: 'buscar__imagen',
          attrs: {
            href: hrefSeguro(enlace),
            target: '_blank',
            rel: 'noopener noreferrer',
            tabindex: '-1',
            'aria-hidden': 'true',
          },
          children: [
            imagen,
            r.duration ? el('span', { className: 'buscar__duracion', text: r.duration }) : null,
          ],
        }),
        el('a', {
          className: 'buscar__texto',
          attrs: {
            href: hrefSeguro(enlace),
            target: '_blank',
            rel: 'noopener noreferrer',
            title: r.title || enlace,
          },
          children: [
            el('strong', { text: tituloFila }),
            el('span', { className: 'buscar__meta', text: meta.join(' · ') }),
            estadoFila ? el('span', { className: 'buscar__marca-estado', text: estadoFila }) : null,
          ],
        }),
        el('button', {
          className: 'buscar__mas',
          attrs: {
            type: 'button',
            'aria-haspopup': 'dialog',
            'aria-label': t('buscar.mas'),
            title: t('buscar.mas'),
          },
          children: [icono('mas')],
          on: { click: () => menuFila(r, { esCabezaAlbum, grupoAlbum, kAlbum, tituloFila }) },
        }),
      ],
    });
  }

  /** «⋯» de una fila: ver aquí, abrir, descargar, álbum, quitar de la lista. */
  function menuFila(r, { esCabezaAlbum, grupoAlbum, kAlbum, tituloFila }) {
    const enlace = enlaceDe(r);
    const abierto = Boolean(kAlbum && albumesAbiertos.has(kAlbum));
    menuAcciones({
      titulo: tituloFila,
      acciones: [
        {
          texto: t('buscar.previa'),
          detalle: t('buscar.previa.detalle'),
          fn: () => verPrevia(enlace, tituloFila),
        },
        archivoReproducible(r)
          ? { texto: t('buscar.ver'), fn: () => verVideo(r, tituloFila) }
          : null,
        {
          texto: t('buscar.abrir'),
          detalle: dominioDe(enlace),
          fn: () => window.open(hrefSeguro(enlace), '_blank', 'noopener,noreferrer'),
        },
        jd.configurado() ? { texto: t('buscar.jd'), fn: () => descargar([enlace]) } : null,
        esCabezaAlbum
          ? {
              texto: abierto
                ? t('buscar.album.plegar')
                : t('buscar.album.ver', { n: grupoAlbum.length }),
              fn: () => {
                if (abierto) albumesAbiertos.delete(kAlbum);
                else albumesAbiertos.add(kAlbum);
                pintarResultados();
              },
            }
          : null,
        { texto: t('buscar.sel.elegir'), fn: () => seleccion?.seleccionar([enlace]) },
        { texto: t('buscar.descartar'), fn: () => quitarDeLaLista([enlace]) },
      ],
    });
  }

  /**
   * Reproduce el vídeo en una hoja. Pasa por /api/media (el servidor), por lo mismo que las
   * miniaturas: el navegador no habla con el sitio, y muchos solo sirven el fichero a quien abrió
   * la ficha. Al cerrar la hoja se corta la descarga.
   */
  /** Tira de fotogramas de todo el vídeo, para ver qué es antes de mandarlo a descargar. */
  function verPrevia(enlace, tituloFila) {
    const estado = el('p', {
      className: 'buscar__previa-estado',
      text: t('buscar.previa.cargando'),
    });
    const caja = el('div', { className: 'buscar__previa', children: [estado] });
    abrirHoja({ titulo: tituloFila, contenido: [caja], clase: 'buscar__hoja-previa' });
    fetch(`/api/vista-previa?url=${encodeURIComponent(enlace)}`, { credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) {
          const datos = await res.json().catch(() => ({}));
          throw new Error(datos.error?.message || datos.error || datos.message || res.statusText);
        }
        const url = URL.createObjectURL(await res.blob());
        const img = el('img', {
          className: 'buscar__previa-img',
          attrs: { alt: t('buscar.previa.alt', { titulo: tituloFila }), src: url },
        });
        caja.replaceChildren(img);
      })
      .catch(error => {
        estado.textContent = t('buscar.previa.error', { error: error.message });
      });
  }

  function verVideo(r, tituloFila) {
    const video = el('video', {
      className: 'buscar__video',
      attrs: {
        controls: '',
        autoplay: '',
        playsinline: '',
        preload: 'metadata',
        src: `/api/media?url=${encodeURIComponent(r.url)}&ref=${encodeURIComponent(r.sourceUrl || '')}&s=${r.urlFirma || ''}`,
      },
      on: { error: () => toast(t('buscar.videoError'), 'error', 6000) },
    });
    const hoja = abrirHoja({ titulo: tituloFila, contenido: [video], clase: 'buscar__hoja-video' });
    hoja.addEventListener(
      'cg-cerrar',
      () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      },
      { once: true }
    );
  }

  function lineaSitio(id, e) {
    let textoLinea;
    if (e.fase === 'espera') textoLinea = t('buscar.estado.cola');
    else if (e.fase === 'busca' && e.web) textoLinea = t('buscar.estado.web');
    else if (e.fase === 'busca' && e.modo === 'pagina') textoLinea = t('buscar.estado.pagina');
    else if (e.fase === 'busca' && e.modo === 'listado' && !e.enlaces) {
      textoLinea = t('buscar.estado.listado');
    } else if (e.fase === 'busca' && e.enlaces) {
      textoLinea = t('buscar.estado.revisando', { hechos: e.hechos || 0, total: e.enlaces });
    } else if (e.fase === 'busca') textoLinea = t('buscar.estado.buscando');
    else if (e.fase === 'error') textoLinea = t('buscar.estado.error', { error: e.error });
    else textoLinea = tp('buscar.resultados', e.total || 0);
    const enCurso = e.fase === 'busca' || e.fase === 'espera';
    return el('li', {
      className: `buscar__linea${enCurso ? ' buscar__linea--curso' : ''}${e.fase === 'error' ? ' buscar__linea--error' : ''}`,
      children: [
        el('span', {
          className: enCurso ? 'buscar__girando' : 'buscar__hecho',
          text: enCurso ? '' : e.fase === 'error' ? '⚠' : '✓',
        }),
        el('strong', { text: nombreSitio(id) }),
        el('span', { text: textoLinea }),
      ],
    });
  }
  /** El detalle por sitio (antes siempre a la vista, encima de los resultados). */
  function abrirProgreso() {
    const lista = el('ul', {
      className: 'buscar__progreso',
      children: [...estado].map(([id, e]) => lineaSitio(id, e)),
    });
    abrirHoja({ titulo: textoEstado(), contenido: [lista] });
  }
  function textoEstado() {
    const quedan = [...estado.values()].filter(
      e => e.fase === 'espera' || e.fase === 'busca'
    ).length;
    if (parada) return t('buscar.estado.parada');
    return enCola
      ? t('buscar.estado.enCola')
      : quedan
        ? t('buscar.estado.quedan', { n: quedan, total: estado.size })
        : t('buscar.estado.terminado');
  }

  let ultimaFirmaMarcas = '';
  function pintarResultados() {
    if (zonaResultados.hidden) return;
    const buscando = [...estado.values()].some(e => e.fase === 'espera' || e.fase === 'busca');

    // Marcas por sitio (recuento + estado) y «Filtros (N)».
    // Solo se rehacen si cambió algo (llegan tandas cada 80 ms y casi siempre es lo mismo).
    const datosMarcas = [
      ['todos', t('buscar.todos'), resultados.length, buscando ? { fase: 'busca' } : null],
    ];
    for (const [id, e] of estado) {
      if (nombreSitio(id)) datosMarcas.push([id, nombreSitio(id), e.total || 0, e]);
    }
    const firmaMarcas = JSON.stringify([pestana, datosMarcas]);
    if (firmaMarcas !== ultimaFirmaMarcas) {
      ultimaFirmaMarcas = firmaMarcas;
      marcasSitios.replaceChildren(...datosMarcas.map(d => marcaSitio(...d)));
    }
    const activos = filtrosActivos();
    pintarBotonFiltros();
    marcasFiltros.hidden = activos.length === 0;
    marcasFiltros.replaceChildren(
      ...activos.map(f =>
        el('button', {
          className: 'buscar__marca',
          attrs: { type: 'button', 'aria-label': t('buscar.marca.quitar', { v: f.texto }) },
          children: [
            el('span', { text: f.texto }),
            el('span', { attrs: { 'aria-hidden': 'true' }, text: '✕' }),
          ],
          on: {
            click: () => {
              f.quitar();
              pintarResultados();
            },
          },
        })
      )
    );
    pintarSugeridos();

    cuentaPagina = new Map();
    for (const r of resultados) {
      cuentaPagina.set(clavePagina(r), (cuentaPagina.get(clavePagina(r)) || 0) + 1);
    }
    const pasada = calcular();
    ultimaPasada = pasada;
    const { lista } = pasada;

    // Una línea: estado de la búsqueda, cuántos se ven y lo oculto que se puede recuperar. Los
    // botones son SIEMPRE los mismos nodos (solo cambia su texto): rehacerlos con cada tanda (cada
    // 80 ms mientras llegan resultados) se comía el toque en el iPhone y «Parar» no paraba.
    const quedan = buscando;
    estadoGiro.hidden = !quedan;
    estadoTexto.textContent =
      (quedan || enCola || parada ? `${textoEstado()} · ` : '') +
      tp('buscar.resultados', lista.length) +
      (pasada.repetidos ? ` · ${tp('buscar.repetidos', pasada.repetidos)}` : '') +
      (pasada.enAlbumes > 0 ? ` · ${tp('buscar.enAlbumes', pasada.enAlbumes)}` : '');
    const fase = quedan || enCola || parada ? textoEstado() : tp('buscar.resultados', lista.length);
    const anuncio = quedan || enCola ? fase.replace(/\d+/g, '') : fase;
    if (anuncio !== ultimoAnuncio) {
      ultimoAnuncio = anuncio;
      anuncioEstado.textContent = fase;
    }
    const contar = (boton, n, clave) => {
      boton.hidden = !n;
      if (n) boton.textContent = tp(clave, n);
    };
    contar(cuentaTengo, ocultarTengo ? pasada.ocultos.get('tengo') || 0 : 0, 'buscar.tengo.cuenta');
    contar(
      cuentaEnviados,
      ocultarEnviados ? pasada.ocultos.get('enviado') || 0 : 0,
      'buscar.enviados.cuenta'
    );
    contar(cuentaDescartados, descartados.size, 'buscar.descartados');
    botonParar.hidden = !quedan;
    botonParar.textContent = t('buscar.parar');

    // Lo oculto por los filtros (sin contar «ya lo tengo» y «enviado», que tienen su contador).
    const ocultosFiltro = [...pasada.ocultos].filter(([m]) => m !== 'tengo' && m !== 'enviado');
    const totalOcultos = ocultosFiltro.reduce((a, [, n]) => a + n, 0);
    if (verN) {
      verN.textContent = t('buscar.filtros.ver', { n: lista.length });
      verN.title = totalOcultos
        ? `${tp('buscar.ocultos', totalOcultos)} (${ocultosFiltro
            .map(([m, n]) => t(`buscar.oculto.${m}.n`, { n }))
            .join(', ')})`
        : '';
    }

    // «Descargar todo»: sin lo que ya tienes ni lo enviado, aunque se esté mostrando.
    const paraTodo = paraDescargarTodo(lista, { tengo: enBiblioteca, enviados });
    pieAccion.hidden = !jd.configurado() || lista.length === 0;
    // Recoger, solo al buscar un nombre o una palabra (no un enlace pegado).
    botonRecoger.hidden =
      !(trabajoVisto || trabajo) ||
      resultados.length === 0 ||
      tipoDeEntrada(ultimaBusqueda) !== 'palabra';
    botonFotos.hidden = !hayFotos || tipoDeEntrada(ultimaBusqueda) !== 'palabra';
    descargarTodo.textContent = t('buscar.descargarTodo', { n: paraTodo.length });
    descargarTodo.disabled = paraTodo.length === 0;

    const e = pestana === 'todos' ? null : estado.get(pestana);
    const pintar = pasada.pintar;
    vacio.hidden = pintar.length > 0;
    const hijosVacio = [
      el('p', {
        text:
          e?.fase === 'error'
            ? t('buscar.errorSitio', { error: e.error })
            : buscando || e?.fase === 'busca' || e?.fase === 'espera'
              ? t('buscar.buscando')
              : resultados.length && (totalOcultos || pasada.ocultos.size)
                ? t('buscar.nada.ocultos')
                : t('buscar.nada'),
      }),
      // Todo oculto por los filtros: se quitan aquí mismo (el botón de filtros es uno, arriba).
      !buscando && resultados.length && pasada.ocultos.size && filtrosActivos().length
        ? el('button', {
            className: 'cg-boton cg-boton--principal',
            attrs: { type: 'button' },
            text: t('buscar.filtros.limpiar'),
            on: { click: () => limpiarFiltros() },
          })
        : null,
    ];
    // replaceChildren() escribiría «null» o «0»: solo nodos.
    vacio.replaceChildren(...hijosVacio.filter(Boolean));

    reconciliar(
      rejilla,
      pintar.map(r => filaDe(r, pasada))
    );
    pintarCasillas();
  }

  function pintarSugeridos() {
    clear(zonaSugeridos);
    zonaSugeridos.hidden = sugeridos.length === 0 && listados.size === 0;
    for (const [id, url] of listados) {
      zonaSugeridos.append(
        el('span', { text: t('buscar.listado', { sitio: nombreSitio(id) }) }),
        el('button', {
          className: 'cg-boton',
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
          className: 'cg-boton',
          attrs: { type: 'button', title: tp('buscar.resultados', s.videos) },
          text: `+ ${s.dominio} (${s.videos})`,
          on: { click: () => abrirAlta({ dominios: [s.dominio], termino: ultimaBusqueda }) },
        })
      );
    }
  }

  alCambiarIdioma(() => {
    filas.clear(); // los textos de cada fila están traducidos
    ultimaFirmaMarcas = '';
    pintarSelects();
    pintarSitios();
    pintarInicio();
    pintarDestinos();
    pintarResultados();
  });
  pintarSelects();
  pintarDestinos();
  pintarInicio();

  // Viene con ?q= (o ?searchTerm=, como enlaza clipkeeper): se busca directamente.
  const parametro = nombre => {
    try {
      return new URLSearchParams(window.location.search).get(nombre) || '';
    } catch {
      return '';
    }
  };
  // CS-N8: lo que llegó por «Compartir» del móvil (ver js/compartir.js), una sola vez.
  let compartido = '';
  try {
    compartido = sessionStorage.getItem('clipscout:compartido') || '';
    sessionStorage.removeItem('clipscout:compartido');
  } catch {
    compartido = '';
  }
  const inicial = compartido || parametro('q') || parametro('searchTerm');
  // ?prellenar=: deja el texto escrito, pero la búsqueda la lanza la persona.
  const prellenado = parametro('prellenar');
  if (inicial || prellenado) entrada.value = inicial || prellenado;
  /** Al abrir la página: si hay una búsqueda (en marcha o reciente) en el servidor, se muestra. */
  async function reengancharse() {
    try {
      const { busqueda } = await fetch('/api/buscar/actual').then(x => x.json());
      if (!busqueda) return;
      ver(busqueda);
    } catch {
      // sin búsqueda previa: la pantalla queda en su estado inicial
    }
  }

  // El aviso del proxy se comprueba al enfocar (también al arrancar): aquí iría repetido.
  cargarSitios().then(() => {
    refrescarCola();
    const hash = window.location.hash;
    if (inicial && (hash === '' || hash.startsWith('#/buscar'))) empezar();
    else if (!prellenado) reengancharse();
  });

  return {
    focus: () => {
      comprobarProxy();
      pintarRecientes();
      enfocarAlAbrir(entrada);
    },
    // Al irse a otra pantalla la selección no sigue tapando la barra de navegación.
    ocultar: () => seleccion?.limpiar(),
    // Solo deja de mirar: la búsqueda sigue en el servidor.
    teardown: () => {
      soltar();
      clearInterval(relojCola);
    },
  };
}
