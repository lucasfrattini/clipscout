/**
 * Piezas de la vista Avanzada (explorer.js) que no dependen de su estado: los constructores de
 * campos, los ejemplos de paginación, las cifras del resultado y el panel de la propuesta de
 * configuración. Salen de explorer.js (CS-22), que pasaba de 2.100 líneas en una sola función.
 */

import { el, alertBox } from '../../dom.js';
import { t, texto, atributo } from '../../i18n/index.js';

/**
 * Ejemplos de paginación.
 *
 * Los dos modos (parámetro y plantilla {page}) no son obvios mirando el
 * formulario, así que se muestran casos reales: la URL tal como la ve el
 * usuario en el navegador y qué tiene que rellenar en cada caso.
 */
export function paginationExamples() {
  // `cambio` y `valor` NO se traducen: son literalmente lo que el usuario ve
  // en la barra del navegador y lo que tiene que escribir. Traducirlos
  // convertiría un ejemplo copiable en uno inservible.
  const CASES = [
    { cambio: '?page=2', campo: 'ejemplos.campo.parametro', valor: 'page' },
    { cambio: '/page/2', campo: 'ejemplos.campo.url', valor: '…/page/{page}' },
    { cambio: '/01, /02', campo: 'ejemplos.campo.url', valor: '…/{page:02}' },
  ];

  return el('div', {
    className: 'examples',
    children: [
      texto(el('p', { className: 'examples__title' }), 'ejemplos.titulo'),
      el('ul', {
        className: 'examples__list',
        children: CASES.map(item =>
          el('li', {
            className: 'examples__item',
            children: [
              el('code', { className: 'examples__url', text: item.cambio }),
              el('span', {
                className: 'examples__arrow',
                text: '→',
                attrs: { 'aria-hidden': 'true' },
              }),
              texto(el('span', { className: 'examples__field' }), item.campo),
              el('code', { className: 'examples__value', text: item.valor }),
            ],
          })
        ),
      }),
    ],
  });
}

/**
 * Los constructores de campos del formulario. Escriben el input en `fields` (el contrato con los
 * perfiles y con `readForm()`) o en `uiInputs` (controles solo de la interfaz).
 */
export function crearConstructores({ fields, uiInputs }) {
  /**
   * Los helpers reciben CLAVES de traducción, no texto.
   *
   * Es lo que evita que vuelva a colarse una cadena escrita a mano: si el
   * segundo argumento fuese una frase, escribirla directamente seguiría
   * funcionando y nadie lo notaría hasta cambiar de idioma y ver ese trozo
   * en español.
   *
   * `placeholderKey` va aparte de `inputAttrs` porque también se traduce, y
   * `hintParams` existe para las ayudas con números (los topes vienen del
   * servidor, no del diccionario).
   */
  const makeField = (name, labelKey, hintKey, inputAttrs = {}, opciones = {}) => {
    const { placeholderKey, hintParams } = opciones;
    const input = el('input', {
      className: 'input',
      attrs: { id: `explorer-${name}`, name, ...inputAttrs },
    });
    if (placeholderKey) atributo(input, 'placeholder', placeholderKey);
    fields[name] = input;

    const label = texto(
      el('label', { className: 'field__label', attrs: { for: `explorer-${name}` } }),
      labelKey
    );
    const hint = hintKey ? texto(el('p', { className: 'field__hint' }), hintKey, hintParams) : null;

    return el('div', { className: 'field', children: [label, input, hint] });
  };

  const makeSwitch = (name, titleKey, hintKey) => {
    const input = el('input', { attrs: { type: 'checkbox', id: `explorer-${name}`, name } });
    fields[name] = input;
    return el('label', {
      className: 'switch',
      attrs: { for: `explorer-${name}` },
      children: [
        input,
        el('span', {
          className: 'switch__text',
          children: [
            texto(el('span', { className: 'switch__title' }), titleKey),
            texto(el('span', { className: 'switch__hint' }), hintKey),
          ],
        }),
      ],
    });
  };

  /**
   * Una opción de un selector segmentado (un radio por debajo).
   *
   * El rótulo visible es la clave `.breve`; la explicación larga va al `title`
   * en vez de debajo. Es lo que permite que tres opciones ocupen una línea en
   * vez de tres tarjetas, sin perder la explicación para quien la busque.
   */
  const makeSegment = (group, value, labelKey, hintKey, { checked = false } = {}) => {
    const id = `explorer-${group}-${value}`;
    const input = el('input', {
      attrs: { type: 'radio', name: `explorer-${group}`, id, value, checked },
    });
    uiInputs.push(input);

    const root = el('label', {
      className: 'segmented__option',
      attrs: { for: id },
      children: [input, texto(el('span', { className: 'segmented__label' }), labelKey)],
    });
    if (hintKey) atributo(root, 'title', hintKey);

    return { root, input, value };
  };

  const makeSegmented = opciones =>
    el('div', {
      className: 'segmented',
      attrs: { role: 'group' },
      children: opciones.map(o => o.root),
    });

  /**
   * Interruptor con forma de chip, para lo que se decide de un vistazo.
   *
   * Mismo `input[type=checkbox]` de siempre —sigue en `fields`, sigue viajando
   * al servidor—; lo único que cambia es que ocupa una línea compartida en vez
   * de un bloque con título y ayuda.
   */
  const makeChipToggle = (name, labelKey, hintKey, marcado = false) => {
    // `checked` como atributo: es el valor por defecto, el que respeta también form.reset().
    const input = el('input', {
      attrs: {
        type: 'checkbox',
        id: `explorer-${name}`,
        name,
        ...(marcado ? { checked: true } : {}),
      },
    });
    fields[name] = input;

    const root = el('label', {
      className: 'chip chip--toggle',
      attrs: { for: `explorer-${name}` },
      children: [input, texto(el('span', { className: 'chip__label' }), labelKey)],
    });
    atributo(root, 'title', hintKey);
    return root;
  };

  return { makeField, makeSwitch, makeSegment, makeSegmented, makeChipToggle };
}

/**
 * Tarjeta KPI destacada.
 *
 * `acento` es la que de verdad importa a simple vista (archivos o enlaces
 * encontrados); `advertencia` es para "Ocultados manualmente", que solo
 * aparece si hay alguno y conviene que se note.
 */
function kpiCard(valor, etiqueta, { acento = false, advertencia = false } = {}) {
  const clases = ['kpi'];
  if (acento) clases.push('kpi--acento');
  if (advertencia) clases.push('kpi--advertencia');
  return el('div', {
    className: clases.join(' '),
    children: [
      el('div', { className: 'kpi__valor', text: valor }),
      el('div', { className: 'kpi__etiqueta', text: etiqueta }),
    ],
  });
}

/** Las tarjetas KPI y la línea de detalle del último `complete` (ver renderStats en explorer.js). */
export function pintarCifras(datos, { gruposActivos = 0, ocultosManualmente = 0 } = {}) {
  const deepSearch = datos.extensions?.length > 0;

  const cards = [
    deepSearch
      ? kpiCard(datos.totalFiles ?? 0, t('kpi.archivos'), { acento: true })
      : kpiCard(datos.totalLinks ?? 0, t('kpi.enlaces'), { acento: true }),
    kpiCard(datos.direccionesAnalizadas ?? 1, t('kpi.direcciones')),
    kpiCard(gruposActivos, t('kpi.duplicados')),
  ];

  if (ocultosManualmente > 0) {
    cards.push(kpiCard(ocultosManualmente, t('kpi.ocultos'), { advertencia: true }));
  }

  const detalle =
    datos.pagesScraped !== undefined && datos.durationMs !== undefined
      ? t('kpi.detalle', {
          paginas: datos.pagesScraped,
          segundos: (datos.durationMs / 1000).toFixed(1),
        }) +
        (datos.failures?.length > 0 ? t('kpi.detalle.fallidas', { n: datos.failures.length }) : '')
      : '';

  return [
    el('div', { className: 'kpi-grid', children: cards }),
    detalle ? el('p', { className: 'field__hint', text: detalle }) : null,
  ];
}

/** Una fila del panel: qué se propone y por qué. */
function filaPropuesta(campo, valor, motivo, confianza) {
  return el('li', {
    className: 'propuesta__item',
    children: [
      el('div', {
        className: 'propuesta__cabecera',
        children: [
          el('span', { className: 'propuesta__campo', text: campo }),
          el('code', { className: 'propuesta__valor', text: valor || t('propuesta.vacio') }),
          confianza
            ? el('span', {
                className: `badge badge--${confianza === 'alta' ? 'success' : 'accent'}`,
                // El nivel lo nombra el servidor ("alta"/"media"): se muestra
                // tal cual, ver la limitación anotada en CLAUDE.md.
                text: t('propuesta.confianza', { nivel: confianza }),
              })
            : null,
        ],
      }),
      el('p', { className: 'propuesta__motivo', text: motivo }),
    ],
  });
}

/**
 * El panel con la propuesta de la detección: qué se propone en cada campo y por qué. Se presenta
 * como propuesta, no como verdad: acierta casi siempre, no siempre.
 */
export function panelPropuesta(resultado, { alCerrar }) {
  const { sugerencia, motivos, confianza, avisos, analizado, alternativas } = resultado;

  const filas = [
    filaPropuesta(
      t('propuesta.campo.patron'),
      sugerencia.linkPattern,
      motivos.patron,
      confianza.patron
    ),
    filaPropuesta(
      t('propuesta.campo.paginacion'),
      sugerencia.pageParam
        ? t('propuesta.parametro', { valor: sugerencia.pageParam })
        : sugerencia.searchUrl,
      motivos.paginacion,
      confianza.paginacion
    ),
    filaPropuesta(
      t('propuesta.campo.navegador'),
      t(sugerencia.useJavaScript ? 'propuesta.si' : 'propuesta.no'),
      motivos.navegador
    ),
    filaPropuesta(t('propuesta.campo.extensiones'), sugerencia.fileExtensions, motivos.extensiones),
  ];

  if (alternativas?.linkPattern) {
    filas.push(
      filaPropuesta(
        t('propuesta.campo.alternativo'),
        alternativas.linkPattern,
        t('propuesta.alternativo.motivo')
      )
    );
  }

  return el('div', {
    className: 'card propuesta',
    children: [
      el('div', {
        className: 'card__header card__header--con-cierre',
        children: [
          el('div', {
            children: [
              el('h3', { className: 'card__title', text: t('propuesta.titulo') }),
              el('p', {
                className: 'card__hint',
                text: t('propuesta.hint', {
                  conNavegador: analizado.enlacesConNavegador,
                  sinNavegador: analizado.enlacesSinNavegador,
                }),
              }),
            ],
          }),
          // Cierre propio del panel: antes solo se ocultaba al volver a
          // pulsar "Configurar por mí" o al limpiar el formulario. El
          // botón de "Limpiar" (`resetButton`) no se toca: esta X es la
          // única forma nueva de cerrar el panel sin vaciar el formulario.
          el('button', {
            className: 'cg-boton cg-boton--icono',
            text: '×',
            attrs: { type: 'button', 'aria-label': t('propuesta.cerrar') },
            on: { click: alCerrar },
          }),
        ],
      }),
      el('div', {
        className: 'card__body',
        children: [
          el('ul', { className: 'propuesta__lista', children: filas }),
          // El cuerpo del aviso lo redacta el servidor y se muestra tal cual
          ...avisos.map(aviso =>
            alertBox({ variant: 'warning', title: t('propuesta.aviso'), body: aviso })
          ),
        ],
      }),
    ],
  });
}
