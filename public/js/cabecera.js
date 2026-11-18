/**
 * Cabecera de una fila (48 px) de cada pantalla, con el componente común <cg-cabecera>: título a
 * la izquierda, acciones y el logo a la derecha. El logo abre el menú de Clipgeist (las otras
 * apps, la guía, «Salir»), que en el móvil sustituye a la cabecera antigua de dos filas.
 */
import { el } from './dom.js';
import { t, alCambiarIdioma } from './i18n/index.js';

/** Abre la hoja de apps de index.html (#hoja-apps). */
export function abrirMenuApps() {
  document.getElementById('hoja-apps')?.abrir?.();
}

/** El botón del logo, igual en todas las cabeceras. */
export function botonLogo() {
  const boton = el('button', {
    className: 'cs-logo',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    children: [el('img', { attrs: { src: '/img/logo.png', alt: '', width: 30, height: 30 } })],
    on: { click: abrirMenuApps },
  });
  const rotular = () => {
    boton.setAttribute('aria-label', t('crew.aria'));
    boton.title = t('crew.aria');
  };
  rotular();
  alCambiarIdioma(rotular);
  return boton;
}

/**
 * `<cg-cabecera>` con título traducido. `tituloClave` puede cambiarse luego con `poner(clave)`.
 * `atras`: href al que vuelve el botón «Atrás» (si no, no hay botón). `acciones`: nodos extra.
 */
export function crearCabecera({ tituloClave, id, atras = null, acciones = [] }) {
  const h1 = el('h1', { className: 'cg-cabecera-titulo', attrs: id ? { id } : {} });
  const cab = document.createElement('cg-cabecera');
  if (atras) cab.setAttribute('atras', '');
  cab.append(h1, el('div', { className: 'cs-cabecera-acciones', children: [...acciones] }));
  cab.querySelector('.cs-cabecera-acciones').append(botonLogo());
  let clave = tituloClave;
  let destino = atras;
  const pintar = () => {
    h1.textContent = t(clave);
  };
  pintar();
  alCambiarIdioma(pintar);
  // «Atrás» va a un sitio fijo (no a la página anterior del historial, que puede ser otra web).
  cab.addEventListener('cg-atras', e => {
    if (!destino) return;
    e.preventDefault();
    location.hash = destino;
  });
  return {
    nodo: cab,
    poner(nuevaClave) {
      clave = nuevaClave;
      pintar();
    },
    atras(nuevoDestino) {
      destino = nuevoDestino;
      // El botón lo crea el componente al montarse (según el atributo): se esconde por CSS, así
      // vale también antes de que exista.
      cab.toggleAttribute('data-sin-atras', !nuevoDestino);
    },
  };
}
