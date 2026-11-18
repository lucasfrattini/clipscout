/**
 * Vista Ajustes: identidad de esta instancia, clave de API y conexiones con
 * las otras apps de Clipgeist (clonbuster, clipkeeper), al estilo de las *arr.
 *
 * Todo se construye con `el()`: nada de innerHTML (regla del proyecto).
 */

import { ajustes } from '../api.js';
import { confirmDialog } from '../components/dialog.js';
import { el, toast } from '../dom.js';
import { alCambiarIdioma, cambiarIdioma, idiomaActual, IDIOMAS, t } from '../i18n/index.js';
import { cambiarTema, temaGuardado, TEMAS } from '../tema.js';
import { crearCabecera } from '../cabecera.js';
import { seccionAjustes, SECCIONES_AJUSTES } from '../unaMano.js';
import {
  tarjetaAcercaDe,
  tarjetaCopiaSuite,
  tarjetaDiagnostico,
  tarjetaNotificaciones,
  tarjetaRespaldos,
} from './ajustes/sistema.js';
import { tarjetaSitios } from './ajustes/sitios.js';
import { crearConexiones } from './ajustes/conexiones.js';

export function createAjustesView(raiz) {
  let general = null;
  let claveVisible = false;

  let estadoAcceso = { protegido: false, delEntorno: false, usuario: '' };

  async function cargar() {
    try {
      general = await ajustes.general();
      estadoAcceso = await (await fetch('/api/auth/estado')).json();
    } catch (error) {
      toast(error.message, 'error', 6000);
      return;
    }
    pintar();
  }

  /*
   * Fase 3: de 9 secciones a 4 (Búsqueda · Descargas · Clipgeist · Sistema). En el móvil,
   * #/ajustes es la lista de secciones (filas grandes) y cada una se abre en su pantalla con
   * «Atrás»; en escritorio, menú a la izquierda y la sección a la derecha, como antes. Las
   * direcciones viejas (#/ajustes/sitios, /jdownloader…) llevan a la sección nueva.
   * Los paquetes enviados y las programadas pasaron a Actividad.
   */
  const SECCIONES = {
    busqueda: () => [
      tarjetaSitios(),
      tarjetaFiltros(),
      tarjetaBusqueda(),
      avisoMovido('programadas'),
    ],
    descargas: () => [tarjetaJd(), avisoMovido('descargas')],
    clipgeist: () => [tarjetaConexiones(), tarjetaClave()],
    sistema: () => [
      tarjetaProxy(),
      tarjetaApariencia(),
      tarjetaNotificaciones(),
      tarjetaAcceso(),
      tarjetaSesiones(),
      tarjetaGeneral(),
      tarjetaDiagnostico(),
      tarjetaRespaldos({ recargar: cargar }),
      tarjetaCopiaSuite({ recargar: cargar }),
      tarjetaAcercaDe({
        general,
        alCambiarVersiones: e =>
          window.dispatchEvent(new CustomEvent('clipscout:versiones', { detail: e })),
      }),
    ],
  };

  const pedida = () => window.location.hash.replace(/^#\/ajustes\/?/, '').split('/')[0];
  const esMovil = () => window.matchMedia('(max-width: 768px)').matches;
  /** La sección a enseñar; '' = el índice (solo en el móvil: en escritorio, la primera). */
  const seccionActual = () => seccionAjustes(pedida()) || (esMovil() ? '' : SECCIONES_AJUSTES[0]);

  const cabecera = crearCabecera({
    tituloClave: 'nav.ajustes',
    id: 'ajustes-heading',
    atras: '#/ajustes',
  });

  function pintar() {
    const actual = seccionActual();
    cabecera.poner(actual ? `aj.sec.${actual}` : 'nav.ajustes');
    cabecera.atras(actual && esMovil() ? '#/ajustes' : null);
    const menu = el('nav', {
      className: 'cc-ajustes-menu cs-ajustes-indice',
      attrs: { 'aria-label': t('nav.ajustes') },
      children: SECCIONES_AJUSTES.map(id =>
        el('a', {
          attrs: {
            href: `#/ajustes/${id}`,
            ...(id === actual ? { 'aria-current': 'page' } : {}),
          },
          children: [
            el('span', { className: 'cs-ajustes-indice__nombre', text: t(`aj.sec.${id}`) }),
            el('small', { text: t(`aj.sec.${id}.detalle`) }),
          ],
        })
      ),
    });
    raiz.replaceChildren(
      cabecera.nodo,
      el('div', {
        className: `cc-ajustes${actual ? '' : ' cs-ajustes--indice'}`,
        children: [
          menu,
          el('div', {
            className: 'cc-ajustes-panel',
            children: actual ? SECCIONES[actual]() : [],
          }),
        ],
      })
    );
  }

  /** Dónde quedó lo que antes estaba aquí. */
  function avisoMovido(pestana) {
    return el('section', {
      className: 'card cs-movido',
      children: [
        el('div', {
          className: 'card__body',
          children: [
            el('p', { text: t(`aj.movido.${pestana}`) }),
            el('a', {
              className: 'cg-boton',
              attrs: { href: `#/actividad/${pestana}` },
              text: t('aj.movido.ir'),
            }),
          ],
        }),
      ],
    });
  }

  window.addEventListener('hashchange', () => {
    if (general && window.location.hash.startsWith('#/ajustes')) pintar();
  });
  // Al cruzar el ancho del móvil cambia la forma (índice + pantalla, o menú + sección).
  window.matchMedia('(max-width: 768px)').addEventListener('change', () => {
    if (general && !raiz.hidden) pintar();
  });

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

  // Ajustes → Clipgeist → Conexiones (ajustes/conexiones.js): guarda si el formulario está abierto.
  const { tarjetaConexiones } = crearConexiones({ pintar: () => pintar(), campo });

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

  /* ── Acceso: usuario y contraseña ──────────────────────────────────── */

  function tarjetaAcceso() {
    const cabecera = el('div', {
      className: 'card__header',
      children: [
        el('h3', { className: 'card__title', text: t('aj.acceso.titulo') }),
        el('p', {
          className: 'card__hint',
          text: estadoAcceso.delEntorno
            ? t('aj.acceso.entorno', { usuario: estadoAcceso.usuario })
            : estadoAcceso.protegido
              ? t('aj.acceso.con', { usuario: estadoAcceso.usuario })
              : t('aj.acceso.sin'),
        }),
      ],
    });
    if (estadoAcceso.delEntorno) return el('section', { className: 'card', children: [cabecera] });
    const entrada = (tipo, autocompletar, valor = '') =>
      el('input', {
        className: 'input',
        attrs: { type: tipo, autocomplete: autocompletar, spellcheck: 'false', value: valor },
      });
    const usuario = entrada('text', 'username', estadoAcceso.usuario || 'admin');
    const nueva = entrada('password', 'new-password');
    const actual = entrada('password', 'current-password');
    const enviar = async (llamada, aviso) => {
      try {
        const r = await llamada();
        toast(t(aviso));
        estadoAcceso = r;
        // Con contraseña aparece «Salir» en la cabecera (y sin ella se va): se recarga entera.
        location.reload();
      } catch (error) {
        toast(error.message, 'error', 6000);
      }
    };
    const form = el('form', {
      className: 'card__body ajustes-form',
      attrs: { id: 'ajustes-acceso' },
      children: [
        campo(t('aj.acceso.usuario'), usuario),
        campo(
          t(estadoAcceso.protegido ? 'aj.acceso.nueva' : 'aj.acceso.contrasena'),
          nueva,
          t('aj.acceso.minimo')
        ),
        estadoAcceso.protegido ? campo(t('aj.acceso.actual'), actual) : null,
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'button button--small',
              attrs: { type: 'submit' },
              text: t(estadoAcceso.protegido ? 'aj.acceso.cambiar' : 'aj.acceso.poner'),
            }),
            estadoAcceso.protegido
              ? el('button', {
                  className: 'button button--small button--secondary ajustes-peligro',
                  attrs: { type: 'button' },
                  text: t('aj.acceso.quitar'),
                  on: {
                    click: () =>
                      enviar(
                        () => ajustes.quitarAcceso({ actual: actual.value }),
                        'aj.acceso.quitada'
                      ),
                  },
                })
              : null,
          ],
        }),
      ],
      on: {
        submit: e => {
          e.preventDefault();
          enviar(
            () =>
              ajustes.guardarAcceso({
                usuario: usuario.value,
                contrasena: nueva.value,
                actual: actual.value,
              }),
            'aj.acceso.guardada'
          );
        },
      },
    });
    return el('section', { className: 'card', children: [cabecera, form] });
  }

  /* ── Sesiones abiertas ─────────────────────────────────────────────── */

  function tarjetaSesiones() {
    const lista = el('ul', { className: 'ajustes-conexiones ajustes-sesiones' });
    const fecha = iso => new Date(iso).toLocaleString(idiomaActual());
    const cargarSesiones = async () => {
      let sesiones = [];
      try {
        ({ sesiones } = await ajustes.sesiones());
      } catch (error) {
        toast(error.message, 'error', 6000);
        return;
      }
      if (sesiones.length === 0) {
        lista.replaceChildren(
          el('li', { className: 'ajustes-conexiones__vacio', text: t('aj.ses.vacio') })
        );
        return;
      }
      lista.replaceChildren(
        ...sesiones.map(s =>
          el('li', {
            children: [
              el('div', {
                className: 'ajustes-conexiones__datos',
                children: [
                  el('b', {
                    text: s.esta ? `${s.dispositivo} · ${t('aj.ses.esta')}` : s.dispositivo,
                  }),
                  el('span', {
                    className: 'field__hint',
                    text: t('aj.ses.ultima', { fecha: fecha(s.ultima), ip: s.ip || '?' }),
                  }),
                ],
              }),
              s.esta
                ? null
                : el('button', {
                    className: 'button button--secondary button--small',
                    attrs: { type: 'button' },
                    text: t('aj.ses.cerrar'),
                    on: {
                      click: async () => {
                        try {
                          await ajustes.cerrarSesion(s.id);
                          toast(t('aj.ses.cerrada'));
                        } catch (error) {
                          toast(error.message, 'error', 6000);
                        }
                        cargarSesiones();
                      },
                    },
                  }),
            ],
          })
        )
      );
    };
    if (estadoAcceso.protegido) cargarSesiones();
    else {
      lista.replaceChildren(
        el('li', { className: 'ajustes-conexiones__vacio', text: t('aj.ses.vacio') })
      );
    }
    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header card__header--con-cierre',
          children: [
            el('div', {
              children: [
                el('h3', { className: 'card__title', text: t('aj.ses.titulo') }),
                el('p', { className: 'card__hint', text: t('aj.ses.hint') }),
              ],
            }),
            estadoAcceso.protegido
              ? el('button', {
                  className: 'button button--secondary button--small ajustes-peligro',
                  attrs: { type: 'button' },
                  text: t('aj.ses.cerrarDemas'),
                  on: {
                    click: async () => {
                      try {
                        const r = await ajustes.cerrarDemas();
                        toast(t('aj.ses.cerradas', { n: r.cerradas }));
                      } catch (error) {
                        toast(error.message, 'error', 6000);
                      }
                      cargarSesiones();
                    },
                  },
                })
              : null,
          ],
        }),
        el('div', { className: 'card__body', children: [lista] }),
      ],
    });
  }

  /* ── Clave de administración ───────────────────────────────────────── */

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
            // Con CLIPGEIST_CLAVE la clave es la del entorno, común a las tres apps: no se regenera aquí.
            general.clave_del_entorno
              ? el('span', { className: 'field__hint', text: t('aj.clave.entorno') })
              : null,
            general.clave_del_entorno
              ? null
              : boton(
                  t('aj.clave.regenerar'),
                  async () => {
                    if (
                      !(await confirmDialog({
                        titleKey: 'aj.clave.regenerar',
                        bodyKey: 'aj.clave.confirmar',
                        variant: 'danger',
                      }))
                    ) {
                      return;
                    }
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

  /* ── JDownloader ───────────────────────────────────────────────────── */

  function tarjetaJd() {
    const url = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', placeholder: 'http://192.168.1.10:3128' },
    });
    const autostart = el('input', { attrs: { type: 'checkbox', checked: true } });
    const biblioteca = el('select', {
      className: 'input',
      children: [el('option', { attrs: { value: '' }, text: t('aj.jd.biblioteca.ninguna') })],
    });
    let bibliotecaGuardada = null;
    ajustes
      .destinos()
      .then(d => {
        for (const b of d.bibliotecas || []) {
          biblioteca.append(
            el('option', { attrs: { value: String(b.id) }, text: `${b.nombre} — ${b.ruta}` })
          );
        }
        if (bibliotecaGuardada !== null) biblioteca.value = String(bibliotecaGuardada);
      })
      .catch(() => {});
    const resultado = el('p', { className: 'ajustes-resultado' });
    const mostrar = r => {
      resultado.className = `ajustes-resultado ${r.ok ? 'ajustes-resultado--ok' : 'ajustes-resultado--mal'}`;
      resultado.textContent = r.ok
        ? t('aj.jd.responde', { version: r.version, carpeta: r.carpeta })
        : r.error;
    };
    ajustes
      .jdownloader()
      .then(d => {
        url.value = d.url || '';
        autostart.checked = d.autostart !== false;
        bibliotecaGuardada = d.biblioteca ?? null;
        if (bibliotecaGuardada !== null) biblioteca.value = String(bibliotecaGuardada);
        if (d.url) ajustes.probarJd(d.url).then(mostrar, () => {});
      })
      .catch(() => {});
    const boton = (clave, tipo, onClick) =>
      el('button', {
        className: `button button--small ${tipo}`,
        attrs: { type: tipo ? 'button' : 'submit' },
        text: t(clave),
        on: onClick ? { click: onClick } : undefined,
      });
    const form = el('form', {
      className: 'card__body ajustes-form',
      children: [
        campo(t('aj.jd.url'), url, t('aj.jd.url.hint')),
        campo(t('aj.jd.biblioteca'), biblioteca, t('aj.jd.biblioteca.hint')),
        el('label', { className: 'ajustes-casilla', children: [autostart, t('aj.jd.autostart')] }),
        el('div', {
          className: 'ajustes-acciones',
          children: [
            boton('aj.con.probar', 'button--secondary', async () => {
              try {
                mostrar(await ajustes.probarJd(url.value));
              } catch (error) {
                mostrar({ ok: false, error: error.message });
              }
            }),
            boton('aj.guardar', ''),
          ],
        }),
        resultado,
      ],
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            await ajustes.guardarJd({
              url: url.value,
              autostart: autostart.checked,
              biblioteca: biblioteca.value === '' ? null : Number(biblioteca.value),
            });
            toast(t(url.value.trim() ? 'aj.jd.guardado' : 'aj.jd.quitado'));
            window.dispatchEvent(new Event('clipscout:jdownloader'));
            if (url.value.trim()) mostrar(await ajustes.probarJd(url.value));
            else resultado.textContent = '';
          } catch (error) {
            mostrar({ ok: false, error: error.message });
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
            el('h3', { className: 'card__title', text: t('aj.jd.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.jd.hint') }),
          ],
        }),
        form,
        el('div', { className: 'card__body', children: [guiaJd()] }),
      ],
    });
  }

  /** Cómo se monta JDownloader, paso a paso (plegado: solo lo abre quien lo necesita). */
  function guiaJd() {
    const PASOS = [
      'que',
      'instalar',
      'api',
      'docker',
      'conectar',
      'carpetas',
      'despues',
      'seguridad',
      'red',
    ];
    return el('details', {
      className: 'disclosure ajustes-guia',
      children: [
        el('summary', { className: 'disclosure__summary', text: t('aj.jd.guia') }),
        el('ol', {
          className: 'disclosure__content ajustes-guia__pasos',
          children: PASOS.map(p =>
            el('li', {
              children: [
                el('strong', { text: t(`aj.jd.guia.${p}.titulo`) }),
                ' ',
                t(`aj.jd.guia.${p}`),
              ],
            })
          ),
        }),
      ],
    });
  }

  /* ── Apariencia: idioma y tema ─────────────────────────────────────── */

  function tarjetaApariencia() {
    const idioma = el('select', {
      className: 'input',
      children: IDIOMAS.map(i =>
        el('option', { attrs: { value: i }, text: i === 'es' ? 'Español' : 'English' })
      ),
      on: { change: e => cambiarIdioma(e.target.value) },
    });
    idioma.value = idiomaActual();
    const tema = el('select', {
      className: 'input',
      children: TEMAS.map(x => el('option', { attrs: { value: x }, text: t(`tema.modo.${x}`) })),
      on: { change: e => cambiarTema(e.target.value) },
    });
    tema.value = temaGuardado();
    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header',
          children: [el('h3', { className: 'card__title', text: t('aj.apar.titulo') })],
        }),
        el('div', {
          className: 'card__body ajustes-form',
          children: [
            campo(t('aj.apar.idioma'), idioma),
            campo(t('aj.apar.tema'), tema, t('aj.apar.hint')),
          ],
        }),
      ],
    });
  }

  /* ── Proxy de salida: ¿responde? ───────────────────────────────────── */

  function tarjetaProxy() {
    const estadoP = el('p', { className: 'ajustes-resultado', attrs: { 'aria-live': 'polite' } });
    const cuando = el('p', { className: 'field__hint' });
    // CS-N11: la dirección del proxy se escribe aquí (antes solo con OUTBOUND_PROXY).
    const direccion = el('input', {
      className: 'input',
      attrs: {
        type: 'url',
        spellcheck: 'false',
        autocomplete: 'off',
        placeholder: 'http://equipo:8888',
        'aria-label': t('aj.proxy.direccion'),
      },
    });
    const salida = el('p', { className: 'field__hint', attrs: { 'aria-live': 'polite' } });
    const origenP = el('p', { className: 'field__hint' });
    const guardarP = el('button', {
      className: 'cg-boton cg-boton--principal',
      attrs: { type: 'button' },
      text: t('aj.guardar'),
    });
    const volver = el('button', {
      className: 'cg-boton',
      attrs: { type: 'button', hidden: '' },
      text: t('aj.proxy.entorno'),
    });
    const probar = el('button', {
      className: 'cg-boton',
      attrs: { type: 'button' },
      text: t('aj.proxy.probar'),
    });
    const pintarEstado = e => {
      // La dirección guardada lleva la contraseña oculta: no se pisa lo que se esté escribiendo.
      if (document.activeElement !== direccion) direccion.value = e.proxy || '';
      origenP.textContent = e.origen === 'entorno' ? t('aj.proxy.delEntorno') : '';
      volver.hidden = e.origen !== 'ajustes';
      if (e.salida) {
        salida.textContent = e.salida.ip
          ? t(e.configurado ? 'aj.proxy.salida' : 'aj.proxy.salidaDirecta', { ip: e.salida.ip })
          : t('aj.proxy.salidaNo');
      }
      cuando.textContent = e.comprobado
        ? t('aj.proxy.cuando', { cuando: new Date(e.comprobado).toLocaleString() })
        : '';
      let clase = '';
      let txt;
      if (!e.configurado) txt = t('aj.proxy.sin');
      else if (e.ok === null) txt = t('aj.proxy.sinProbar');
      else if (e.ok) {
        clase = ' ajustes-resultado--ok';
        txt = t('aj.proxy.ok', { ms: e.ms ?? '—' });
      } else {
        clase = ' ajustes-resultado--mal';
        txt = t('aj.proxy.mal', { error: e.error || '—' });
      }
      estadoP.className = `ajustes-resultado${clase}`;
      estadoP.textContent = e.configurado && e.proxy ? `${e.proxy} — ${txt}` : txt;
    };
    probar.addEventListener('click', async () => {
      probar.disabled = true;
      salida.textContent = t('aj.proxy.probando');
      try {
        const r = await ajustes.probarProxy();
        if (!r.salida) salida.textContent = ''; // el proxy no responde: lo dice el estado
        pintarEstado(r);
      } catch (error) {
        salida.textContent = '';
        toast(error.message, 'error', 6000);
      } finally {
        probar.disabled = false;
      }
    });
    const guardarCon = async valor => {
      guardarP.disabled = true;
      try {
        pintarEstado(await ajustes.guardarProxy(valor));
        salida.textContent = '';
        toast(t('aj.proxy.guardado'), 'success');
      } catch (error) {
        toast(error.message, 'error', 6000);
      } finally {
        guardarP.disabled = false;
      }
    };
    // Si no se tocó la dirección (lleva *** en lugar de la contraseña), no se guarda encima.
    guardarP.addEventListener('click', () => {
      if (direccion.value.includes('***@')) return toast(t('aj.proxy.reescribe'), 'error', 6000);
      return guardarCon(direccion.value.trim());
    });
    volver.addEventListener('click', () => guardarCon(null));
    ajustes
      .proxy()
      .then(pintarEstado)
      .catch(() => {});
    return el('section', {
      className: 'card',
      attrs: { id: 'ajustes-proxy' },
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.proxy.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.proxy.hint') }),
          ],
        }),
        el('div', {
          className: 'card__body',
          children: [
            el('label', {
              className: 'field',
              children: [
                el('span', { className: 'field__label', text: t('aj.proxy.direccion') }),
                direccion,
                el('span', { className: 'field__hint', text: t('aj.proxy.direccion.hint') }),
              ],
            }),
            origenP,
            estadoP,
            cuando,
            salida,
            el('div', { className: 'ajustes-acciones', children: [guardarP, probar, volver] }),
          ],
        }),
      ],
    });
  }

  /* ── Búsqueda web y red ────────────────────────────────────────────── */

  function tarjetaBusqueda() {
    const url = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', placeholder: 'http://192.168.1.10:8899' },
    });
    const motores = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', placeholder: 'bing,yahoo' },
    });
    const paginas = el('select', {
      className: 'input',
      children: [1, 2, 3, 4, 5].map(n => el('option', { attrs: { value: n }, text: n })),
    });
    const sinProxy = el('textarea', {
      className: 'input',
      attrs: { rows: 3, spellcheck: 'false', placeholder: 'ejemplo.com' },
    });
    const resultado = el('p', { className: 'ajustes-resultado' });
    const mostrar = r => {
      resultado.className = `ajustes-resultado ${r.ok ? 'ajustes-resultado--ok' : 'ajustes-resultado--mal'}`;
      resultado.textContent = r.ok
        ? t('aj.web.responde', {
            n: r.resultados,
            fallan: r.sinRespuesta.length ? r.sinRespuesta.join(' · ') : '—',
          })
        : r.error;
    };
    ajustes
      .busqueda()
      .then(d => {
        url.value = d.searxngUrl || '';
        motores.value = d.motores || '';
        paginas.value = String(d.webPaginas || 2);
        sinProxy.value = (d.sinProxy || []).join('\n');
      })
      .catch(() => {});
    const form = el('form', {
      className: 'card__body ajustes-form',
      children: [
        campo(t('aj.web.url'), url, t('aj.web.url.hint')),
        campo(t('aj.web.motores'), motores, t('aj.web.motores.hint')),
        campo(t('aj.web.paginas'), paginas),
        campo(t('aj.web.sinProxy'), sinProxy, t('aj.web.sinProxy.hint')),
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'button button--small button--secondary',
              attrs: { type: 'button' },
              text: t('aj.con.probar'),
              on: {
                click: async () => {
                  try {
                    mostrar(
                      await ajustes.probarBusqueda({
                        searxngUrl: url.value,
                        motores: motores.value,
                      })
                    );
                  } catch (error) {
                    mostrar({ ok: false, error: error.message });
                  }
                },
              },
            }),
            el('button', {
              className: 'button button--small',
              attrs: { type: 'submit' },
              text: t('aj.guardar'),
            }),
          ],
        }),
        resultado,
      ],
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            const d = await ajustes.guardarBusqueda({
              searxngUrl: url.value,
              motores: motores.value,
              webPaginas: Number(paginas.value),
              sinProxy: sinProxy.value,
            });
            motores.value = d.motores;
            sinProxy.value = d.sinProxy.join('\n');
            toast(t('aj.guardado'));
          } catch (error) {
            mostrar({ ok: false, error: error.message });
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
            el('h3', { className: 'card__title', text: t('aj.web.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.web.hint') }),
          ],
        }),
        form,
      ],
    });
  }

  function tarjetaFiltros() {
    const bloqueadas = el('textarea', {
      className: 'input',
      attrs: { rows: 3, spellcheck: 'false', placeholder: t('buscar.filtro.excluir.ej') },
    });
    ajustes
      .filtros()
      .then(d => {
        bloqueadas.value = d.bloqueadas || '';
      })
      .catch(() => {});
    const form = el('form', {
      className: 'card__body ajustes-form',
      children: [
        campo(t('aj.filtros.bloqueadas'), bloqueadas, t('aj.filtros.bloqueadas.hint')),
        el('div', {
          className: 'ajustes-acciones',
          children: [
            el('button', {
              className: 'button button--small',
              attrs: { type: 'submit' },
              text: t('aj.guardar'),
            }),
          ],
        }),
      ],
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            const d = await ajustes.guardarFiltros({ bloqueadas: bloqueadas.value });
            bloqueadas.value = d.bloqueadas;
            toast(t('aj.filtros.guardado'));
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        },
      },
    });
    return el('section', {
      className: 'card',
      attrs: { id: 'ajustes-filtros' },
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.filtros.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.filtros.hint') }),
          ],
        }),
        form,
      ],
    });
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
