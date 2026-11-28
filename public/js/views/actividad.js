/**
 * Actividad (fase 3): «qué está pasando», en un solo sitio. Antes la cola de búsquedas estaba en
 * Buscar, los paquetes de descargas en Ajustes → JDownloader y las programadas en Ajustes →
 * Búsqueda. Tres pestañas (#/actividad/busquedas, /descargas, /programadas); los datos y las
 * rutas de la API son los mismos de siempre.
 */
import { ajustes, fase7 } from '../api.js';
import { el, toast } from '../dom.js';
import { t, tp, alCambiarIdioma, idiomaActual } from '../i18n/index.js';
import { crearCabecera } from '../cabecera.js';
import { abrirHoja, menuAcciones } from '../hojas.js';
import { pestanaActividad, PESTANAS_ACTIVIDAD, fechaHora } from '../unaMano.js';
import { comprobarAvisos, marcarLeidos, textoAviso } from '../avisos.js';

const confirmarIrreversible = opciones =>
  window.cgConfirmar({ peligro: true, mantener: true, ...opciones });

export function createActividadView(raiz) {
  const cabecera = crearCabecera({ tituloClave: 'nav.actividad', id: 'actividad-heading' });
  const chips = document.createElement('cg-chips');
  chips.setAttribute('unico', '');
  chips.className = 'actividad__pestanas';
  const botones = Object.fromEntries(
    PESTANAS_ACTIVIDAD.map(id => [
      id,
      // El texto va en su <span>: cg-chips pone delante la marca ✓ y no hay que borrársela.
      el('button', {
        attrs: { type: 'button', value: id, 'data-pestana': id },
        children: [el('span')],
      }),
    ])
  );
  chips.append(...Object.values(botones));
  const panel = el('div', { className: 'actividad__panel' });
  // Lo que no va bien y explica fallos de las búsquedas o programadas: proxy de salida caído y
  // sitios que dejaron de dar resultados (CS-17). Arriba, para que se vea al entrar.
  const avisos = el('div', { className: 'actividad__avisos' });
  raiz.append(
    cabecera.nodo,
    el('div', { className: 'actividad', children: [avisos, chips, panel] })
  );
  async function cargarAvisos() {
    const hijos = [];
    try {
      const [proxy, { sitios = [] }] = await Promise.all([ajustes.proxy(), ajustes.sitios()]);
      if (proxy.configurado && proxy.ok === false) {
        hijos.push(aviso(t('proxy.caido'), t('proxy.revisar'), '#/ajustes/sistema'));
      }
      const rotos = sitios.filter(s => s.salud?.aviso).map(s => s.nombre);
      if (rotos.length) {
        hijos.push(
          aviso(
            tp('act.rotos.corto', rotos.length),
            t('act.rotos.ver'),
            '#/ajustes/busqueda',
            rotos.join(', ')
          )
        );
      }
    } catch {
      // sin avisos que enseñar si el servidor no contesta
    }
    avisos.replaceChildren(...hijos);
  }
  /** CS-UX-018: una línea de 44 px que lleva a donde se arregla (no un bloque en cada pestaña). */
  function aviso(textoAviso, textoEnlace, href, detalle = '') {
    return el('a', {
      className: 'actividad__aviso-linea',
      attrs: {
        href,
        role: 'note',
        title: detalle || textoEnlace,
        'aria-label': `${textoAviso}. ${textoEnlace}`,
      },
      children: [
        window.cgIcono ? window.cgIcono('aviso') : null,
        el('span', { text: textoAviso }),
        window.cgIcono ? window.cgIcono('adelante') : null,
      ].filter(Boolean),
    });
  }

  const cuentas = { busquedas: 0, descargas: 0, programadas: 0, avisos: 0 };
  const pintarPestanas = () => {
    for (const id of PESTANAS_ACTIVIDAD) {
      botones[id].lastElementChild.textContent = cuentas[id]
        ? `${t(`act.${id}`)} · ${cuentas[id]}`
        : t(`act.${id}`);
    }
  };
  pintarPestanas();

  const pestanaDeHash = () => {
    const resto = window.location.hash.replace(/^#\/actividad\/?/, '').split('/')[0];
    return pestanaActividad(resto);
  };
  let pestana = pestanaDeHash();
  chips.addEventListener('cg-cambiado', e => {
    const id = e.detail?.chip?.value;
    if (id && id !== pestana) {
      window.history.replaceState(null, '', `#/actividad/${id}`);
      mostrar(id);
    }
  });

  const visible = () => !raiz.hidden && document.visibilityState !== 'hidden';

  /* ── Búsquedas: la cola del servidor ───────────────────────────────── */
  const listaBusquedas = el('ul', { className: 'cs-lista' });
  let cola = [];
  async function cargarCola() {
    try {
      cola = (await fetch('/api/buscar/cola').then(r => r.json())).busquedas || [];
    } catch {
      return;
    }
    cuentas.busquedas = cola.filter(b => b.estado !== 'fin').length;
    pintarPestanas();
    if (pestana === 'busquedas') pintarCola();
  }
  /** «Limpiar» de una lista del historial (sin pregunta: solo borra historial, ningún fichero). */
  function botonLimpiar(fn) {
    return el('button', {
      className: 'cg-boton cg-boton--fantasma actividad__limpiar',
      attrs: { type: 'button' },
      text: t('act.limpiar'),
      on: { click: fn },
    });
  }
  function pintarCola() {
    if (!cola.length) {
      listaBusquedas.replaceChildren(
        vacio(t('act.vacio.busquedas'), t('act.vacio.busquedas.boton'), () => {
          location.hash = '#/buscar';
        })
      );
      return;
    }
    const activas = cola.filter(b => b.estado !== 'fin');
    const terminadas = cola.filter(b => b.estado === 'fin');
    listaBusquedas.replaceChildren(
      ...[
        ...activas.map(filaBusqueda),
        terminadas.length
          ? el('li', {
              className: 'cs-lista__grupo actividad__grupo-limpiar',
              children: [
                el('span', { text: t('buscar.cola.terminadas', { n: terminadas.length }) }),
                botonLimpiar(async () => {
                  await fetch('/api/buscar/terminadas', { method: 'DELETE' }).catch(() => {});
                  cargarCola();
                }),
              ],
            })
          : null,
        ...terminadas.slice(0, 50).map(filaBusqueda),
      ].filter(Boolean)
    );
  }
  function filaBusqueda(b) {
    const estado =
      b.estado === 'curso'
        ? t('buscar.cola.curso')
        : b.estado === 'cola'
          ? t('buscar.cola.esperando', { n: b.posicion })
          : b.quitada
            ? t('buscar.cola.quitada')
            : tp('buscar.resultados', b.total);
    const detalle = [
      estado,
      b.carpeta ? `→ ${b.carpeta}` : null,
      b.origen === 'programada' ? t('buscar.cola.programada') : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const ver = () => {
      location.hash = '#/buscar';
      window.dispatchEvent(new CustomEvent('clipscout:ver-busqueda', { detail: b }));
    };
    const acciones = [
      el('button', {
        className: 'cg-boton',
        attrs: { type: 'button' },
        text: t('buscar.cola.ver'),
        on: { click: ver },
      }),
    ];
    if (b.estado !== 'fin') {
      acciones.push(
        el('button', {
          className: 'cg-boton cg-boton--fantasma',
          attrs: { type: 'button' },
          text: t(b.estado === 'cola' ? 'act.quitar' : 'buscar.parar'),
          on: {
            click: async () => {
              await fetch(`/api/buscar/cola/${encodeURIComponent(b.id)}`, {
                method: 'DELETE',
              }).catch(() => {});
              cargarCola();
            },
          },
        })
      );
    }
    return fila({
      estado: b.estado === 'fin' ? 'hecho' : 'curso',
      titulo: b.q,
      detalle,
      acciones,
    });
  }

  /* ── Descargas: los paquetes mandados a JDownloader ────────────────── */
  const avisoDescargas = el('p', { className: 'cs-nota' });
  const listaPaquetes = el('ul', { className: 'cs-lista' });
  const barraDescargas = el('div', {
    className: 'cs-fila-botones',
    children: [
      el('button', {
        className: 'cg-boton',
        attrs: { type: 'button' },
        text: t('aj.paq.actualizar'),
        on: { click: () => cargarPaquetes(true) },
      }),
      el('button', {
        className: 'cg-boton cg-boton--fantasma',
        attrs: { type: 'button' },
        text: t('aj.paq.vaciar'),
        on: { click: () => vaciarCapturador() },
      }),
    ],
  });
  let paquetes = [];
  async function cargarPaquetes(revisar = false) {
    let datos;
    try {
      datos = await ajustes.paquetesJd(revisar);
    } catch (error) {
      avisoDescargas.textContent = error.message;
      return;
    }
    avisoDescargas.textContent = datos.error ? t('aj.paq.sinJd', { error: datos.error }) : '';
    paquetes = datos.paquetes || [];
    cuentas.descargas = paquetes.filter(
      p => p.estado !== 'terminado' && p.estado !== 'incompleto'
    ).length;
    pintarPestanas();
    if (pestana === 'descargas') pintarPaquetes();
  }
  function pintarPaquetes() {
    if (!paquetes.length) {
      listaPaquetes.replaceChildren(vacio(t('aj.paq.vacio')));
      return;
    }
    const fecha = ms => fechaHora(ms, idiomaActual());
    listaPaquetes.replaceChildren(
      ...paquetes.slice(0, 50).map(p => {
        const c = p.contadores;
        // CS-UX-020: una línea (estado · progreso · cuándo); lo demás, en «⋯».
        const detalle = [
          t(`aj.paq.estado.${p.estado}`),
          c ? t('aj.paq.cuenta', { hechos: c.terminados, total: c.total }) : null,
          fecha(p.creado),
        ].filter(Boolean);
        const mas = [
          p.carpeta || t('aj.prog.sinCarpeta'),
          c?.fallidos ? tp('aj.paq.caidos', c.fallidos) : null,
          p.directos ? tp('aj.paq.directos', p.directos) : null,
          p.sinDirecto ? tp('aj.paq.sinDirecto', p.sinDirecto) : null,
          p.faltan ? tp('aj.paq.faltan', p.faltan) : null,
          p.escaneado ? t('aj.paq.escaneado') : null,
        ].filter(Boolean);
        const puedeReintentar = p.estado === 'error' || p.estado === 'incompleto' || c?.fallidos;
        const reintentar = async () => {
          try {
            const r = await ajustes.reintentarPaquete(p.id);
            toast(tp('aj.paq.reintentado', r.sustituidas || 0));
            cargarPaquetes();
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        };
        const acciones = [
          el('button', {
            className: 'cg-boton cg-boton--fantasma cg-boton--icono',
            attrs: {
              type: 'button',
              'aria-label': t('act.masPaquete'),
              title: t('act.masPaquete'),
            },
            children: [window.cgIcono ? window.cgIcono('mas') : document.createTextNode('⋯')],
            on: {
              click: () =>
                menuAcciones({
                  titulo: p.nombre,
                  subtitulo: mas.join(' · '),
                  acciones: puedeReintentar
                    ? [{ texto: t('aj.paq.reintentar'), fn: reintentar }]
                    : [],
                }),
            },
          }),
        ];
        const li = fila({
          estado:
            p.estado === 'terminado'
              ? 'hecho'
              : p.estado === 'error' || p.estado === 'incompleto'
                ? 'error'
                : 'curso',
          titulo: p.nombre,
          detalle: detalle.join(' · '),
          acciones,
        });
        // §4.2 de la auditoría: en táctil, deslizar a la derecha reintenta lo que falló.
        if (puedeReintentar && window.cgDeslizar) {
          window.cgDeslizar(li, { der: { texto: t('aj.paq.reintentar'), fn: reintentar } });
        }
        return li;
      })
    );
  }
  async function vaciarCapturador() {
    const enEspera = paquetes.filter(
      p => p.estado !== 'terminado' && p.estado !== 'incompleto'
    ).length;
    const si = await confirmarIrreversible({
      titulo: t('aj.paq.vaciar'),
      texto: `${t('aj.paq.vaciarConfirmar')} ${tp('act.paquetesEnEspera', enEspera)}`,
      aceptar: t('act.vaciar'),
    });
    if (!si) return;
    try {
      await ajustes.vaciarCapturador();
      toast(t('aj.paq.vaciado'));
      cargarPaquetes(true);
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }

  /* ── Programadas ───────────────────────────────────────────────────── */
  const listaProgramadas = el('ul', { className: 'cs-lista' });
  const nuevaProgramada = el('button', {
    className: 'cg-boton cg-boton--principal',
    attrs: { type: 'button' },
    text: t('act.prog.nueva'),
    on: { click: () => formularioProgramada(null) },
  });
  let programadas = { programadas: [], enCurso: null };
  async function cargarProgramadas() {
    try {
      programadas = await ajustes.programadas();
    } catch (error) {
      listaProgramadas.replaceChildren(el('li', { className: 'cs-nota', text: error.message }));
      return;
    }
    cuentas.programadas = programadas.programadas.filter(p => p.activa).length;
    pintarPestanas();
    if (pestana === 'programadas') pintarProgramadas();
  }
  const resumen = p => {
    if (programadas.enCurso === p.id) return t('aj.prog.enCurso');
    if (!p.ultimo) return t('aj.prog.nunca');
    const fecha = fechaHora(p.ultimo.fecha, idiomaActual());
    return p.ultimo.error
      ? t('aj.prog.ultimoError', { fecha, error: p.ultimo.error })
      : t('aj.prog.ultimo', {
          fecha,
          encontrados: p.ultimo.encontrados,
          enviados: p.ultimo.enviados,
        });
  };
  /**
   * Fase 7 · «Seguidas» (C4): las personas que se siguen (desde clipkeeper o desde aquí) van
   * arriba, en su grupo: cada cuánto, la última vuelta, la próxima y lo último que se mandó.
   */
  function filaSeguida(p) {
    const ultimos = (p.ultimo?.mandados || []).map(m => m.titulo).filter(Boolean);
    const proxima = p.ultimaVez
      ? new Date(Date.parse(p.ultimaVez) + p.cadaDias * 86400000).toLocaleDateString(idiomaActual())
      : t('seg.pronto');
    const li = fila({
      estado: p.activa ? (programadas.enCurso === p.id ? 'curso' : 'hecho') : 'pausa',
      titulo: p.persona || p.termino,
      detalle: [
        t('aj.prog.cada.n', { n: p.cadaDias }),
        tp('seg.limite', p.n || 0),
        t('seg.proxima', { fecha: proxima }),
        p.alias?.length ? t('seg.alias', { lista: p.alias.join(', ') }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      detalle2: ultimos.length
        ? t('seg.ultimos', { lista: ultimos.slice(0, 3).join(' · ') })
        : resumen(p),
      acciones: [
        el('button', {
          className: 'cg-boton',
          attrs: { type: 'button' },
          text: t('aj.prog.ahora'),
          on: { click: () => lanzar(p) },
        }),
        botonMas(t('act.mas', { nombre: p.persona || p.termino }), () =>
          menuAcciones({
            titulo: p.persona || p.termino,
            acciones: [
              {
                texto: t(p.activa ? 'aj.prog.pausar' : 'aj.prog.reanudar'),
                fn: async () => {
                  await ajustes.guardarProgramada({ id: p.id, activa: !p.activa });
                  cargarProgramadas();
                },
              },
              { texto: t('seg.dejar'), peligro: true, fn: () => dejarDeSeguir(p) },
            ],
          })
        ),
      ],
    });
    li.classList.add('actividad__seguida');
    return li;
  }
  async function dejarDeSeguir(p) {
    const si = await confirmarIrreversible({
      titulo: t('seg.dejar'),
      texto: t('seg.dejarConfirmar', { persona: p.persona || p.termino }),
      aceptar: t('seg.dejar'),
    });
    if (!si) return;
    try {
      await fase7.dejarDeSeguir(p.id);
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
    cargarProgramadas();
  }
  /** «Seguir a una persona» desde aquí: la lista de clipkeeper (C1), cada cuánto y cuántos. */
  async function formularioSeguir() {
    let lista = [];
    try {
      lista = (await fase7.personas()).personas || [];
    } catch {
      lista = [];
    }
    const sel = el('select', {
      className: 'input',
      children: lista.map((p, i) => el('option', { attrs: { value: String(i) }, text: p.nombre })),
    });
    const nombre = el('input', {
      className: 'input',
      attrs: { type: 'text', spellcheck: 'false', placeholder: t('fotos.persona.ej') },
    });
    const cada = el('input', {
      className: 'input',
      attrs: { type: 'number', min: '1', max: '90', inputmode: 'numeric' },
    });
    cada.value = '7';
    const limite = el('input', {
      className: 'input',
      attrs: { type: 'number', min: '1', max: '200', inputmode: 'numeric' },
    });
    limite.value = '20';
    const campo = (texto, control) =>
      el('label', {
        className: 'field',
        children: [el('span', { className: 'field__label', text: texto }), control],
      });
    let hoja = null;
    const guardarSeguir = el('button', {
      className: 'cg-boton cg-boton--principal',
      attrs: { type: 'button' },
      text: t('seg.seguir'),
      on: {
        click: async () => {
          const p = lista.length ? lista[Number(sel.value)] : { nombre: nombre.value.trim() };
          if (!p?.nombre) return;
          try {
            await fase7.seguir({
              persona: p.nombre,
              alias: p.alias || [],
              biblioteca_id: p.biblioteca_id ?? null,
              carpeta: p.carpeta || `People/${p.nombre}`,
              cada_dias: Number(cada.value) || 7,
              limite: Number(limite.value) || 20,
            });
            toast(t('seg.siguiendo', { persona: p.nombre }), 'success', 5000);
            hoja?.cerrar();
            cargarProgramadas();
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        },
      },
    });
    hoja = abrirHoja({
      titulo: t('seg.seguir'),
      contenido: [
        lista.length ? campo(t('fotos.persona'), sel) : campo(t('fotos.persona'), nombre),
        lista.length ? null : el('p', { className: 'cs-nota', text: t('seg.sinClipkeeper') }),
        campo(t('seg.cada'), cada),
        campo(t('seg.cuantos'), limite),
        el('p', { className: 'cs-nota', text: t('seg.explica') }),
      ].filter(Boolean),
      pie: [guardarSeguir],
    });
  }
  // CS-UX-021 / SU-UX-010: un solo principal («Nueva programada»); seguir a una persona, fantasma.
  const botonSeguir = el('button', {
    className: 'cg-boton cg-boton--fantasma',
    attrs: { type: 'button' },
    text: t('seg.seguir'),
    on: { click: () => formularioSeguir() },
  });

  function pintarProgramadas() {
    if (!programadas.programadas.length) {
      listaProgramadas.replaceChildren(vacio(t('aj.prog.vacio')));
      return;
    }
    const seguidas = programadas.programadas.filter(p => p.seguida);
    const otras = programadas.programadas.filter(p => !p.seguida);
    listaProgramadas.replaceChildren(
      ...(seguidas.length
        ? [
            el('li', {
              className: 'cs-lista__grupo',
              text: t('seg.titulo', { n: seguidas.length }),
            }),
            ...seguidas.map(filaSeguida),
            otras.length ? el('li', { className: 'cs-lista__grupo', text: t('seg.otras') }) : null,
          ].filter(Boolean)
        : []),
      ...otras.map(p =>
        fila({
          estado: p.activa ? (programadas.enCurso === p.id ? 'curso' : 'hecho') : 'pausa',
          titulo: p.termino,
          detalle: [
            p.carpeta || t('aj.prog.sinCarpeta'),
            t('aj.prog.cada.n', { n: p.cadaDias }),
            p.minutosMinimo ? t('aj.prog.masDe', { n: p.minutosMinimo }) : null,
            p.activa ? null : t('act.prog.pausada'),
          ]
            .filter(Boolean)
            .join(' · '),
          detalle2: resumen(p),
          acciones: [
            el('button', {
              className: 'cg-boton',
              attrs: { type: 'button' },
              text: t('aj.prog.ahora'),
              on: { click: () => lanzar(p) },
            }),
            botonMas(t('act.mas', { nombre: p.termino }), () =>
              menuAcciones({
                titulo: p.termino,
                acciones: [
                  { texto: t('aj.prog.editar'), fn: () => formularioProgramada(p) },
                  {
                    texto: t(p.activa ? 'aj.prog.pausar' : 'aj.prog.reanudar'),
                    fn: async () => {
                      await ajustes.guardarProgramada({ id: p.id, activa: !p.activa });
                      cargarProgramadas();
                    },
                  },
                  { texto: t('aj.prog.quitar'), peligro: true, fn: () => quitarProgramada(p) },
                ],
              })
            ),
          ],
        })
      )
    );
  }
  async function lanzar(p) {
    try {
      await ajustes.lanzarProgramada(p.id);
      toast(t('aj.prog.lanzada'));
      cargarProgramadas();
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }
  async function quitarProgramada(p) {
    const si = await confirmarIrreversible({
      titulo: t('aj.prog.quitar'),
      texto: `«${p.termino}». ${t('aj.prog.quitarConfirmar')}`,
      aceptar: t('aj.prog.quitar'),
    });
    if (!si) return;
    await ajustes.quitarProgramada(p.id);
    cargarProgramadas();
  }

  /** Alta o edición de una programada, en una hoja (los diez campos de antes, igual). */
  function formularioProgramada(p, prellenar = {}) {
    const v = { ...(p || {}), ...prellenar };
    const entrada = (valor, placeholder, extra = {}) => {
      const i = el('input', {
        className: 'input',
        attrs: { type: 'text', spellcheck: 'false', placeholder, ...extra },
      });
      i.value = valor || '';
      return i;
    };
    const termino = entrada(v.termino, t('aj.prog.termino.ej'));
    const carpeta = entrada(v.carpeta, t('aj.prog.carpeta.ej'), { list: 'programadas-carpetas' });
    const carpetas = el('datalist', { attrs: { id: 'programadas-carpetas' } });
    const persona = entrada(v.persona, t('aj.prog.persona.ej'));
    const etiqueta = entrada(v.etiqueta, t('aj.prog.etiqueta.ej'));
    const minutos = el('input', {
      className: 'input',
      attrs: { type: 'number', min: '0', max: '600', inputmode: 'numeric' },
    });
    minutos.value = String(v.minutosMinimo ?? 0);
    const sinDuracion = el('input', { attrs: { type: 'checkbox' } });
    sinDuracion.checked = Boolean(v.sinDuracion);
    const abierta = el('input', { attrs: { type: 'checkbox' } });
    abierta.checked = Boolean(v.abierta);
    const contener = entrada(v.contener, t('aj.prog.contener.ej'));
    const excluir = entrada(v.excluir, t('aj.prog.excluir.ej'));
    const cada = el('select', {
      className: 'input',
      children: [1, 3, 7, 14, 30].map(n =>
        el('option', { attrs: { value: n }, text: t('aj.prog.cada.n', { n }) })
      ),
    });
    cada.value = String(v.cadaDias || 7);
    // «Recoger» (CS-N1): como mucho N por vuelta, solo lo que lleva el nombre y en qué orden.
    const maximo = el('input', {
      className: 'input',
      attrs: { type: 'number', min: '0', max: '200', inputmode: 'numeric' },
    });
    maximo.value = String(v.n ?? 0);
    const soloNombre = el('input', { attrs: { type: 'checkbox' } });
    soloNombre.checked = Boolean(v.soloConNombre);
    const ordenSel = el('select', {
      className: 'input',
      children: [
        el('option', { attrs: { value: '' }, text: t('aj.prog.orden.busqueda') }),
        el('option', { attrs: { value: 'largos' }, text: t('recoger.orden.largos') }),
        el('option', { attrs: { value: 'calidad' }, text: t('recoger.orden.calidad') }),
      ],
    });
    ordenSel.value = v.orden || '';
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
    const campo = (etiquetaTexto, input, ayuda) =>
      el('label', {
        className: 'field',
        children: [
          el('span', { className: 'field__label', text: etiquetaTexto }),
          input,
          ayuda ? el('span', { className: 'field__hint', text: ayuda }) : null,
        ],
      });
    const casilla = (input, textoCasilla) =>
      el('label', {
        className: 'cs-casilla',
        children: [input, el('span', { text: textoCasilla })],
      });
    const guardar = el('button', {
      className: 'cg-boton cg-boton--principal',
      attrs: { type: 'submit', form: 'form-programada' },
      text: t(p ? 'aj.guardar' : 'aj.prog.agregar'),
    });
    const form = el('form', {
      className: 'ajustes-form cs-form-hoja',
      attrs: { id: 'form-programada' },
      children: [
        campo(t('aj.prog.termino'), termino),
        campo(t('aj.prog.carpeta'), carpeta, t('aj.prog.carpeta.hint')),
        carpetas,
        campo(t('aj.prog.cada'), cada),
        campo(t('aj.prog.maximo'), maximo, t('aj.prog.maximo.hint')),
        casilla(soloNombre, t('recoger.soloNombre')),
        campo(t('recoger.orden'), ordenSel),
        campo(t('aj.prog.minutos'), minutos),
        casilla(sinDuracion, t('aj.prog.sinDuracion')),
        campo(t('aj.prog.contener'), contener, t('aj.prog.contener.hint')),
        campo(t('aj.prog.excluir'), excluir, t('aj.prog.excluir.hint')),
        campo(t('aj.prog.persona'), persona),
        campo(t('aj.prog.etiqueta'), etiqueta),
        casilla(abierta, t('aj.prog.abierta')),
      ],
    });
    const hoja = abrirHoja({
      titulo: t(p ? 'aj.prog.editar' : 'act.prog.nueva'),
      contenido: [form],
      pie: [guardar],
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!termino.value.trim()) {
        termino.focus();
        return;
      }
      try {
        await ajustes.guardarProgramada({
          id: p?.id,
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
          n: Number(maximo.value) || 0,
          soloConNombre: soloNombre.checked,
          orden: ordenSel.value || null,
          activa: p ? p.activa : true,
        });
        toast(t('aj.prog.guardada'));
        hoja.cerrar();
        cargarProgramadas();
      } catch (error) {
        toast(error.message, 'error', 6000);
      }
    });
    setTimeout(() => termino.focus(), 300);
  }

  // Buscar → «Repetir cada…»: una programada con el término, los filtros y la carpeta ya puestos.
  window.addEventListener('clipscout:programar', e => {
    location.hash = '#/actividad/programadas';
    formularioProgramada(null, e.detail || {});
  });

  /* ── Piezas comunes ────────────────────────────────────────────────── */
  function fila({ estado, titulo, detalle, detalle2, acciones = [] }) {
    return el('li', {
      className: `cs-fila cs-fila--${estado}`,
      children: [
        el('span', {
          className: estado === 'curso' ? 'cs-fila__estado buscar__girando' : 'cs-fila__estado',
          attrs: { 'aria-hidden': 'true' },
          text: estado === 'hecho' ? '✓' : estado === 'error' ? '⚠' : estado === 'pausa' ? 'Ⅱ' : '',
        }),
        el('div', {
          className: 'cs-fila__texto',
          children: [
            el('strong', { text: titulo }),
            detalle ? el('span', { text: detalle }) : null,
            detalle2 ? el('span', { text: detalle2 }) : null,
          ],
        }),
        el('div', { className: 'cs-fila__acciones', children: acciones }),
      ],
    });
  }
  function botonMas(etiqueta, fn) {
    const b = el('button', {
      className: 'cg-boton cg-boton--icono cg-boton--fantasma',
      attrs: { type: 'button', 'aria-label': etiqueta, title: etiqueta },
      text: '⋯',
      on: { click: fn },
    });
    return b;
  }
  function vacio(texto, boton, fn) {
    return el('li', {
      className: 'cs-vacio',
      children: [
        el('p', { text: texto }),
        boton
          ? el('button', {
              className: 'cg-boton cg-boton--principal',
              attrs: { type: 'button' },
              text: boton,
              on: { click: fn },
            })
          : null,
      ],
    });
  }

  /* ── Avisos (CS-N5): lo que pasó mientras no mirabas ──────────────── */
  const listaAvisos = el('ul', { className: 'cs-lista' });
  let datosAvisos = { avisos: [], sinLeer: 0, leidoHasta: 0 };
  const destinoAviso = a =>
    ({
      programada: '#/actividad/programadas',
      programada_error: '#/actividad/programadas',
      paquete_terminado: '#/actividad/descargas',
      paquete_fallido: '#/actividad/descargas',
      paquete_incompleto: '#/actividad/descargas',
      sitio_roto: '#/ajustes/busqueda',
      busqueda_terminada: '#/actividad/busquedas',
    })[a.tipo];
  function pintarAvisos() {
    if (!datosAvisos.avisos.length) {
      listaAvisos.replaceChildren(vacio(t('act.vacio.avisos')));
      return;
    }
    const error = /_error$|_fallido$|_roto$/;
    listaAvisos.replaceChildren(
      el('li', {
        className: 'cs-lista__grupo actividad__grupo-limpiar',
        children: [
          el('span'),
          botonLimpiar(async () => {
            await fetch('/api/avisos', { method: 'DELETE' }).catch(() => {});
            datosAvisos = { ...datosAvisos, avisos: [], sinLeer: 0 };
            cuentas.avisos = 0;
            pintarPestanas();
            pintarAvisos();
            window.dispatchEvent(new CustomEvent('clipscout:avisos-vaciados'));
          }),
        ],
      }),
      ...datosAvisos.avisos.slice(0, 50).map(a => {
        const li = fila({
          estado: error.test(a.tipo) ? 'error' : 'hecho',
          titulo: textoAviso(a),
          detalle:
            fechaHora(a.fecha, idiomaActual()) +
            (a.id > datosAvisos.leidoHasta ? ` · ${t('avisos.nuevo')}` : ''),
          acciones: destinoAviso(a)
            ? [
                el('a', {
                  className: 'cg-boton cg-boton--fantasma',
                  attrs: { href: destinoAviso(a) },
                  text: t('avisos.ver'),
                }),
              ]
            : [],
        });
        li.classList.add('actividad__aviso');
        return li;
      })
    );
  }
  window.addEventListener('clipscout:avisos', e => {
    datosAvisos = e.detail || datosAvisos;
    cuentas.avisos = datosAvisos.sinLeer || 0;
    pintarPestanas();
    if (pestana === 'avisos' && !raiz.hidden) pintarAvisos();
  });
  async function verAvisos() {
    pintarAvisos();
    await comprobarAvisos();
    pintarAvisos();
    // Mirarlos es leerlos: se quita el punto (la marca «nuevo» se ve esta vez).
    await marcarLeidos();
    cuentas.avisos = 0;
    pintarPestanas();
  }

  /* ── Pestañas ──────────────────────────────────────────────────────── */
  function mostrar(id) {
    pestana = id;
    // CS-UX-003: entrar en Actividad (por cualquier pestaña) da los avisos por vistos; el punto
    // vuelve solo con uno nuevo. En «Avisos» se marcan después de pintarlos (siguen con «nuevo»).
    if (id !== 'avisos') marcarLeidos().catch(() => {});
    for (const [clave, b] of Object.entries(botones)) {
      b.setAttribute('aria-pressed', String(clave === id));
    }
    // Con cuatro pestañas, la última no cabe a 390 px: la elegida se trae a la vista.
    botones[id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (id === 'busquedas') {
      panel.replaceChildren(listaBusquedas);
      pintarCola();
      cargarCola();
    } else if (id === 'descargas') {
      // Primero lo enviado; las acciones (actualizar, vaciar) y el aviso del gestor, debajo.
      panel.replaceChildren(listaPaquetes, avisoDescargas, barraDescargas);
      pintarPaquetes();
      cargarPaquetes(true);
    } else if (id === 'avisos') {
      panel.replaceChildren(listaAvisos);
      verAvisos();
    } else {
      panel.replaceChildren(
        el('div', { className: 'cs-fila-botones', children: [nuevaProgramada, botonSeguir] }),
        listaProgramadas
      );
      pintarProgramadas();
      cargarProgramadas();
    }
  }

  // Se refresca sola solo mientras se mira (antes la cola se pedía cada 4 s desde Buscar siempre).
  setInterval(() => {
    if (!visible()) return;
    if (pestana === 'busquedas') cargarCola();
    else if (pestana === 'descargas') cargarPaquetes();
    else if (pestana === 'programadas') cargarProgramadas();
  }, 5000);

  alCambiarIdioma(() => {
    pintarPestanas();
    nuevaProgramada.textContent = t('act.prog.nueva');
    botonSeguir.textContent = t('seg.seguir');
    barraDescargas.children[0].textContent = t('aj.paq.actualizar');
    barraDescargas.children[1].textContent = t('aj.paq.vaciar');
    if (!raiz.hidden) mostrar(pestana);
  });

  // Los contadores de las pestañas se rellenan al arrancar, aunque se entre por otra.
  cargarCola();
  cargarPaquetes();
  cargarProgramadas();

  return {
    focus() {
      cargarAvisos();
      const pedida = pestanaDeHash();
      mostrar(pedida);
    },
  };
}
