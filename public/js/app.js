import { estadoAcceso, getHealth, sistema } from './api.js';
import { createBuscarView } from './views/buscar.js';
import { initCrewCabecera, marcarVersionNueva } from './appsCrew.js';
import { toast } from './dom.js';
import { aplicarTema, temaGuardado } from './tema.js';
import { t, alCambiarIdioma, traducirDocumento } from './i18n/index.js';

const DEFAULT_LIMITS = {
  maxPages: 50,
  maxLinks: 5000,
  maxFiles: 5000,
  maxConcurrency: 12,
  defaultConcurrency: 4,
};

/* ── Idioma y tema ─────────────────────────────────────────────────── */
// Se eligen en Ajustes → Apariencia (como en clipkeeper y clonbuster), no en la cabecera.

/* ── Navegación entre vistas ───────────────────────────────────────── */

/**
 * CS-15: cada vista se carga al abrirla por primera vez (antes se descargaban y construían todas
 * al arrancar, también las que el móvil no usa). Buscar, la principal, va siempre: la guía y
 * Actividad («Ver») cuentan con ella.
 */
const CARGAR_VISTA = {
  actividad: () => import('./views/actividad.js').then(m => m.createActividadView),
  explorer: () => import('./views/explorer.js').then(m => m.createExplorerView),
  video: () => import('./views/video.js').then(m => m.createVideoView),
  ajustes: () =>
    Promise.all([
      import('./views/ajustes.js').then(m => m.createAjustesView),
      cargarEstilos(ESTILOS_DE_VISTA.ajustes),
    ]).then(([crear]) => crear),
};

/** Hojas de estilo que solo usa una vista: se piden con ella (CS-15), no al arrancar. */
const ESTILOS_DE_VISTA = { ajustes: ['/styles/sistema.css'] };

function cargarEstilos(rutas = []) {
  return Promise.all(
    rutas.map(href => {
      if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return null;
      return new Promise(resolver => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        // Si no llega, la vista se pinta igual (sin esos estilos) en vez de quedarse esperando.
        link.addEventListener('load', resolver, { once: true });
        link.addEventListener('error', resolver, { once: true });
        setTimeout(resolver, 3000);
        document.head.append(link);
      });
    })
  );
}

/**
 * Avisos entre vistas: si la que escucha aún no se cargó, se carga y se le repite el aviso
 * (p. ej. «Repetir cada…» en Buscar abre la programada en Actividad).
 */
const AVISOS_DE_VISTA = { 'clipscout:programar': 'actividad' };

function crearVistas({ limits }) {
  const vistas = {
    buscar: createBuscarView(document.getElementById('view-buscar')),
  };
  const enCurso = {};
  const opciones = { explorer: { limits } };
  function vista(nombre) {
    if (vistas[nombre]) return Promise.resolve(vistas[nombre]);
    if (!CARGAR_VISTA[nombre]) return Promise.resolve(null);
    enCurso[nombre] ||= CARGAR_VISTA[nombre]()
      .then(crear => {
        vistas[nombre] = crear(document.getElementById(`view-${nombre}`), opciones[nombre]);
        return vistas[nombre];
      })
      .catch(error => {
        delete enCurso[nombre];
        throw error;
      });
    return enCurso[nombre];
  }
  for (const [aviso, nombre] of Object.entries(AVISOS_DE_VISTA)) {
    window.addEventListener(aviso, e => {
      if (vistas[nombre]) return;
      vista(nombre).then(() => window.dispatchEvent(new CustomEvent(aviso, { detail: e.detail })));
    });
  }
  return { vista, creada: nombre => vistas[nombre] || null, todas: () => Object.values(vistas) };
}

const toastErrorDeCarga = () => toast(t('app.errorCarga'), 'error', 8000);

function initRouter(vistas) {
  const barra = document.querySelector('cg-barra-inferior');
  const sections = {
    buscar: document.getElementById('view-buscar'),
    actividad: document.getElementById('view-actividad'),
    explorer: document.getElementById('view-explorer'),
    video: document.getElementById('view-video'),
    ajustes: document.getElementById('view-ajustes'),
  };
  /**
   * Qué destino de la barra se ilumina: #/explorer a secas es «Avanzada»; el editor de un sitio
   * (#/explorer/<n>) se abre desde Ajustes, y el análisis de un enlace (#/video) es parte de Buscar.
   */
  const destinoDe = (name, completo) =>
    name === 'explorer'
      ? /^explorer\/\d/.test(completo)
        ? 'ajustes'
        : 'explorer'
      : name === 'video'
        ? 'buscar'
        : name;

  /**
   * Fija `<title>` y `<meta name="description">` según la vista activa.
   *
   * Las vistas viven en la misma URL con hash (`#/explorer`, `#/video`), así que sin esto
   * compartían el título estático "clipscout" y una descripción genérica: la pestaña del
   * navegador y el historial no distinguían en cuál estabas.
   */
  function aplicarCabecera(name) {
    document.title = t(`head.${name}.titulo`);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t(`head.${name}.desc`));
  }

  let actual = null;
  function activate(name, { updateHash = true } = {}) {
    // «ajustes/sitios»: la vista es la primera parte; el resto lo lee la propia vista.
    const completo = String(name);
    name = completo.split('/')[0];
    if (!sections[name]) name = 'buscar';

    aplicarCabecera(name);
    barra?.activar?.(`#/${destinoDe(name, completo)}`);

    for (const [key, section] of Object.entries(sections)) {
      section.hidden = key !== name;
    }

    if (updateHash) {
      const hash = `#/${name}`;
      const hashActual = window.location.hash;
      if (hashActual !== hash && !hashActual.startsWith(`${hash}/`)) {
        window.history.replaceState(null, '', hash);
      }
    }

    // Cambiar de pantalla empieza arriba (cada una tiene su propia cabecera).
    if (actual !== name) window.scrollTo(0, 0);
    if (actual && actual !== name) vistas.creada(actual)?.ocultar?.();
    actual = name;
    const pedida = name;
    vistas
      .vista(name)
      .then(v => {
        // Si entretanto se cambió de pantalla, el foco es de la otra.
        if (actual === pedida) v?.focus?.();
      })
      .catch(() => toastErrorDeCarga());
  }

  window.addEventListener('hashchange', () => {
    activate(window.location.hash.replace('#/', '') || 'buscar', { updateHash: false });
  });

  const initial = window.location.hash.replace('#/', '') || 'buscar';
  activate(initial);

  // El título es texto calculado, así que se rehace al cambiar de idioma: si no, se quedaría en
  // español con la interfaz ya en inglés.
  alCambiarIdioma(() => {
    const vista = (window.location.hash.replace('#/', '') || 'buscar').split('/')[0];
    aplicarCabecera(sections[vista] ? vista : 'buscar');
  });
}

/* ── Estado del servicio ───────────────────────────────────────────── */

async function initHealth() {
  const dot = document.getElementById('health-indicator');
  const text = document.getElementById('health-text');

  /** Último estado conocido, para poder repintarlo en el otro idioma. */
  let estado = null;

  const pintar = () => {
    if (!estado) return;
    text.textContent = estado.ok
      ? t('salud.activo', {
          estado: t(
            estado.browserEnabled ? 'salud.navegador.disponible' : 'salud.navegador.desactivado'
          ),
          paginas: estado.maxPages,
        })
      : t('salud.error');
  };
  alCambiarIdioma(pintar);

  /**
   * A partir de aquí el texto lo gobierna `pintar()`, así que se le quita el
   * `data-i18n` del HTML. Si se dejara, el traductor del documento lo
   * devolvería a «Comprobando servicio…» en cada cambio de idioma, pisando
   * el estado real.
   */
  const tomarElControl = () => text.removeAttribute('data-i18n');

  try {
    const health = await getHealth();
    dot.className = 'status-dot status-dot--ok';
    tomarElControl();
    estado = { ok: true, browserEnabled: health.browserEnabled, maxPages: health.limits.maxPages };
    pintar();
    return health.limits;
  } catch {
    dot.className = 'status-dot status-dot--error';
    tomarElControl();
    estado = { ok: false };
    pintar();
    return DEFAULT_LIMITS;
  }
}

/* ── Arranque ──────────────────────────────────────────────────────── */

async function main() {
  // Instalación nueva (sin usuario ni datos): antes que nada, el asistente de primer arranque.
  const estado = await estadoAcceso();
  if (estado.asistente) {
    location.replace('/bienvenida');
    return;
  }

  // El idioma va PRIMERO: todo lo que se construya después ya nace traducido
  // y no hay un parpadeo en español antes de pasar a inglés.
  traducirDocumento();
  aplicarTema(temaGuardado());

  const limits = { ...DEFAULT_LIMITS, ...(await initHealth()) };

  const vistas = crearVistas({ limits });
  initRouter(vistas);
  // «Apps», el último botón de la barra (igual en las tres apps): las otras apps, la guía y Salir.
  document
    .getElementById('boton-apps')
    ?.addEventListener('click', () => document.getElementById('hoja-apps')?.abrir?.());
  await initCrewCabecera(document.getElementById('crew-apps'));
  document.getElementById('guia').addEventListener('click', () => {
    document.getElementById('hoja-apps')?.cerrar?.();
    mostrarGuia();
  });
  await aceptarAviso();
  if (!window.guiaVista('clipscout')) mostrarGuia();
  avisoSinCifrar();
  // ¿Versión nueva? Lo que ya sabe el servidor (él consulta la web una vez al día, no esto).
  sistema
    .actualizaciones()
    .then(marcarVersionNueva)
    .catch(() => {});
  window.addEventListener('clipscout:versiones', e => marcarVersionNueva(e.detail));

  // Abortar los streams en curso al cerrar la pestaña, para que el servidor
  // no siga scrapeando en vano.
  window.addEventListener('beforeunload', () => {
    for (const view of vistas.todas()) view.teardown?.();
  });
}

/**
 * Condiciones de uso: la primera vez hay que leerlas y aceptarlas antes de usar clipscout. Se
 * recuerda en el navegador (cookie, que no depende del puerto, y localStorage) con la fecha.
 */
const CLAVE_AVISO = 'cs-aviso-uso';
function avisoAceptado() {
  if (document.cookie.split('; ').some(c => c.startsWith(`${CLAVE_AVISO}=`))) return true;
  try {
    return Boolean(localStorage.getItem(CLAVE_AVISO));
  } catch {
    return false;
  }
}
function aceptarAviso() {
  if (avisoAceptado()) return Promise.resolve();
  return new Promise(resolver => {
    const nodo = (tag, props = {}, ...hijos) => {
      const n = Object.assign(document.createElement(tag), props);
      n.append(...hijos);
      return n;
    };
    const casilla = nodo('input', { type: 'checkbox', id: 'aviso-acepto' });
    const boton = nodo('button', {
      type: 'button',
      className: 'cc-guia-btn prim',
      disabled: true,
      textContent: t('aviso.boton'),
    });
    casilla.addEventListener('change', () => (boton.disabled = !casilla.checked));
    const fondo = nodo(
      'div',
      { className: 'cc-guia-fondo' },
      nodo(
        'div',
        { className: 'cc-guia cc-aviso' },
        nodo(
          'div',
          { className: 'cc-guia-cab' },
          nodo('img', { src: '/img/crew/clipscout.png', alt: '' }),
          nodo(
            'div',
            {},
            nodo('span', { className: 'cc-guia-eyebrow', textContent: 'Clipgeist · clipscout' }),
            nodo('h2', { textContent: t('aviso.titulo') })
          )
        ),
        nodo('p', { className: 'cc-guia-lead', textContent: t('aviso.intro') }),
        nodo(
          'ul',
          { className: 'cc-aviso-lista' },
          ...['p1', 'p2', 'p3', 'p4'].map(k => nodo('li', { textContent: t(`aviso.${k}`) }))
        ),
        nodo(
          'label',
          { className: 'cc-aviso-acepto' },
          casilla,
          nodo('span', { textContent: t('aviso.acepto') })
        ),
        nodo(
          'div',
          { className: 'cc-guia-botones' },
          nodo('a', {
            className: 'cc-guia-btn',
            href: 'https://clipgeist.com/#uso',
            target: '_blank',
            rel: 'noopener',
            textContent: t('aviso.mas'),
          }),
          boton
        )
      )
    );
    fondo.setAttribute('role', 'dialog');
    fondo.setAttribute('aria-modal', 'true');
    fondo.setAttribute('aria-label', t('aviso.titulo'));
    boton.addEventListener('click', () => {
      const fecha = new Date().toISOString();
      document.cookie = `${CLAVE_AVISO}=${fecha}; max-age=315360000; path=/; samesite=lax`;
      try {
        localStorage.setItem(CLAVE_AVISO, fecha);
      } catch {
        /* queda la cookie */
      }
      fondo.remove();
      resolver();
    });
    document.body.append(fondo);
    casilla.focus();
  });
}

/**
 * Banda discreta si se entra desde internet (IP pública) sin HTTPS: la contraseña viaja en claro.
 * Lo decide el servidor (/api/auth/estado). «Entendido» la oculta 30 días en este navegador.
 */
const CLAVE_CIFRADO = 'cs-aviso-cifrado';
async function avisoSinCifrar() {
  const estado = await estadoAcceso();
  if (!estado?.avisoCifrado) return;
  try {
    const visto = Number(localStorage.getItem(CLAVE_CIFRADO) || 0);
    if (Date.now() - visto < 30 * 24 * 60 * 60 * 1000) return;
  } catch {
    /* sin almacenamiento: se muestra */
  }
  const banda = document.createElement('div');
  banda.className = 'aviso-cifrado';
  banda.setAttribute('role', 'status');
  const texto = document.createElement('span');
  texto.textContent = t('aviso.cifrado');
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'button button--small button--secondary';
  boton.textContent = t('aviso.cerrar');
  boton.addEventListener('click', () => {
    try {
      localStorage.setItem(CLAVE_CIFRADO, String(Date.now()));
    } catch {
      /* solo por esta vez */
    }
    banda.remove();
  });
  banda.append(texto, boton);
  document.body.prepend(banda);
}

/** Guía de bienvenida (public/js/guia.js): la primera vez sola, luego con el «?» de la cabecera. */
function mostrarGuia() {
  const k = c => t(`guia.${c}`);
  window.abrirGuia({
    app: 'clipscout',
    apps: '#crew-apps',
    accion: () => {
      location.hash = '#/buscar';
      setTimeout(() => document.getElementById('agregar-sitios')?.click(), 50);
    },
    textos: {
      titulo: k('titulo'),
      lead: k('lead'),
      puntos: [
        [k('p1b'), k('p1')],
        [k('p2b'), k('p2')],
        [k('p3b'), k('p3')],
      ],
      accionTitulo: k('accionTitulo'),
      accionTexto: k('accionTexto'),
      accionBoton: k('accionBoton'),
      despues: k('despues'),
      appsTitulo: k('appsTitulo'),
      appsTexto: k('appsTexto'),
      descargar: k('descargar'),
      conectada: k('conectada'),
      noConectada: k('noConectada'),
      siguiente: k('siguiente'),
      atras: k('atras'),
      listo: k('listo'),
      cerrar: k('cerrar'),
    },
  });
}

main();
