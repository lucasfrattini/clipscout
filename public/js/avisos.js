/**
 * Avisos (CS-N5) en la interfaz: el punto de cg-ui en «Actividad» con los que hay sin leer y,
 * si el navegador lo permite y se pidió en Ajustes → Sistema, una notificación del sistema por
 * cada aviso nuevo mientras la página no se está mirando.
 *
 * Se pregunta al servidor cada 30 s con la página visible (y al volver a ella); oculta, solo si
 * se pidieron notificaciones. Llegan, por tanto, con clipscout abierto en alguna pestaña: sin un
 * servidor de notificaciones (que no hay) un navegador no puede recibirlas cerrado.
 */
import { t } from './i18n/index.js';

const CADA_MS = 30000;
const CLAVE_PREF = 'clipscout:notificaciones';
const CLAVE_VISTO = 'clipscout:avisos-notificado';

const leer = (clave, def = '') => {
  try {
    return localStorage.getItem(clave) ?? def;
  } catch {
    return def;
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, String(valor));
  } catch {
    /* sin almacenamiento */
  }
};

/** Texto de un aviso en el idioma de la interfaz. */
export function textoAviso(a) {
  const p = a.params || {};
  // Fase 7 (C4): lo que mandó una persona seguida, con los primeros títulos.
  if (a.tipo === 'programada' && p.seguida) {
    const base = t('aviso.seguida', p);
    return p.titulos?.length ? `${base}: ${p.titulos.join(' · ')}` : base;
  }
  if (a.tipo === 'programada' && p.titulos?.length) {
    return `${t('aviso.programada', p)}: ${p.titulos.join(' · ')}`;
  }
  return t(`aviso.${a.tipo}`, p);
}

/**
 * ¿Se pueden pedir notificaciones aquí? 'si' | 'no_soportado' | 'inseguro' (el navegador solo
 * las permite con https o en este mismo equipo) | 'denegado'.
 */
export function notificacionesPosibles() {
  if (typeof Notification === 'undefined') return 'no_soportado';
  if (!window.isSecureContext) return 'inseguro';
  if (Notification.permission === 'denied') return 'denegado';
  return 'si';
}
export const notificacionesActivas = () =>
  leer(CLAVE_PREF) === '1' &&
  notificacionesPosibles() === 'si' &&
  Notification.permission === 'granted';

/** Ajustes → Sistema: encender (pide permiso) o apagar. Devuelve si quedan activas. */
export async function cambiarNotificaciones(activar) {
  if (!activar) {
    guardar(CLAVE_PREF, '0');
    return false;
  }
  if (notificacionesPosibles() !== 'si') return false;
  const permiso =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  guardar(CLAVE_PREF, permiso === 'granted' ? '1' : '0');
  return permiso === 'granted';
}

let ultimoEstado = { sinLeer: 0, ultimo: 0 };

function pintarPunto(sinLeer) {
  const enlace = document.querySelector('cg-barra-inferior a[href="#/actividad"]');
  if (!enlace) return;
  if (sinLeer > 0) {
    enlace.setAttribute('data-aviso', t('avisos.sinLeer', { n: sinLeer }));
  } else enlace.removeAttribute('data-aviso');
}

function notificar(nuevos) {
  if (!notificacionesActivas() || document.visibilityState === 'visible') return;
  // Varios de golpe: uno solo que los cuenta (no una ristra de ventanas).
  const titulo = 'clipscout';
  const cuerpo =
    nuevos.length === 1 ? textoAviso(nuevos[0]) : t('avisos.varios', { n: nuevos.length });
  try {
    const n = new Notification(titulo, { body: cuerpo, icon: '/img/pwa/icono-192.png', tag: 'cs' });
    n.onclick = () => {
      window.focus();
      location.hash = '#/actividad/avisos';
      n.close();
    };
  } catch {
    /* algunos navegadores móviles solo dejan notificar desde un service worker */
  }
}

async function comprobar() {
  try {
    const r = await fetch('/api/avisos?desde=0', { headers: { 'X-Clipgeist': '1' } });
    if (!r.ok) return;
    const datos = await r.json();
    ultimoEstado = datos;
    pintarPunto(datos.sinLeer);
    const visto = Number(leer(CLAVE_VISTO, '-1'));
    // La primera vez en este navegador no se notifica lo de antes.
    if (visto >= 0 && datos.ultimo > visto) {
      notificar(datos.avisos.filter(a => a.id > visto && a.id > datos.leidoHasta));
    }
    if (datos.ultimo !== visto) guardar(CLAVE_VISTO, datos.ultimo);
    window.dispatchEvent(new CustomEvent('clipscout:avisos', { detail: datos }));
  } catch {
    /* sin conexión: se vuelve a intentar */
  }
}

/** Marca todo como leído (al mirar la pestaña Avisos) y quita el punto. */
export async function marcarLeidos() {
  if (!ultimoEstado.ultimo) return;
  try {
    await fetch('/api/avisos/leidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clipgeist': '1' },
      body: JSON.stringify({ hasta: ultimoEstado.ultimo }),
    });
    pintarPunto(0);
  } catch {
    /* se reintenta la próxima vez */
  }
}

export const comprobarAvisos = comprobar;

export function iniciarAvisos() {
  comprobar();
  setInterval(() => {
    // Con la página oculta también, si se pidieron notificaciones (es cuando sirven).
    if (document.visibilityState === 'visible' || notificacionesActivas()) comprobar();
  }, CADA_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') comprobar();
  });
}
