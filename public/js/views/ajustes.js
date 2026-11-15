/**
 * Vista Ajustes: identidad de esta instancia, clave de API y conexiones con
 * las otras apps de clip crew (clonbuster, clipkeeper), al estilo de las *arr.
 *
 * Todo se construye con `el()`: nada de innerHTML (regla del proyecto).
 */

import { ajustes } from '../api.js';
import { confirmDialog } from '../components/dialog.js';
import { el, toast } from '../dom.js';
import { alCambiarIdioma, cambiarIdioma, idiomaActual, IDIOMAS, t, tp } from '../i18n/index.js';
import { cambiarTema, temaGuardado, TEMAS } from '../tema.js';

const APPS = ['clipkeeper', 'clonbuster', 'clipscout'];
const PUERTOS = { clipkeeper: 8096, clonbuster: 8095, clipscout: 3001 };

/** Avisa a la cabecera de que cambiaron las conexiones (para repintar sus iconos). */
const EVENTO = 'clipscout:conexiones';
export const avisarCambio = () => window.dispatchEvent(new Event(EVENTO));

export function createAjustesView(raiz) {
  let general = null;
  let protegido = false;
  let claveVisible = false;
  let formularioAbierto = false;

  async function cargar() {
    try {
      general = await ajustes.general();
      protegido = (await (await fetch('/api/auth/estado')).json()).protegido;
    } catch (error) {
      toast(error.message, 'error', 6000);
      return;
    }
    pintar();
  }

  function botonSalir() {
    return el('button', {
      className: 'button button--secondary',
      attrs: { type: 'button' },
      text: t('ajustes.salir'),
      on: {
        click: async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          location.replace('/login');
        },
      },
    });
  }

  function pintar() {
    raiz.replaceChildren(
      el('h2', {
        className: 'visually-hidden',
        attrs: { id: 'ajustes-heading' },
        text: t('nav.ajustes'),
      }),
      tarjetaGeneral(),
      tarjetaApariencia(),
      tarjetaClave(),
      tarjetaConexiones(),
      tarjetaJd(),
      tarjetaPaquetes(),
      tarjetaSitios(),
      tarjetaBusqueda(),
      tarjetaFiltros(),
      tarjetaProgramadas(),
      tarjetaRespaldos(),
      ...(protegido ? [botonSalir()] : [])
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
            // Con CLIPCREW_CLAVE la clave es la del entorno, común a las tres apps: no se regenera aquí.
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
      ],
    });
  }

  /* ── Búsquedas programadas ─────────────────────────────────────────── */

  function tarjetaProgramadas() {
    const lista = el('ul', { className: 'programadas' });
    let editando = null; // la programada que está en el formulario (null = nueva)
    const entrada = (placeholder, extra = {}) =>
      el('input', {
        className: 'input',
        attrs: { type: 'text', spellcheck: 'false', placeholder, ...extra },
      });
    const termino = entrada(t('aj.prog.termino.ej'));
    const carpeta = entrada(t('aj.prog.carpeta.ej'), { list: 'programadas-carpetas' });
    const carpetas = el('datalist', { attrs: { id: 'programadas-carpetas' } });
    const persona = entrada(t('aj.prog.persona.ej'));
    const etiqueta = entrada(t('aj.prog.etiqueta.ej'));
    const minutos = el('input', {
      className: 'input',
      attrs: { type: 'number', min: '0', max: '600', value: '0' },
    });
    const sinDuracion = el('input', { attrs: { type: 'checkbox' } });
    const abierta = el('input', { attrs: { type: 'checkbox' } });
    const contener = entrada(t('aj.prog.contener.ej'));
    const excluir = entrada(t('aj.prog.excluir.ej'));
    const cada = el('select', {
      className: 'input',
      children: [1, 3, 7, 14, 30].map(n =>
        el('option', { attrs: { value: n }, text: t('aj.prog.cada.n', { n }) })
      ),
    });
    cada.value = '7';
    ajustes
      .destinos()
      .then(d => {
        for (const b of d.bibliotecas || []) {
          for (const c of b.carpetas || []) {
            carpetas.append(el('option', { attrs: { value: c.carpeta } }));
          }
        }
      })
      .catch(() => {});

    const rellenar = p => {
      editando = p;
      termino.value = p?.termino || '';
      carpeta.value = p?.carpeta || '';
      persona.value = p?.persona || '';
      etiqueta.value = p?.etiqueta || '';
      minutos.value = String(p?.minutosMinimo ?? 0);
      sinDuracion.checked = Boolean(p?.sinDuracion);
      abierta.checked = Boolean(p?.abierta);
      contener.value = p?.contener || '';
      excluir.value = p?.excluir || '';
      cada.value = String(p?.cadaDias || 7);
      guardar.textContent = t(p ? 'aj.guardar' : 'aj.prog.agregar');
      cancelar.hidden = !p;
    };
    const guardar = el('button', {
      className: 'button button--small',
      attrs: { type: 'submit' },
      text: t('aj.prog.agregar'),
    });
    const cancelar = el('button', {
      className: 'button button--small button--secondary',
      attrs: { type: 'button', hidden: true },
      text: t('aj.prog.cancelar'),
      on: { click: () => rellenar(null) },
    });
    const form = el('form', {
      className: 'card__body ajustes-form',
      children: [
        campo(t('aj.prog.termino'), termino),
        campo(t('aj.prog.carpeta'), carpeta, t('aj.prog.carpeta.hint')),
        carpetas,
        campo(t('aj.prog.persona'), persona),
        campo(t('aj.prog.etiqueta'), etiqueta),
        campo(t('aj.prog.minutos'), minutos),
        el('label', {
          className: 'ajustes-casilla',
          children: [sinDuracion, t('aj.prog.sinDuracion')],
        }),
        el('label', {
          className: 'ajustes-casilla',
          attrs: { title: t('buscar.webTodo.detalle') },
          children: [abierta, t('aj.prog.abierta')],
        }),
        campo(t('aj.prog.contener'), contener, t('aj.prog.contener.hint')),
        campo(t('aj.prog.excluir'), excluir, t('aj.prog.excluir.hint')),
        campo(t('aj.prog.cada'), cada),
        el('div', { className: 'ajustes-acciones', children: [guardar, cancelar] }),
      ],
      on: {
        submit: async e => {
          e.preventDefault();
          try {
            await ajustes.guardarProgramada({
              id: editando?.id,
              termino: termino.value,
              carpeta: carpeta.value,
              persona: persona.value,
              etiqueta: etiqueta.value,
              minutosMinimo: Number(minutos.value) || 0,
              sinDuracion: sinDuracion.checked,
              abierta: abierta.checked,
              contener: contener.value,
              excluir: excluir.value,
              cadaDias: Number(cada.value),
              activa: editando ? editando.activa : true,
            });
            toast(t('aj.prog.guardada'));
            rellenar(null);
            cargarLista();
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        },
      },
    });

    const resumen = p => {
      if (!p.ultimo) return t('aj.prog.nunca');
      const fecha = new Date(p.ultimo.fecha).toLocaleString();
      return p.ultimo.error
        ? t('aj.prog.ultimoError', { fecha, error: p.ultimo.error })
        : t('aj.prog.ultimo', {
            fecha,
            encontrados: p.ultimo.encontrados,
            enviados: p.ultimo.enviados,
          });
    };
    const boton = (clave, onClick, extra = 'button--secondary') =>
      el('button', {
        className: `button button--small ${extra}`,
        attrs: { type: 'button' },
        text: t(clave),
        on: { click: onClick },
      });

    async function cargarLista() {
      let datos;
      try {
        datos = await ajustes.programadas();
      } catch (error) {
        lista.replaceChildren(el('li', { className: 'ajustes-error', text: error.message }));
        return;
      }
      if (!datos.programadas.length) {
        lista.replaceChildren(
          el('li', { className: 'programadas__vacio', text: t('aj.prog.vacio') })
        );
        return;
      }
      lista.replaceChildren(
        ...datos.programadas.map(p =>
          el('li', {
            className: p.activa ? '' : 'programadas__pausada',
            children: [
              el('div', {
                className: 'programadas__texto',
                children: [
                  el('strong', { text: p.termino }),
                  el('span', {
                    className: 'field__hint',
                    text: [
                      p.carpeta || t('aj.prog.sinCarpeta'),
                      t('aj.prog.cada.n', { n: p.cadaDias }),
                      p.minutosMinimo ? t('aj.prog.masDe', { n: p.minutosMinimo }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }),
                  el('span', {
                    className: 'field__hint',
                    text: datos.enCurso === p.id ? t('aj.prog.enCurso') : resumen(p),
                  }),
                ],
              }),
              el('div', {
                className: 'ajustes-acciones programadas__acciones',
                children: [
                  boton('aj.prog.ahora', async () => {
                    try {
                      await ajustes.lanzarProgramada(p.id);
                      toast(t('aj.prog.lanzada'));
                      cargarLista();
                    } catch (error) {
                      toast(error.message, 'error', 6000);
                    }
                  }),
                  boton(p.activa ? 'aj.prog.pausar' : 'aj.prog.reanudar', async () => {
                    await ajustes.guardarProgramada({ id: p.id, activa: !p.activa });
                    cargarLista();
                  }),
                  boton('aj.prog.editar', () => {
                    rellenar(p);
                    termino.focus();
                  }),
                  boton(
                    'aj.prog.quitar',
                    async () => {
                      if (
                        !(await confirmDialog({
                          titleKey: 'aj.prog.quitar',
                          bodyKey: 'aj.prog.quitarConfirmar',
                          variant: 'danger',
                        }))
                      ) {
                        return;
                      }
                      await ajustes.quitarProgramada(p.id);
                      if (editando?.id === p.id) rellenar(null);
                      cargarLista();
                    },
                    'button--secondary ajustes-peligro'
                  ),
                ],
              }),
            ],
          })
        )
      );
    }
    cargarLista();

    return el('section', {
      className: 'card',
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.prog.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.prog.hint') }),
          ],
        }),
        el('div', { className: 'card__body', children: [lista] }),
        form,
      ],
    });
  }

  /* ── Copias de seguridad ───────────────────────────────────────────── */

  function tarjetaRespaldos() {
    const lista = el('ul', { className: 'ajustes-paquetes' });
    const kb = n => `${Math.max(1, Math.round(n / 1024))} KB`;
    async function cargarRespaldos() {
      let datos;
      try {
        datos = await ajustes.respaldos();
      } catch (error) {
        lista.replaceChildren(el('li', { className: 'ajustes-error', text: error.message }));
        return;
      }
      if (!datos.copias.length) {
        lista.replaceChildren(el('li', { className: 'field__hint', text: t('aj.resp.vacio') }));
        return;
      }
      lista.replaceChildren(
        ...datos.copias.map(c =>
          el('li', {
            className: 'ajustes-paquetes__fila',
            children: [
              el('div', {
                className: 'programadas__texto',
                children: [
                  el('strong', { text: c.previa ? t('aj.resp.previa') : c.id }),
                  el('span', {
                    className: 'field__hint',
                    text: c.ficheros.map(f => `${f.nombre} (${kb(f.bytes)})`).join(' · '),
                  }),
                ],
              }),
              el('div', {
                className: 'ajustes-acciones',
                children: [
                  el('a', {
                    className: 'button button--small button--secondary',
                    attrs: {
                      href: `/api/ajustes/respaldos/${encodeURIComponent(c.id)}/descargar`,
                      download: `clipscout-respaldo-${c.id}.json`,
                    },
                    text: t('aj.resp.descargar'),
                  }),
                  el('button', {
                    className: 'button button--small button--secondary ajustes-peligro',
                    attrs: { type: 'button' },
                    text: t('aj.resp.restaurar'),
                    on: {
                      click: async () => {
                        if (
                          !(await confirmDialog({
                            titleKey: 'aj.resp.restaurar',
                            bodyKey: 'aj.resp.restaurarConfirmar',
                            variant: 'danger',
                          }))
                        ) {
                          return;
                        }
                        try {
                          await ajustes.restaurarRespaldo(c.id);
                          toast(t('aj.resp.restaurado'));
                          cargar();
                        } catch (error) {
                          toast(error.message, 'error', 6000);
                        }
                      },
                    },
                  }),
                ],
              }),
            ],
          })
        )
      );
    }
    cargarRespaldos();
    return el('section', {
      className: 'card',
      attrs: { id: 'ajustes-respaldos' },
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.resp.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.resp.hint') }),
          ],
        }),
        el('div', {
          className: 'card__body',
          children: [
            el('div', {
              className: 'ajustes-acciones',
              children: [
                el('button', {
                  className: 'button button--small button--secondary',
                  attrs: { type: 'button' },
                  text: t('aj.resp.ahora'),
                  on: {
                    click: async () => {
                      try {
                        await ajustes.respaldarAhora();
                        toast(t('aj.resp.hecha'));
                        cargarRespaldos();
                      } catch (error) {
                        toast(error.message, 'error', 6000);
                      }
                    },
                  },
                }),
              ],
            }),
            lista,
          ],
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

  /* ── Lo mandado a JDownloader ──────────────────────────────────────── */

  function tarjetaPaquetes() {
    const lista = el('ul', { className: 'ajustes-paquetes' });
    const aviso = el('p', { className: 'field__hint' });
    const fecha = ms => new Date(ms).toLocaleString();
    async function cargarPaquetes(revisar = false) {
      let datos;
      try {
        datos = await ajustes.paquetesJd(revisar);
      } catch (error) {
        aviso.textContent = error.message;
        return;
      }
      aviso.textContent = datos.error ? t('aj.paq.sinJd', { error: datos.error }) : '';
      if (!datos.paquetes.length) {
        lista.replaceChildren(el('li', { className: 'field__hint', text: t('aj.paq.vacio') }));
        return;
      }
      lista.replaceChildren(
        ...datos.paquetes.slice(0, 50).map(p => {
          const c = p.contadores;
          const detalle = [
            p.carpeta || t('aj.prog.sinCarpeta'),
            fecha(p.creado),
            c ? t('aj.paq.cuenta', { hechos: c.terminados, total: c.total }) : null,
            c?.fallidos ? tp('aj.paq.caidos', c.fallidos) : null,
            p.directos ? tp('aj.paq.directos', p.directos) : null,
            p.sinDirecto ? tp('aj.paq.sinDirecto', p.sinDirecto) : null,
            p.escaneado ? t('aj.paq.escaneado') : null,
          ].filter(Boolean);
          const acciones = [];
          if (p.estado === 'error' || c?.fallidos) {
            acciones.push(
              el('button', {
                className: 'button button--small button--secondary',
                attrs: { type: 'button' },
                text: t('aj.paq.reintentar'),
                on: {
                  click: async () => {
                    try {
                      const r = await ajustes.reintentarPaquete(p.id);
                      toast(tp('aj.paq.reintentado', r.sustituidas || 0));
                      cargarPaquetes();
                    } catch (error) {
                      toast(error.message, 'error', 6000);
                    }
                  },
                },
              })
            );
          }
          return el('li', {
            className: `ajustes-paquetes__fila ajustes-paquetes__fila--${p.estado}`,
            children: [
              el('span', {
                className: `ajustes-paquetes__estado ajustes-paquetes__estado--${p.estado}`,
                text: t(`aj.paq.estado.${p.estado}`),
              }),
              el('div', {
                className: 'programadas__texto',
                children: [
                  el('strong', { text: p.nombre }),
                  el('span', { className: 'field__hint', text: detalle.join(' · ') }),
                ],
              }),
              el('div', { className: 'ajustes-acciones', children: acciones }),
            ],
          });
        })
      );
    }
    cargarPaquetes(true);
    // Mientras se ve, se refresca solo (lo que guarda el servidor; él ya pregunta a JDownloader).
    const reloj = setInterval(() => {
      if (!lista.isConnected) return clearInterval(reloj);
      if (document.visibilityState !== 'hidden') cargarPaquetes();
    }, 10000);
    const boton = (clave, onClick, extra = 'button--secondary') =>
      el('button', {
        className: `button button--small ${extra}`,
        attrs: { type: 'button' },
        text: t(clave),
        on: { click: onClick },
      });
    return el('section', {
      className: 'card',
      attrs: { id: 'ajustes-paquetes' },
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.paq.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.paq.hint') }),
          ],
        }),
        el('div', {
          className: 'card__body',
          children: [
            el('div', {
              className: 'ajustes-acciones',
              children: [
                boton('aj.paq.actualizar', () => cargarPaquetes(true)),
                boton(
                  'aj.paq.vaciar',
                  async () => {
                    if (
                      !(await confirmDialog({
                        titleKey: 'aj.paq.vaciar',
                        bodyKey: 'aj.paq.vaciarConfirmar',
                        variant: 'danger',
                      }))
                    ) {
                      return;
                    }
                    try {
                      await ajustes.vaciarCapturador();
                      toast(t('aj.paq.vaciado'));
                      cargarPaquetes(true);
                    } catch (error) {
                      toast(error.message, 'error', 6000);
                    }
                  },
                  'button--secondary ajustes-peligro'
                ),
              ],
            }),
            aviso,
            lista,
          ],
        }),
      ],
    });
  }

  /* ── Sitios: opciones por sitio ────────────────────────────────────── */

  function tarjetaSitios() {
    const lista = el('ul', { className: 'ajustes-sitios' });
    async function cargarSitios() {
      let datos;
      try {
        datos = await ajustes.sitios();
      } catch (error) {
        lista.replaceChildren(el('li', { className: 'ajustes-error', text: error.message }));
        return;
      }
      if (!datos.sitios.length) {
        lista.replaceChildren(el('li', { className: 'field__hint', text: t('aj.sitios.vacio') }));
        return;
      }
      lista.replaceChildren(
        ...datos.sitios.map(s => {
          const directo = el('input', { attrs: { type: 'checkbox' } });
          directo.checked = s.jdDirecto;
          directo.addEventListener('change', async () => {
            try {
              await ajustes.guardarSitio(s.dominio, { jdDirecto: directo.checked });
              toast(t('aj.guardado'));
            } catch (error) {
              directo.checked = !directo.checked;
              toast(error.message, 'error', 6000);
            }
          });
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
              ]
                .filter(Boolean)
                .join(' · ')
            : t('aj.sitios.sinDatos');
          return el('li', {
            className: 'ajustes-sitios__fila',
            children: [
              el('strong', { text: s.nombre }),
              el('span', { className: 'field__hint', text: s.dominio }),
              el('span', { className: 'ajustes-sitios__cifras', text: cifras }),
              el('label', {
                className: 'ajustes-casilla',
                attrs: { title: t('aj.sitios.directo.hint') },
                children: [directo, t('aj.sitios.directo')],
              }),
            ],
          });
        })
      );
    }
    cargarSitios();
    return el('section', {
      className: 'card',
      attrs: { id: 'ajustes-sitios' },
      children: [
        el('div', {
          className: 'card__header',
          children: [
            el('h3', { className: 'card__title', text: t('aj.sitios.titulo') }),
            el('p', { className: 'card__hint', text: t('aj.sitios.hint') }),
          ],
        }),
        el('div', {
          className: 'card__body',
          children: [
            lista,
            el('div', {
              className: 'ajustes-acciones',
              children: [
                el('button', {
                  className: 'button button--small button--secondary ajustes-peligro',
                  attrs: { type: 'button' },
                  text: t('aj.sitios.cero'),
                  on: {
                    click: async () => {
                      if (
                        !(await confirmDialog({
                          titleKey: 'aj.sitios.cero',
                          bodyKey: 'aj.sitios.ceroConfirmar',
                          variant: 'danger',
                        }))
                      ) {
                        return;
                      }
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
            c.auto
              ? el('span', {
                  className: 'field__hint',
                  text: ` ${t('aj.con.auto')}`,
                  attrs: { title: t('aj.con.auto.titulo') },
                })
              : null,
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
