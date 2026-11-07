/**
 * Vista Ajustes: identidad de esta instancia, clave de API y conexiones con
 * las otras apps de clip crew (clonbuster, clipkeeper), al estilo de las *arr.
 *
 * Todo se construye con `el()`: nada de innerHTML (regla del proyecto).
 */

import { ajustes } from '../api.js';
import { el, toast } from '../dom.js';
import { alCambiarIdioma, t } from '../i18n/index.js';

const APPS = ['clipkeeper', 'clonbuster', 'clipscout'];
const PUERTOS = { clipkeeper: 8096, clonbuster: 8095, clipscout: 3001 };

/** Avisa a la cabecera de que cambiaron las conexiones (para repintar sus iconos). */
const EVENTO = 'clipscout:conexiones';
export const avisarCambio = () => window.dispatchEvent(new Event(EVENTO));

export function createAjustesView(raiz) {
  let general = null;
  let claveVisible = false;
  let formularioAbierto = false;

  async function cargar() {
    try {
      general = await ajustes.general();
    } catch (error) {
      toast(error.message, 'error', 6000);
      return;
    }
    pintar();
  }

  function pintar() {
    raiz.replaceChildren(
      el('h2', {
        className: 'visually-hidden',
        attrs: { id: 'ajustes-heading' },
        text: t('nav.ajustes'),
      }),
      tarjetaGeneral(),
      tarjetaClave(),
      tarjetaConexiones()
    );
  }

  /* ── Esta app ──────────────────────────────────────────────────────── */

  function campo(etiqueta, input, ayuda) {
    return el('label', {
      className: 'field',
      children: [
        el('span', { className: 'field__label', text: etiqueta }),
        input,
        ayuda ? el('span', { className: 'field__hint', text: ayuda }) : null,
      ],
    });
  }

  function tarjetaGeneral() {
    const instancia = el('input', {
      className: 'input',
      attrs: { type: 'text', placeholder: t('aj.instancia.placeholder'), value: general.instancia },
    });
    const url = el('input', {
      className: 'input',
      attrs: {
        type: 'text',
        spellcheck: 'false',
        placeholder: general.url_detectada,
        value: general.url,
      },
    });
    const guardar = el('button', {
      className: 'button',
      attrs: { type: 'submit' },
      text: t('aj.guardar'),
    });
    const form = el('form', {
      className: 'card__body ajustes-form',
      children: [
        campo(t('aj.instancia.label'), instancia, t('aj.instancia.hint')),
        campo(t('aj.url.label'), url, t('aj.url.hint', { url: general.url_detectada })),
        guardar,
      ],
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            await ajustes.guardarGeneral({ instancia: instancia.value, url: url.value });
            toast(t('aj.guardado'));
            cargar();
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        },
      },
    });
    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.esta.titulo') }),
            el('p', {
              className: 'card__hint',
              text: t('aj.esta.hint', { app: general.app, version: general.version }),
            }),
          ],
        }),
        form,
      ],
    });
  }

  /* ── Clave de API ──────────────────────────────────────────────────── */

  function tarjetaClave() {
    const valor = el('code', {
      className: 'ajustes-clave__valor',
      text: claveVisible ? general.api_key : '•'.repeat(32),
    });
    const boton = (texto, onClick, extra = '') =>
      el('button', {
        className: `button button--secondary button--small ${extra}`,
        attrs: { type: 'button' },
        text: texto,
        on: { click: onClick },
      });
    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.clave.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.clave.hint') }),
          ],
        }),
        el('div', {
          className: 'card__body ajustes-clave',
          children: [
            valor,
            boton(t(claveVisible ? 'aj.clave.ocultar' : 'aj.clave.mostrar'), () => {
              claveVisible = !claveVisible;
              pintar();
            }),
            boton(t('aj.clave.copiar'), async () => {
              try {
                await navigator.clipboard.writeText(general.api_key);
                toast(t('aj.clave.copiada'));
              } catch {
                claveVisible = true;
                pintar();
                toast(t('aj.clave.noCopia'), 'error', 6000);
              }
            }),
            boton(
              t('aj.clave.regenerar'),
              async () => {
                if (!window.confirm(t('aj.clave.confirmar'))) return;
                const r = await ajustes.regenerarClave();
                general.api_key = r.api_key;
                claveVisible = true;
                pintar();
                toast(t('aj.clave.nueva'));
              },
              'ajustes-peligro'
            ),
          ],
        }),
      ],
    });
  }

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
              className: 'button button--small',
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
            el('img', { attrs: { src: '/img/crew/clipcrew.png', alt: '', width: 64, height: 64 } }),
            el('span', { text: t('aj.con.vacio') }),
          ],
        })
      );
      return;
    }
    lista.replaceChildren(...conexiones.map(filaConexion));
  }

  function filaConexion(c) {
    const pill = el('span', { className: 'ajustes-pill', text: t('aj.con.comprobando') });
    const error = el('span', { className: 'ajustes-error' });
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
    };
    comprobar();
    return el('li', {
      children: [
        el('img', { attrs: { src: `/img/crew/${c.app}.png`, alt: '', width: 44, height: 44 } }),
        el('div', {
          className: 'ajustes-conexiones__datos',
          children: [
            el('b', { text: c.nombre }),
            el('span', {
              className: 'field__hint',
              children: [`${c.app} · `, el('a', { attrs: { href: c.url }, text: c.url })],
            }),
            error,
          ],
        }),
        pill,
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'button button--secondary button--small',
              attrs: { type: 'button' },
              text: t('aj.con.probar'),
              on: { click: comprobar },
            }),
            el('button', {
              className: 'button button--secondary button--small ajustes-peligro',
              attrs: { type: 'button' },
              text: t('aj.con.quitar'),
              on: {
                click: async () => {
                  if (!window.confirm(t('aj.con.quitarConfirmar', { nombre: c.nombre }))) return;
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
              className: 'button button--ghost button--small',
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
              className: 'button button--secondary button--small',
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
              className: 'button button--small',
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

  alCambiarIdioma(() => {
    if (general) pintar();
  });

  return {
    focus() {
      cargar();
    },
  };
}

/**
 * Selector común de clip crew en la cabecera: las tres apps siempre, la actual
 * resaltada y las que no están conectadas, apagadas (igual en las tres apps).
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
      el('img', { attrs: { src: `/img/crew/${app}.png`, alt: app, width: 30, height: 30 } });
    contenedor.replaceChildren(
      ...['clipscout', 'clonbuster', 'clipkeeper'].map(app => {
        if (app === 'clipscout') {
          return el('span', {
            className: 'cc-app actual',
            attrs: { title: t('crew.actual', { app }) },
            children: [icono(app)],
          });
        }
        const c = conexiones.find(x => x.app === app);
        return c
          ? el('a', {
              className: 'cc-app',
              attrs: { href: c.url, title: t('crew.ir', { nombre: c.nombre }) },
              children: [icono(app)],
            })
          : el('span', {
              className: 'cc-app apagada',
              attrs: { title: t('crew.noConectada', { app }) },
              children: [icono(app)],
            });
      })
    );
  };
  window.addEventListener(EVENTO, pintar);
  pintar();
}
