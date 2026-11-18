/**
 * Ajustes → Búsqueda → Sitios: una fila por sitio con su interruptor, sus cifras, su salud y «⋯»
 * (editar, volver a configurar, borrar). Sale de ajustes.js (CS-22); no depende de su estado.
 */

import { ajustes, getProfiles, saveProfiles } from '../../api.js';
import { altaSitiosDialog } from '../../components/altaSitios.js';
import { el, toast } from '../../dom.js';
import { t, tp } from '../../i18n/index.js';
import { menuAcciones } from '../../hojas.js';

/* ── Sitios: opciones por sitio ────────────────────────────────────── */

/** «Sin resultados en las 2 últimas búsquedas (la última con resultados: 12/11)». */
function textoSalud(salud) {
  const desde = salud.ultimaConResultados
    ? t('aj.sitios.roto.desde', {
        fecha: new Date(salud.ultimaConResultados).toLocaleDateString(),
      })
    : '';
  const error = salud.ultimoError ? ` (${salud.ultimoError})` : '';
  return `${t('aj.sitios.roto', { n: salud.cerosSeguidos })}${error}${desde}`;
}

export function tarjetaSitios() {
  const lista = el('ul', { className: 'cs-sitios' });
  async function cargarSitios() {
    let datos;
    try {
      datos = await ajustes.sitios();
    } catch (error) {
      lista.replaceChildren(el('li', { className: 'ajustes-error', text: error.message }));
      return;
    }
    if (!datos.sitios.length) {
      lista.replaceChildren(
        el('li', { className: 'cs-vacio', children: [el('p', { text: t('aj.sitios.vacio') })] })
      );
      return;
    }
    lista.replaceChildren(...datos.sitios.map(filaSitio));
  }

  /**
   * Una fila por sitio: nombre, dominio y dos cifras; un interruptor grande (buscar en él por
   * defecto: la única forma de apagar un sitio, guardada en el servidor) y «⋯» con el resto.
   */
  function filaSitio(s) {
    const e = s.estadisticas || {};
    const cifras = s.estadisticas
      ? [
          tp('aj.sitios.busquedas', e.busquedas || 0),
          tp('aj.sitios.resultados', e.resultados || 0),
          e.resultados
            ? t('aj.sitios.conDuracion', {
                n: Math.round((100 * (e.conDuracion || 0)) / e.resultados),
              })
            : null,
          e.bloqueos ? tp('aj.sitios.bloqueos', e.bloqueos) : null,
          tp('aj.sitios.enviados', e.enviadosJd || 0),
          e.yaLoTenias ? tp('aj.sitios.yaLoTenias', e.yaLoTenias) : null,
          e.fallidosJd ? tp('aj.sitios.fallidos', e.fallidosJd) : null,
        ].filter(Boolean)
      : [t('aj.sitios.sinDatos')];
    const interruptor = el('input', {
      attrs: {
        type: 'checkbox',
        role: 'switch',
        'aria-label': t('aj.sitios.activo', { nombre: s.nombre }),
      },
    });
    interruptor.checked = !s.fueraPorDefecto;
    interruptor.addEventListener('change', async () => {
      try {
        await ajustes.guardarSitio(s.dominio, { fueraPorDefecto: !interruptor.checked });
        s.fueraPorDefecto = !interruptor.checked;
        toast(
          t(interruptor.checked ? 'aj.sitios.encendido' : 'aj.sitios.apagado', {
            nombre: s.nombre,
          })
        );
      } catch (error) {
        interruptor.checked = !interruptor.checked;
        toast(error.message, 'error', 6000);
      }
    });
    const mas = el('button', {
      className: 'cg-boton cg-boton--icono cg-boton--fantasma',
      attrs: {
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-label': t('aj.sitios.mas', { nombre: s.nombre }),
        title: t('aj.sitios.mas', { nombre: s.nombre }),
      },
      text: '⋯',
      on: {
        click: () =>
          menuAcciones({
            titulo: s.nombre,
            subtitulo: `${s.dominio} · ${cifras.join(' · ')}`,
            acciones: [
              {
                texto: t('aj.sitios.editar'),
                detalle: t('aj.sitios.editar.detalle'),
                fn: () => {
                  location.hash = `#/explorer/${s.id}`;
                },
              },
              {
                texto: t('aj.sitios.reconfigurar'),
                detalle: t('aj.sitios.reconfigurar.detalle'),
                fn: () => reconfigurar(s),
              },
              {
                texto: t(s.jdDirecto ? 'aj.sitios.directo.quitar' : 'aj.sitios.directo.poner'),
                detalle: t('aj.sitios.directo.hint'),
                fn: async () => {
                  try {
                    await ajustes.guardarSitio(s.dominio, { jdDirecto: !s.jdDirecto });
                    s.jdDirecto = !s.jdDirecto;
                    toast(t('aj.guardado'));
                  } catch (error) {
                    toast(error.message, 'error', 6000);
                  }
                },
              },
              { texto: t('aj.sitios.borrar'), peligro: true, fn: () => borrarSitio(s) },
            ],
          }),
      },
    });
    // CS-17: dejó de dar resultados (dos búsquedas seguidas sin nada): aviso y «Volver a configurar».
    const aviso = s.salud?.aviso
      ? el('div', {
          className: 'cs-sitio__aviso',
          attrs: { role: 'note' },
          children: [
            el('span', { text: textoSalud(s.salud) }),
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('aj.sitios.reconfigurar'),
              on: { click: () => reconfigurar(s) },
            }),
          ],
        })
      : null;
    return el('li', {
      className: `cs-sitio${s.fueraPorDefecto ? ' cs-sitio--apagado' : ''}${aviso ? ' cs-sitio--roto' : ''}`,
      children: [
        el('div', {
          className: 'cs-sitio__texto',
          children: [
            el('strong', { text: aviso ? `⚠ ${s.nombre}` : s.nombre }),
            el('span', { text: [s.dominio, ...cifras.slice(0, 2)].join(' · ') }),
          ],
        }),
        el('label', { className: 'cs-interruptor', children: [interruptor, el('span')] }),
        mas,
        aviso,
      ],
    });
  }

  /** Vuelve a hacer el alta automática del sitio y, si da vídeos, cambia su configuración. */
  async function reconfigurar(s) {
    const n = await altaSitiosDialog({ dominios: [s.dominio], reconfigurar: true });
    if (n > 0) {
      toast(t('aj.sitios.reconfigurado', { nombre: s.nombre }), 'success', 4000);
      cargarSitios();
    }
  }

  /** Borrar un sitio no se deshace (su configuración se pierde): mantener pulsado. */
  async function borrarSitio(s) {
    const si = await window.cgConfirmar({
      titulo: t('aj.sitios.borrar'),
      texto: t('aj.sitios.borrarConfirmar', { nombre: s.nombre, dominio: s.dominio }),
      aceptar: t('aj.sitios.borrar'),
      peligro: true,
      mantener: true,
    });
    if (!si) return;
    try {
      const { profiles = [] } = await getProfiles();
      // El id es la posición en la lista (CS-07): se comprueba que sigue siendo el mismo dominio.
      const perfil = profiles[s.id];
      if (!perfil || !String(perfil.config?.searchUrl || '').includes(s.dominio)) {
        throw new Error(t('aj.sitios.cambio'));
      }
      await saveProfiles(profiles.filter((_, i) => i !== s.id));
      toast(t('aj.sitios.borrado', { nombre: s.nombre }));
      cargarSitios();
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }

  cargarSitios();
  return el('section', {
    className: 'card',
    attrs: { id: 'ajustes-sitios' },
    children: [
      el('div', {
        className: 'card__header',
        children: [el('h3', { className: 'card__title', text: t('aj.sitios.titulo') })],
      }),
      el('div', {
        className: 'card__body',
        children: [
          lista,
          // La explicación, debajo: en el móvil los sitios tienen que verse nada más entrar.
          el('p', { className: 'cs-nota', text: t('aj.sitios.hint.corto') }),
          el('div', {
            className: 'cs-fila-botones',
            children: [
              el('button', {
                className: 'cg-boton cg-boton--principal',
                attrs: { type: 'button' },
                text: t('buscar.agregarSitios'),
                on: {
                  click: async () => {
                    const n = await altaSitiosDialog();
                    if (n > 0) cargarSitios();
                  },
                },
              }),
              el('button', {
                className: 'cg-boton cg-boton--fantasma',
                attrs: { type: 'button' },
                text: t('aj.sitios.cero'),
                on: {
                  click: async () => {
                    const si = await window.cgConfirmar({
                      titulo: t('aj.sitios.cero'),
                      texto: t('aj.sitios.ceroConfirmar'),
                      aceptar: t('aj.sitios.cero'),
                      peligro: true,
                      mantener: true,
                    });
                    if (!si) return;
                    await ajustes.ponerACeroEstadisticas();
                    cargarSitios();
                  },
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/* ── Filtros globales ──────────────────────────────────────────────── */
