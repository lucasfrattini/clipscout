import { getHealth } from './api.js';
import { createExplorerView } from './views/explorer.js';
import { createBuscarView } from './views/buscar.js';
import { createVideoView } from './views/video.js';
import { createAjustesView, initCrewCabecera } from './views/ajustes.js';
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

function initRouter(views) {
  const tabs = [...document.querySelectorAll('.tab')];
  const sections = {
    buscar: document.getElementById('view-buscar'),
    explorer: document.getElementById('view-explorer'),
    video: document.getElementById('view-video'),
    ajustes: document.getElementById('view-ajustes'),
  };

  /**
   * Fija `<title>` y `<meta name="description">` según la vista activa.
   *
   * Las dos herramientas viven en la misma URL con hash (`#/explorer`,
   * `#/video`), así que sin esto ambas compartían el título estático
   * "clipscout" y una descripción genérica: la pestaña del navegador y el
   * historial no distinguían en cuál de las dos estabas.
   */
  function aplicarCabecera(name) {
    document.title = t(`head.${name}.titulo`);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t(`head.${name}.desc`));
  }

  function activate(name, { updateHash = true } = {}) {
    // «ajustes/sitios»: la vista es la primera parte; el resto lo lee la propia vista.
    name = String(name).split('/')[0];
    if (!sections[name]) name = 'buscar';

    aplicarCabecera(name);

    for (const tab of tabs) {
      const isActive = tab.dataset.view === name;
      if (isActive) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }

    for (const [key, section] of Object.entries(sections)) {
      section.hidden = key !== name;
    }

    if (updateHash) {
      const hash = `#/${name}`;
      const actual = window.location.hash;
      if (actual !== hash && !actual.startsWith(`${hash}/`)) {
        window.history.replaceState(null, '', hash);
      }
    }

    views[name]?.focus?.();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.view));
  }

  window.addEventListener('hashchange', () => {
    activate(window.location.hash.replace('#/', '') || 'buscar', { updateHash: false });
  });

  const initial = window.location.hash.replace('#/', '') || 'buscar';
  activate(initial);

  // El título es texto calculado, así que se rehace al cambiar de idioma: si
  // no, se quedaría en español con la interfaz ya en inglés.
  alCambiarIdioma(() => {
    const actual = (window.location.hash.replace('#/', '') || 'buscar').split('/')[0];
    aplicarCabecera(sections[actual] ? actual : 'buscar');
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
  const estado = await fetch('/api/auth/estado')
    .then(r => r.json())
    .catch(() => ({}));
  if (estado.asistente) {
    location.replace('/bienvenida');
    return;
  }

  // El idioma va PRIMERO: todo lo que se construya después ya nace traducido
  // y no hay un parpadeo en español antes de pasar a inglés.
  traducirDocumento();
  aplicarTema(temaGuardado());

  const limits = { ...DEFAULT_LIMITS, ...(await initHealth()) };

  const views = {
    buscar: createBuscarView(document.getElementById('view-buscar')),
    explorer: createExplorerView(document.getElementById('view-explorer'), { limits }),
    video: createVideoView(document.getElementById('view-video')),
    ajustes: createAjustesView(document.getElementById('view-ajustes')),
  };

  initRouter(views);
  await initCrewCabecera(document.getElementById('crew-apps'));
  document.getElementById('guia').addEventListener('click', mostrarGuia);
  await aceptarAviso();
  if (!window.guiaVista('clipscout')) mostrarGuia();
  avisoSinCifrar();

  // Abortar los streams en curso al cerrar la pestaña, para que el servidor
  // no siga scrapeando en vano.
  window.addEventListener('beforeunload', () => {
    for (const view of Object.values(views)) view.teardown?.();
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
  let estado;
  try {
    estado = await (await fetch('/api/auth/estado')).json();
  } catch {
    return;
  }
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
