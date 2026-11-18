/**
 * Cabecera de una fila (48 px) de cada pantalla, con el componente común <cg-cabecera>: título a
 * la izquierda y acciones a la derecha. Las otras apps de Clipgeist (y la guía, «Salir») ya no van
 * en el logo: son el último botón de la barra, «Apps», igual en las tres apps.
 */
import { el } from './dom.js';
import { t, alCambiarIdioma } from './i18n/index.js';

/**
 * `<cg-cabecera>` con título traducido. `tituloClave` puede cambiarse luego con `poner(clave)`.
 * `atras`: href al que vuelve el botón «Atrás» (si no, no hay botón). `acciones`: nodos extra.
 */
export function crearCabecera({ tituloClave, id, atras = null, acciones = [] }) {
  const h1 = el('h1', { className: 'cg-cabecera-titulo', attrs: id ? { id } : {} });
  const cab = document.createElement('cg-cabecera');
  if (atras) cab.setAttribute('atras', '');
  cab.append(h1, el('div', { className: 'cs-cabecera-acciones', children: [...acciones] }));
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
