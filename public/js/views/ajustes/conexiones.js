/**
 * Ajustes → Clipgeist → Conexiones con las otras apps: la lista (estado, versión y si es demasiado
 * antigua para esta, SU-13), revocar, quitar y el formulario de alta. Sale de ajustes.js (CS-22).
 * `pintar` repinta la sección; `campo` es el constructor de campos de Ajustes.
 */

import { ajustes, sistema } from '../../api.js';
import { avisarCambio } from '../../appsCrew.js';
import { confirmDialog } from '../../components/dialog.js';
import { el, toast } from '../../dom.js';
import { t } from '../../i18n/index.js';
import { avisoCompatibilidad } from './sistema.js';

const APPS = ['clipkeeper', 'clonbuster', 'clipscout'];
const PUERTOS = { clipkeeper: 8096, clonbuster: 8095, clipscout: 3001 };

export function crearConexiones({ pintar, campo }) {
  let formularioAbierto = false;

  /* ── Conexiones ────────────────────────────────────────────────────── */

  function tarjetaConexiones() {
    const lista = el('ul', { className: 'ajustes-conexiones' });
    const cuerpo = el('div', {
      className: 'card__body',
      children: [formularioAbierto ? formulario() : null, lista],
    });
    cargarConexiones(lista);
    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header card__header--con-cierre',
          children: [
            el('div', {
              children: [
                el('h3', { className: 'card__title', text: t('aj.con.titulo') }),
                el('p', { className: 'card__hint', text: t('aj.con.hint') }),
              ],
            }),
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('aj.con.anadir'),
              on: {
                click: () => {
                  formularioAbierto = true;
                  pintar();
                },
              },
            }),
          ],
        }),
        cuerpo,
      ],
    });
  }

  async function cargarConexiones(lista) {
    let conexiones = [];
    try {
      conexiones = await ajustes.conexiones();
    } catch (error) {
      toast(error.message, 'error', 6000);
      return;
    }
    if (conexiones.length === 0) {
      lista.replaceChildren(
        el('li', {
          className: 'ajustes-conexiones__vacio',
          children: [
            el('img', {
              attrs: { src: '/img/crew/clipgeist.png', alt: '', width: 64, height: 64 },
            }),
            el('span', { text: t('aj.con.vacio') }),
          ],
        })
      );
      return;
    }
    lista.replaceChildren(...conexiones.map(filaConexion));
  }

  /** Versiones mínimas de las otras apps que pide esta (SU-13): se piden una vez. */
  let minimas = null;
  const leerMinimas = () =>
    (minimas ||= sistema
      .actualizaciones()
      .then(e => e.minimas || {})
      .catch(() => ({})));

  function filaConexion(c) {
    const pill = el('span', { className: 'ajustes-pill', text: t('aj.con.comprobando') });
    const error = el('span', { className: 'ajustes-error' });
    const vieja = el('span', { className: 'ajustes-aviso', attrs: { hidden: '' } });
    const comprobar = async () => {
      pill.className = 'ajustes-pill';
      pill.textContent = t('aj.con.comprobando');
      let r;
      try {
        r = await ajustes.estado(c.id);
      } catch (e) {
        r = { ok: false, error: e.message };
      }
      pill.className = `ajustes-pill ${r.ok ? 'ajustes-pill--ok' : 'ajustes-pill--mal'}`;
      pill.textContent = r.ok
        ? t('aj.con.conectada', { version: r.version })
        : t('aj.con.sinConexion');
      error.textContent = r.ok ? '' : r.error;
      const aviso = r.ok ? avisoCompatibilidad(c.app, r.version, await leerMinimas()) : '';
      vieja.textContent = aviso;
      vieja.hidden = !aviso;
    };
    comprobar();
    return el('li', {
      children: [
        el('img', { attrs: { src: `/img/crew/${c.app}.png`, alt: '', width: 44, height: 44 } }),
        el('div', {
          className: 'ajustes-conexiones__datos',
          children: [
            el('b', { text: c.nombre }),
            c.auto
              ? el('span', {
                  className: 'field__hint',
                  text: ` ${t('aj.con.auto')}`,
                  attrs: { title: t('aj.con.auto.titulo') },
                })
              : null,
            el('span', {
              className: 'field__hint',
              children: [
                `${c.app} · `,
                el('a', { className: 'cs-enlace-tactil', attrs: { href: c.url }, text: c.url }),
              ],
            }),
            el('span', {
              className: 'field__hint',
              text: [
                t(c.clave_conexion ? 'aj.con.claveConexion' : 'aj.con.claveAntigua'),
                c.entrada ? '' : ` · ${t('aj.con.sinEntrada')}`,
              ].join(''),
            }),
            error,
            vieja,
          ],
        }),
        pill,
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('aj.con.probar'),
              on: { click: comprobar },
            }),
            c.entrada
              ? el('button', {
                  className: 'cg-boton',
                  attrs: { type: 'button' },
                  text: t('aj.con.revocar'),
                  on: {
                    click: async () => {
                      if (
                        !(await confirmDialog({
                          titleKey: 'aj.con.revocar',
                          bodyKey: 'aj.con.revocarConfirmar',
                          bodyParams: { nombre: c.nombre },
                          variant: 'danger',
                        }))
                      ) {
                        return;
                      }
                      try {
                        await ajustes.revocar(c.id);
                        toast(t('aj.con.revocada'));
                      } catch (error) {
                        toast(error.message, 'error', 6000);
                      }
                      pintar();
                    },
                  },
                })
              : null,
            el('button', {
              className: 'cg-boton ajustes-peligro',
              attrs: { type: 'button' },
              text: t('aj.con.quitar'),
              on: {
                click: async () => {
                  if (
                    !(await confirmDialog({
                      titleKey: 'aj.con.quitar',
                      bodyKey: 'aj.con.quitarConfirmar',
                      bodyParams: { nombre: c.nombre },
                      variant: 'danger',
                    }))
                  ) {
                    return;
                  }
                  await ajustes.quitar(c.id);
                  toast(t('aj.con.quitada'));
                  avisarCambio();
                  pintar();
                },
              },
            }),
          ],
        }),
      ],
    });
  }

  function formulario() {
    const app = el('select', {
      className: 'input',
      children: APPS.map(a =>
        el('option', { attrs: { value: a }, text: `${a} — ${t(`aj.app.${a}`)}` })
      ),
    });
    const url = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', value: urlSugerida('clipkeeper') },
    });
    const clave = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', autocomplete: 'off' },
    });
    const nombre = el('input', {
      className: 'input',
      attrs: { type: 'text', placeholder: t('aj.con.nombre.placeholder') },
    });
    const reciproca = el('input', { attrs: { type: 'checkbox', checked: true } });
    const resultado = el('p', { className: 'ajustes-resultado' });
    app.addEventListener('change', () => {
      url.value = urlSugerida(app.value);
    });
    const datos = () => ({
      app: app.value,
      url: url.value,
      api_key: clave.value,
      nombre: nombre.value,
      reciproca: reciproca.checked,
    });
    const mostrar = r => {
      resultado.className = `ajustes-resultado ${r.ok ? 'ajustes-resultado--ok' : 'ajustes-resultado--mal'}`;
      resultado.textContent = r.ok
        ? t('aj.con.responde', { instancia: r.instancia, app: r.app, version: r.version })
        : r.error;
    };
    return el('form', {
      className: 'ajustes-form ajustes-nueva',
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            const r = await ajustes.conectar(datos());
            if (r.reciproca && !r.reciproca.ok) {
              toast(t('aj.con.vueltaError', { error: r.reciproca.error }), 'error', 6000);
            } else {
              toast(t(datos().reciproca ? 'aj.con.dos' : 'aj.con.guardada'));
            }
            formularioAbierto = false;
            avisarCambio();
            pintar();
          } catch (error) {
            mostrar({ ok: false, error: error.message });
          }
        },
      },
      children: [
        campo(t('aj.con.app'), app),
        campo(t('aj.con.url'), url),
        campo(t('aj.con.clave'), clave, t('aj.con.clave.hint')),
        campo(t('aj.con.nombre'), nombre),
        el('label', { className: 'ajustes-casilla', children: [reciproca, t('aj.con.reciproca')] }),
        resultado,
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'cg-boton cg-boton--fantasma',
              attrs: { type: 'button' },
              text: t('aj.con.cancelar'),
              on: {
                click: () => {
                  formularioAbierto = false;
                  pintar();
                },
              },
            }),
            el('span', { className: 'ajustes-separador' }),
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('aj.con.probar'),
              on: {
                click: async () => {
                  try {
                    mostrar(await ajustes.probar(datos()));
                  } catch (error) {
                    mostrar({ ok: false, error: error.message });
                  }
                },
              },
            }),
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'submit' },
              text: t('aj.con.guardar'),
            }),
          ],
        }),
      ],
    });
  }

  function urlSugerida(app) {
    return `http://${window.location.hostname}:${PUERTOS[app]}`;
  }
  return { tarjetaConexiones };
}
