/**
 * Hojas inferiores sencillas sobre el componente común <cg-hoja>: el menú «⋯» de una fila
 * (acciones grandes, una por fila) y una hoja con contenido propio. Se crean al abrir y se quitan
 * del documento al cerrarse, así no se acumulan.
 */
import { el } from './dom.js';

/** Hoja con `contenido` (nodos) y un pie opcional. Devuelve el elemento <cg-hoja>. */
export function abrirHoja({ titulo, contenido = [], pie = [], clase = '' }) {
  const hoja = document.createElement('cg-hoja');
  hoja.setAttribute('titulo', titulo);
  if (clase) hoja.className = clase;
  hoja.append(...contenido);
  if (pie.length) {
    hoja.append(el('div', { className: 'cs-hoja-pie', attrs: { slot: 'pie' }, children: pie }));
  }
  hoja.addEventListener('cg-cerrar', () => setTimeout(() => hoja.remove(), 400), { once: true });
  document.body.append(hoja);
  hoja.abrir();
  return hoja;
}

/**
 * Menú «⋯»: una lista de acciones grandes. Cada acción `{ texto, fn, peligro, detalle }`; la hoja
 * se cierra antes de ejecutarla (así un diálogo de confirmación no queda debajo).
 */
export function menuAcciones({ titulo, acciones, subtitulo = '' }) {
  let hoja = null;
  const botones = acciones.filter(Boolean).map(a =>
    el('button', {
      className: `cs-menu-accion${a.peligro ? ' cs-menu-accion--peligro' : ''}`,
      attrs: { type: 'button' },
      children: [
        el('span', { text: a.texto }),
        a.detalle ? el('small', { text: a.detalle }) : null,
      ],
      on: {
        click: () => {
          hoja?.cerrar();
          a.fn();
        },
      },
    })
  );
  hoja = abrirHoja({
    titulo,
    contenido: [
      subtitulo ? el('p', { className: 'cs-menu-sub', text: subtitulo }) : null,
      el('div', { className: 'cs-menu-lista', children: botones }),
    ].filter(Boolean),
  });
  return hoja;
}
