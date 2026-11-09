import { ajustes } from '../api.js';
import { el, clear, toast, enfocarAlAbrir } from '../dom.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';
import { createJdEnvio } from '../components/jdEnvio.js';
import { chooseDialog } from '../components/dialog.js';
import { altaSitiosDialog } from '../components/altaSitios.js';

/** El «sitio» de lo encontrado en toda la web (no es una configuración guardada). */
const ID_WEB = -1;

/**
 * Buscar: la pantalla de inicio. Se escribe un nombre y se busca en TODOS los sitios guardados a la
 * vez (las configuraciones cuya dirección lleva {q}); los resultados llegan mezclados y arriba hay
 * una pestaña por sitio para ver solo los de uno. Para ir a fondo en un sitio está el Explorador.
 */

const CLAVE_SITIOS = 'clipscout:buscar-apagados';

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
  let recibidos = 0; // eventos ya procesados
  let reintento = null;
  let enBiblioteca = new Map(); // sourceUrl → coincidencia de clipkeeper
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
  for (const n of [1, 2, 3, 5, 10]) paginas.append(el('option', { attrs: { value: n }, text: n }));
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
    attrs: { type: 'button' },
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

  // «Tipo Google» (site:sitio nombre) con el SearXNG del servidor, si lo hay.
  const CLAVE_WEB = 'clipscout:buscar-web';
  const web = el('input', { attrs: { type: 'checkbox' } });
  try {
    web.checked = localStorage.getItem(CLAVE_WEB) !== '0';
  } catch {
    web.checked = true;
  }
  web.addEventListener('change', () => {
    try {
      localStorage.setItem(CLAVE_WEB, web.checked ? '1' : '0');
    } catch {
      // sin almacenamiento
    }
  });
  const textoWeb = el('span');
  const etiquetaWeb = el('label', {
    className: 'buscar__opcion',
    attrs: { hidden: '' },
    children: [web, textoWeb],
  });
  const textoPaginas = el('span');
  etiquetaPaginas.prepend(textoPaginas);

  const form = el('form', {
    className: 'buscar__form',
    children: [
      el('div', { className: 'buscar__fila', children: [entrada, boton, parar] }),
      chipsSitios,
      el('div', { className: 'buscar__pie', children: [ayuda, agregar, etiquetaPaginas] }),
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
  const rejilla = el('div', { className: 'buscar__rejilla' });
  const vacio = el('p', { className: 'buscar__vacio' });
  const zonaResultados = el('section', {
    className: 'buscar__resultados',
    attrs: { hidden: '' },
    children: [progreso, zonaSugeridos, pestanas, barra, vacio, rejilla],
  });

  const titulo = el('h2', { className: 'buscar__titulo', attrs: { id: 'buscar-heading' } });
  texto(titulo, 'buscar.titulo');

  root.append(el('div', { className: 'buscar', children: [titulo, form, zonaResultados] }));

  /* ── Repetidos y filtros de la lista ─────────────────────────────────── */
  // url → { representante, n }: copias del mismo vídeo (mismo o distinto sitio). Se pliegan bajo
  // el primero, como en el Explorador; nunca se borra nada.
  let copias = new Map();
  let ocultarRepetidos = true;
  let minDuracion = 0; // minutos; 0 = cualquiera
  const descartados = new Set(); // páginas quitadas a mano de esta búsqueda
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
  const visibles = ({ plegar = ocultarRepetidos } = {}) => {
    const vistas = new Set();
    return resultados.filter(r => {
      if (pestana !== 'todos' && r.sitio !== pestana) return false;
      if (descartados.has(r.sourceUrl || r.url)) return false;
      if (
        minDuracion &&
        !(Number.isFinite(r.durationSeconds) && r.durationSeconds >= minDuracion * 60)
      ) {
        return false;
      }
      if (!plegar) return true;
      if (esCopia(r) || vistas.has(clavePagina(r))) return false;
      vistas.add(clavePagina(r));
      return true;
    });
  };
  const jd = createJdEnvio({ visibles: () => visibles().map(r => r.sourceUrl || r.url) });
  // La misma página (un álbum con varios vídeos) se manda una sola vez: JDownloader ya la abre entera.
  const descargar = links =>
    jd.enviar(
      [...new Set(links)],
      destinoFijo === null ? {} : { carpeta: destinoFijo, regla: reglaFija }
    );

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
    boton.textContent = t('buscar.boton');
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
    agregar.textContent = t('buscar.agregarSitios');
    textoWeb.textContent = t('buscar.web');
    etiquetaWeb.title = t('buscar.web.titulo');
  }

  async function cargarSitios() {
    try {
      const r = await fetch('/api/buscar/sitios').then(x => x.json());
      sitios = r.sitios || [];
      hayWeb = Boolean(r.web);
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

  async function empezar() {
    const q = entrada.value.trim();
    if (!q) {
      entrada.focus();
      return;
    }
    // La búsqueda web trae más, pero también mucho que no es: se pregunta cada vez.
    let conWeb = false;
    let conAbierta = false;
    if (hayWeb) {
      const r = await chooseDialog({
        titleKey: 'buscar.webPregunta',
        labelKey: 'buscar.webPregunta.texto',
        opciones: [
          { valor: 'no', titulo: t('buscar.webNo'), detalle: t('buscar.webNo.detalle') },
          { valor: 'si', titulo: t('buscar.webSi'), detalle: t('buscar.webSi.detalle') },
          { valor: 'todo', titulo: t('buscar.webTodo'), detalle: t('buscar.webTodo.detalle') },
        ],
      });
      if (r === null) return;
      conWeb = r === 'si' || r === 'todo';
      conAbierta = r === 'todo';
    }
    const elegidos = sitios.filter(s => !apagados.has(s.nombre));
    if (elegidos.length === 0 && !conAbierta) return;
    fuente?.close();
    resultados = [];
    descartados.clear();
    copias = new Map();
    enBiblioteca = new Map();
    pestana = 'todos';
    estado = new Map(elegidos.map(s => [s.id, { fase: 'espera', total: 0 }]));
    if (conAbierta) estado.set(ID_WEB, { fase: 'espera', total: 0 });
    sugeridos = [];
    ultimaBusqueda = q;
    zonaResultados.hidden = false;
    boton.hidden = true;
    parar.hidden = false;

    const query = new URLSearchParams({ q, paginas: paginas.value });
    if (conWeb) query.set('web', '1');
    if (conAbierta) query.set('abierta', '1');
    if (elegidos.length < sitios.length) query.set('sitios', elegidos.map(s => s.id).join(','));
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
  }

  /** Se suscribe a la búsqueda `id` del servidor desde el evento `desde`. */
  function conectar(id, desde) {
    soltar();
    trabajo = id;
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
      if (m.type === 'sitios') {
        for (const x of m.sitios || []) {
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
            : { ...previo, hechos: m.hechos ?? 0, enlaces: m.enlaces ?? previo.enlaces }
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

  /** Pregunta a clipkeeper cuáles ya están en la biblioteca (por título y duración). */
  async function comprobarBiblioteca(avisar) {
    const lista = resultados.filter(r => r.title || nombreDeUrl(r.url));
    if (lista.length === 0) return;
    try {
      const r = await ajustes.yaLoTengo(
        lista.map(x => x.title || nombreDeUrl(x.url)),
        lista.map(x => (Number.isFinite(x.durationSeconds) ? x.durationSeconds : null))
      );
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
    id === ID_WEB ? t('buscar.webAbierta') : sitios.find(s => s.id === id)?.nombre || '';
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
    const nombreDelSitio = r.sitio === ID_WEB ? dominioDe(enlace) : nombreSitio(r.sitio);
    const tengo = enBiblioteca.get(enlace);
    const imagen = r.thumbnail
      ? el('img', {
          attrs: {
            src: `/api/thumbnail?url=${encodeURIComponent(r.thumbnail)}`,
            alt: '',
            loading: 'lazy',
          },
          // Si el sitio no la da, el hueco de siempre en vez de una imagen rota
          on: {
            error: e =>
              e.currentTarget.replaceWith(el('span', { className: 'buscar__sin', text: '▶' })),
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
    return el('article', {
      className: `buscar__tarjeta${tengo ? ' buscar__tarjeta--tengo' : ''}`,
      children: [
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
            el('span', { className: 'buscar__sitio', text: nombreDelSitio }),
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

  function lineaSitio(id, e) {
    let texto;
    if (e.fase === 'espera') texto = t('buscar.estado.cola');
    else if (e.fase === 'busca' && e.web) texto = t('buscar.estado.web');
    else if (e.fase === 'busca' && e.enlaces) {
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
            text: quedan
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
      const repetidos = ocultarRepetidos ? visibles({ plegar: false }).length - lista.length : 0;
      barra.append(
        el('span', {
          className: 'buscar__cuenta',
          text:
            tp('buscar.resultados', lista.length) +
            (repetidos ? ` · ${tp('buscar.repetidos', repetidos)}` : ''),
        }),
        yaLoTengo
      );
      if (jd.configurado()) {
        descargarTodo.textContent = t('buscar.descargarTodo', { n: lista.length });
        barra.append(etiquetaDestino, descargarTodo);
      }
    }
    if (resultados.length > 0) {
      barra.append(etiquetaDuracion, etiquetaRepetidos);
    }

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
    for (const r of lista) rejilla.append(tarjeta(r));
  }

  function pintarSugeridos() {
    clear(zonaSugeridos);
    zonaSugeridos.hidden = sugeridos.length === 0;
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
      entrada.value = busqueda.q;
      ultimaBusqueda = busqueda.q;
      resultados = [];
      estado = new Map();
      conectar(busqueda.id, 0);
    } catch {
      // sin búsqueda previa: la pantalla queda vacía, como siempre
    }
  }

  cargarSitios().then(() => {
    const hash = window.location.hash;
    if (inicial && (hash === '' || hash.startsWith('#/buscar'))) empezar();
    else if (!prellenado) reengancharse();
  });

  return {
    focus: () => enfocarAlAbrir(entrada),
    // Solo deja de mirar: la búsqueda sigue en el servidor.
    teardown: () => soltar(),
  };
}
