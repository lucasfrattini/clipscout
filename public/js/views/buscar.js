import { ajustes } from '../api.js';
import { el, clear, toast, enfocarAlAbrir } from '../dom.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';
import { createJdEnvio } from '../components/jdEnvio.js';

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
  let enBiblioteca = new Map(); // sourceUrl → coincidencia de clipkeeper

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
    on: { click: () => terminar(true) },
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
      el('div', { className: 'buscar__pie', children: [ayuda, etiquetaWeb, etiquetaPaginas] }),
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
  const barra = el('div', { className: 'buscar__barra' });
  const rejilla = el('div', { className: 'buscar__rejilla' });
  const vacio = el('p', { className: 'buscar__vacio' });
  const zonaResultados = el('section', {
    className: 'buscar__resultados',
    attrs: { hidden: '' },
    children: [progreso, pestanas, barra, vacio, rejilla],
  });

  const titulo = el('h2', { className: 'buscar__titulo', attrs: { id: 'buscar-heading' } });
  texto(titulo, 'buscar.titulo');

  root.append(el('div', { className: 'buscar', children: [titulo, form, zonaResultados] }));

  const visibles = () => resultados.filter(r => pestana === 'todos' || r.sitio === pestana);
  const jd = createJdEnvio({ visibles: () => visibles().map(r => r.sourceUrl || r.url) });
  jd.alCargar(() => pintarResultados());

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
    textoWeb.textContent = t('buscar.web');
    etiquetaWeb.title = t('buscar.web.titulo');
  }

  async function cargarSitios() {
    try {
      const r = await fetch('/api/buscar/sitios').then(x => x.json());
      sitios = r.sitios || [];
      etiquetaWeb.hidden = !r.web;
    } catch {
      sitios = [];
    }
    pintarSitios();
  }

  /* ── Búsqueda ───────────────────────────────────────────────────── */
  function terminar(cancelado = false) {
    fuente?.close();
    fuente = null;
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

  function empezar() {
    const q = entrada.value.trim();
    if (!q) {
      entrada.focus();
      return;
    }
    const elegidos = sitios.filter(s => !apagados.has(s.nombre));
    if (elegidos.length === 0) return;
    fuente?.close();
    resultados = [];
    enBiblioteca = new Map();
    pestana = 'todos';
    estado = new Map(elegidos.map(s => [s.id, { fase: 'espera', total: 0 }]));
    zonaResultados.hidden = false;
    boton.hidden = true;
    parar.hidden = false;

    const query = new URLSearchParams({ q, paginas: paginas.value });
    if (!etiquetaWeb.hidden && web.checked) query.set('web', '1');
    if (elegidos.length < sitios.length) query.set('sitios', elegidos.map(s => s.id).join(','));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('q', q);
      window.history.replaceState(null, '', url);
    } catch {
      // sin URL: no pasa nada
    }

    fuente = new EventSource(`/api/buscar/stream?${query}`);
    fuente.onmessage = ev => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === 'sitio_inicio') estado.set(m.sitio, { ...estado.get(m.sitio), fase: 'busca' });
      else if (m.type === 'sitio_progreso') {
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
      } else if (m.type === 'fin') return terminar();
      else if (m.type === 'error') {
        toast(m.message, 'error', 6000);
        return terminar();
      }
      pintarResultados();
    };
    fuente.onerror = () => {
      if (fuente) {
        toast(t('api.sseCaida'), 'error', 6000);
        terminar();
      }
    };
    pintarResultados();
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
    const sitio = sitios.find(s => s.id === r.sitio);
    const enlace = r.sourceUrl || r.url;
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
          on: { click: () => jd.enviar([enlace]) },
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
            el('span', { className: 'buscar__sitio', text: sitio?.nombre || '' }),
          ],
        }),
        el('div', { className: 'buscar__acciones', children: acciones }),
      ],
    });
  }

  function lineaSitio(id, e) {
    const s = sitios.find(x => x.id === id);
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
        el('strong', { text: s?.nombre || '' }),
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
        text: quedan
          ? t('buscar.estado.quedan', { n: quedan, total: estado.size })
          : t('buscar.estado.terminado'),
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
      const s = sitios.find(x => x.id === id);
      if (s) pestanas.append(pestanaBoton(id, s.nombre, e.total || 0, e));
    }

    const lista = visibles();
    clear(barra);
    if (lista.length > 0) {
      barra.append(
        el('span', { className: 'buscar__cuenta', text: tp('buscar.resultados', lista.length) }),
        yaLoTengo,
        jd.boton
      );
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
    for (const r of lista) rejilla.append(tarjeta(r));
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
  if (inicial) entrada.value = inicial;
  cargarSitios().then(() => {
    const hash = window.location.hash;
    if (inicial && (hash === '' || hash.startsWith('#/buscar'))) empezar();
  });

  return {
    focus: () => enfocarAlAbrir(entrada),
    teardown: () => fuente?.close(),
  };
}
