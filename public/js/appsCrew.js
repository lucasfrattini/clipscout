/**
 * La hoja «Apps» (el último botón de la barra): las tres apps de Clipgeist y «Salir». Vivía dentro
 * de la vista Ajustes, así que para pintar esta hoja al arrancar había que cargar Ajustes entera
 * (CS-15/CS-22); ahora es un módulo pequeño y Ajustes se carga al abrirla.
 */

import { ajustes, estadoAcceso } from './api.js';
import { el } from './dom.js';
import { t } from './i18n/index.js';
import { urlDeApp } from './unaMano.js';

/** Avisa a la hoja de que cambiaron las conexiones (para repintar sus iconos). */
const EVENTO = 'clipscout:conexiones';
export const avisarCambio = () => window.dispatchEvent(new Event(EVENTO));

/**
 * Las tres apps de Clipgeist, en el menú del logo (hoja #hoja-apps): la actual marcada y las que no
 * están conectadas, apagadas. La dirección de cada una es la guardada, pero vista DESDE ESTE
 * NAVEGADOR: si es «localhost» o el nombre del contenedor, se usa la máquina desde la que se mira
 * clipscout (antes, desde el móvil apuntaban al propio teléfono y no abrían nada).
 */
export function initCrewCabecera(contenedor) {
  const pintar = async () => {
    let conexiones = [];
    try {
      conexiones = await ajustes.conexiones();
    } catch {
      conexiones = [];
    }
    const icono = app =>
      el('img', { attrs: { src: `/img/crew/${app}.png`, alt: app, width: 36, height: 36 } });
    const contenido = (app, detalle) => [
      icono(app),
      el('span', {
        className: 'cs-app__texto',
        children: [el('strong', { text: app }), el('small', { text: detalle })],
      }),
    ];
    contenedor.replaceChildren(
      ...['clipscout', 'clonbuster', 'clipkeeper'].map(app => {
        if (app === 'clipscout') {
          return el('span', {
            className: 'cc-app cs-app actual',
            attrs: { 'aria-current': 'page' },
            children: contenido(app, t('crew.estasAqui')),
          });
        }
        const c = conexiones.find(x => x.app === app);
        return c
          ? el('a', {
              className: 'cc-app cs-app',
              attrs: {
                href: urlDeApp(c.url, window.location.hostname),
                title: t('crew.ir', { nombre: c.nombre }),
              },
              children: contenido(app, c.nombre || t('crew.ir', { nombre: app })),
            })
          : el('span', {
              className: 'cc-app cs-app apagada',
              children: contenido(app, t('crew.sinConectar')),
            });
      })
    );
  };
  window.addEventListener(EVENTO, pintar);
  botonSalir(contenedor.parentElement.querySelector('.cs-apps-acciones'));
  return pintar();
}

/**
 * «Salir», en el menú del logo (en el mismo sitio en las tres apps). Solo si hay contraseña: sin
 * ella no hay sesión que cerrar.
 */
async function botonSalir(destino) {
  const estado = await estadoAcceso();
  if (!destino || !estado.protegido || destino.querySelector('.cs-salir')) return;
  destino.append(
    el('button', {
      className: 'cg-boton cs-salir',
      attrs: {
        type: 'button',
        title: estado.usuario ? t('cab.cerrarSesion', { usuario: estado.usuario }) : '',
      },
      text: t('cab.salir'),
      on: {
        click: async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          location.replace('/login');
        },
      },
    })
  );
}
