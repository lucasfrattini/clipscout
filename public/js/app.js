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
      if (window.location.hash !== hash) {
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
    const actual = window.location.hash.replace('#/', '') || 'buscar';
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
  initCrewCabecera(document.getElementById('crew-apps'));

  // Abortar los streams en curso al cerrar la pestaña, para que el servidor
  // no siga scrapeando en vano.
  window.addEventListener('beforeunload', () => {
    for (const view of Object.values(views)) view.teardown?.();
  });
}

main();
