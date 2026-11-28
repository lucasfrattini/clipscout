/**
 * «Recoger» (CS-N1): de lo que encontró la búsqueda de una persona o un término, los N vídeos que
 * llevan su nombre, que no tengo (lo pregunta el servidor a clipkeeper), sin repetidos y los más
 * largos. Una hoja con la propuesta a la vista y UN botón: «Mandar N a <carpeta>». Opcionalmente,
 * repetirlo cada semana (una búsqueda programada con lo mismo).
 *
 * La elección la hace el servidor (`POST /api/recoger/propuesta`, `src/lib/recoger.js`): la misma
 * función que las programadas. clipscout nunca descarga: manda al gestor de descargas.
 */
import { cargarMiniatura } from '../miniaturas.js';
import { ajustes, recoger } from '../api.js';
import { el, toast } from '../dom.js';
import { t, tp } from '../i18n/index.js';
import { abrirHoja } from '../hojas.js';

const CLAVE_N = 'clipscout:recoger-n';
const CLAVE_ORDEN = 'clipscout:recoger-orden';
const leer = (clave, def) => {
  try {
    return localStorage.getItem(clave) || def;
  } catch {
    return def;
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
};

/**
 * @param {object} c
 * @param {string} c.busqueda        id de la búsqueda en el servidor
 * @param {string} c.nombre          lo buscado
 * @param {number} c.minDuracion     minutos (el filtro de la lista)
 * @param {() => {carpeta: string|null, regla: object|null}} c.destino   «Descargar en»
 * @param {() => Promise<{carpeta, regla}|null>} c.elegirCarpeta
 * @param {(links: string[], o: object) => Promise<object|null>} c.enviar
 * @param {boolean} c.jdConfigurado
 */
export function abrirRecoger(c) {
  let n = Number(leer(CLAVE_N, '20')) || 20;
  let orden = leer(CLAVE_ORDEN, 'largos');
  let soloNombre = true;
  let propuesta = null;
  let pidiendo = 0;
  let { carpeta, regla } = c.destino();

  const chipsN = document.createElement('cg-chips');
  chipsN.setAttribute('unico', '');
  chipsN.className = 'recoger__n';
  for (const valor of [10, 20, 50, 100]) {
    chipsN.append(
      el('button', {
        attrs: { type: 'button', value: String(valor), 'aria-pressed': String(valor === n) },
        text: String(valor),
        on: {
          click: () => {
            n = valor;
            guardar(CLAVE_N, String(n));
            for (const b of chipsN.querySelectorAll('button')) {
              b.setAttribute('aria-pressed', String(Number(b.value) === n));
            }
            pedir();
          },
        },
      })
    );
  }
  const selOrden = el('select', {
    className: 'input',
    children: [
      el('option', { attrs: { value: 'largos' }, text: t('recoger.orden.largos') }),
      el('option', { attrs: { value: 'calidad' }, text: t('recoger.orden.calidad') }),
    ],
    on: {
      change: () => {
        orden = selOrden.value;
        guardar(CLAVE_ORDEN, orden);
        pedir();
      },
    },
  });
  selOrden.value = orden;
  const casillaNombre = el('input', {
    attrs: { type: 'checkbox' },
    on: {
      change: () => {
        soloNombre = casillaNombre.checked;
        pedir();
      },
    },
  });
  casillaNombre.checked = true;
  const etiqueta = el('input', {
    className: 'input',
    attrs: { type: 'text', spellcheck: 'false', placeholder: t('recoger.etiqueta.ej') },
  });
  const repetir = el('input', { attrs: { type: 'checkbox' } });

  const botonCarpeta = el('button', {
    className: 'cg-boton recoger__carpeta',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        await preguntarCarpeta();
        mostrar();
      },
    },
  });
  const estado = el('p', { className: 'recoger__estado', attrs: { role: 'status' } });
  const tengo = el('p', { className: 'recoger__tengo' });
  const lista = el('ol', { className: 'recoger__lista' });
  const fuera = el('p', { className: 'recoger__fuera' });
  const actualizar = el('button', {
    className: 'cg-boton',
    attrs: { type: 'button', hidden: '' },
    text: t('recoger.actualizar'),
    on: { click: () => pedir() },
  });
  const mandar = el('button', {
    className: 'cg-boton cg-boton--principal recoger__mandar',
    attrs: { type: 'button', disabled: '' },
    on: { click: () => enviar() },
  });

  const campo = (texto, control, ayuda) =>
    el('label', {
      className: 'field',
      children: [
        el('span', { className: 'field__label', text: texto }),
        control,
        ayuda ? el('span', { className: 'field__hint', text: ayuda }) : null,
      ],
    });
  const casilla = (input, texto) =>
    el('label', { className: 'cs-casilla', children: [input, el('span', { text: texto })] });

  /*
   * La ventana de carpeta (dialog.js) no es de cg-ui: con la hoja abierta, la hoja le roba el foco
   * y no se puede escribir. Así que la hoja se cierra para elegir y se vuelve a abrir con lo mismo
   * (los nodos pasan a la hoja nueva; el estado vive aquí).
   */
  let hoja = null;
  const contenido = [
    tengo,
    el('div', {
      className: 'field',
      children: [el('span', { className: 'field__label', text: t('recoger.cuantos') }), chipsN],
    }),
    campo(t('recoger.carpeta'), botonCarpeta),
    // Lo que se cambia poco, plegado: así la propuesta se ve sin bajar.
    el('details', {
      className: 'recoger__mas',
      children: [
        el('summary', { text: t('recoger.opciones') }),
        campo(t('recoger.orden'), selOrden),
        casilla(casillaNombre, t('recoger.soloNombre')),
        campo(t('recoger.etiqueta'), etiqueta, t('recoger.etiqueta.hint')),
        casilla(repetir, t('recoger.repetir')),
      ],
    }),
    estado,
    actualizar,
    lista,
    fuera,
  ];
  function mostrar() {
    hoja = abrirHoja({
      titulo: t('recoger.titulo', { nombre: c.nombre }),
      clase: 'recoger',
      contenido,
      pie: [mandar],
    });
  }
  /** Cierra la hoja y pregunta la carpeta. true si se eligió una. */
  async function preguntarCarpeta() {
    hoja?.cerrar();
    const r = await c.elegirCarpeta();
    if (!r || r.preguntar) return false;
    carpeta = r.carpeta;
    regla = r.regla;
    pintar();
    return true;
  }

  const nombreCarpeta = () =>
    carpeta === null ? t('recoger.carpeta.preguntar') : carpeta || t('video.jd.porDefecto');

  function pintar() {
    botonCarpeta.textContent = nombreCarpeta();
    if (!propuesta) return;
    const p = propuesta;
    const ck = p.clipkeeper || {};
    const persona = (ck.personas || [])[0];
    tengo.textContent = !ck.conectado
      ? t('recoger.sinClipkeeper')
      : persona
        ? t('recoger.tienes', { n: persona.videos, nombre: persona.nombre })
        : ck.disponible
          ? t('recoger.tienesNada', { nombre: p.nombre })
          : t('recoger.clipkeeperAntiguo');
    estado.textContent = p.terminada
      ? tp('recoger.listos', p.propuesta.length)
      : t('recoger.sigueBuscando', { n: p.propuesta.length });
    actualizar.hidden = p.terminada;
    lista.replaceChildren(
      ...p.propuesta.map(r =>
        el('li', {
          className: 'recoger__fila',
          children: [
            r.thumbnail
              ? cargarMiniatura(
                  el('img', {
                    className: 'recoger__mini',
                    attrs: { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
                  }),
                  `/api/thumbnail?url=${encodeURIComponent(r.thumbnail)}&s=${r.thumbnailFirma || ''}`
                )
              : el('span', { className: 'recoger__mini' }),
            el('span', {
              className: 'recoger__texto',
              children: [
                el('strong', { text: r.title || r.link }),
                el('small', {
                  text: [r.duration, r.calidad >= 2 ? t(`recoger.calidad.${r.calidad}`) : '']
                    .filter(Boolean)
                    .join(' · '),
                }),
              ],
            }),
          ],
        })
      )
    );
    const d = p.descartes || {};
    const partes = [
      ['tengo', d.tengo],
      ['papelera', d.papelera],
      ['enviado', d.enviado],
      ['sinNombre', d.sinNombre],
      ['repetido', d.repetido],
      ['duracion', d.duracion],
      ['bloqueada', d.bloqueada],
    ]
      .filter(([, v]) => v > 0)
      .map(([k, v]) => t(`recoger.fuera.${k}`, { n: v }));
    fuera.textContent = partes.length ? t('recoger.fuera', { lista: partes.join(', ') }) : '';
    const total = p.propuesta.length;
    mandar.disabled = total === 0 || !c.jdConfigurado;
    mandar.textContent = !c.jdConfigurado
      ? t('recoger.sinGestor')
      : total
        ? carpeta === null
          ? t('recoger.mandarElegir', { n: total })
          : t('recoger.mandar', { n: total, carpeta: nombreCarpeta() })
        : t('recoger.nada');
  }

  async function pedir() {
    const yo = ++pidiendo;
    estado.textContent = t('recoger.calculando');
    mandar.disabled = true;
    try {
      const r = await recoger.propuesta({
        busqueda: c.busqueda,
        nombre: c.nombre,
        n,
        orden,
        soloConNombre: soloNombre,
        minutosMinimo: c.minDuracion || 0,
      });
      if (yo !== pidiendo) return;
      propuesta = r;
      pintar();
    } catch (error) {
      if (yo !== pidiendo) return;
      estado.textContent = error.message;
    }
  }

  async function enviar() {
    if (!propuesta?.propuesta.length) return;
    const links = propuesta.propuesta.map(r => r.link);
    const extra = etiqueta.value.trim();
    const reglaFinal = () =>
      extra || regla
        ? {
            personas: regla?.personas || [],
            etiquetas: [
              ...(regla?.etiquetas || []),
              ...(extra ? [{ nombre: extra, grupo: 'Tipo' }] : []),
            ],
          }
        : null;
    // Sin carpeta fijada, se pregunta antes (con la hoja cerrada); si se cancela, vuelve.
    if (carpeta === null && !(await preguntarCarpeta())) {
      mostrar();
      return;
    }
    mandar.disabled = true;
    const r = await c.enviar(links, {
      carpeta,
      regla: reglaFinal(),
      titulos: propuesta.propuesta.map(x => x.title || ''),
      duraciones: propuesta.propuesta.map(x => x.durationSeconds ?? null),
    });
    if (!r) {
      mandar.disabled = false;
      if (!hoja?.isConnected) mostrar();
      return;
    }
    if (repetir.checked) {
      try {
        await ajustes.guardarProgramada({
          termino: c.nombre,
          carpeta: carpeta || '',
          persona: regla?.personas?.[0]?.nombre || '',
          // NU-4: los alias de la persona también se buscan en cada vuelta.
          alias: propuesta.alias || [],
          etiqueta: extra,
          n,
          soloConNombre: soloNombre,
          orden,
          minutosMinimo: c.minDuracion || 0,
          sinDuracion: true,
          cadaDias: 7,
        });
        toast(t('recoger.programada'), 'success', 5000);
      } catch (error) {
        toast(error.message, 'error', 6000);
      }
    }
    hoja?.cerrar();
  }

  mostrar();
  pintar();
  pedir();
  return hoja;
}
