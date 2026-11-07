import { ajustes } from '../api.js';
import { el, toast } from '../dom.js';
import { t, texto, atributo } from '../i18n/index.js';
import { promptDialog } from './dialog.js';

/**
 * Enviar a JDownloader en grupos, compartido por el Explorador y la vista Vídeos.
 *
 * Cada URL puede tener un destino (subcarpeta de las descargas de JDownloader). Los destinos
 * salen de clipkeeper —las subcarpetas de la biblioteca donde descarga JDownloader, con las
 * personas y etiquetas que heredará lo que llegue— más las carpetas nuevas que se creen aquí.
 *
 * `visibles()` devuelve las URLs que se ven (para «Agrupar visibles» y «Enviar a JDownloader»),
 * `origen()` la página analizada si es una sola, y `alCambiar()` repinta la lista.
 */
export function createJdGrupos({ visibles, origen = () => '', alCambiar = () => {} }) {
  const asignados = new Map();
  const carpetasNuevas = [];
  let destinos = [];
  let configurado = false;
  let ultimaCarpeta = '';

  async function enviarPreguntando(links) {
    if (links.length === 0) return;
    const carpeta = await promptDialog({
      titleKey: 'video.jd.todos',
      labelKey: 'video.jd.carpeta',
      labelParams: { n: links.length },
      defaultValue: ultimaCarpeta,
    });
    if (carpeta === null) return;
    ultimaCarpeta = carpeta.trim();
    try {
      const r = await ajustes.enviarJd({ links, carpeta: ultimaCarpeta, origen: origen() });
      toast(
        r.carpeta
          ? t('video.jd.enviadosA', { n: r.enviados, carpeta: r.carpeta })
          : t('video.jd.enviados', { n: r.enviados }),
        'success',
        5000
      );
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }

  async function enviarGrupos(urls) {
    const grupos = new Map();
    for (const url of urls) {
      const carpeta = asignados.get(url);
      if (carpeta === undefined) continue;
      if (!grupos.has(carpeta)) grupos.set(carpeta, []);
      grupos.get(carpeta).push(url);
    }
    if (grupos.size === 0) return;
    let enviados = 0;
    try {
      for (const [carpeta, links] of grupos) {
        const r = await ajustes.enviarJd({ links, carpeta, origen: origen() });
        enviados += r.enviados;
        for (const l of links) asignados.delete(l);
      }
      toast(t('video.jd.enviadosGrupos', { n: enviados, g: grupos.size }), 'success', 5000);
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
    alCambiar();
  }

  function etiquetaDestino(d) {
    const extra = [...(d.personas || []), ...(d.etiquetas || [])];
    return extra.length ? `${d.carpeta} · ${extra.join(', ')}` : d.carpeta;
  }

  function selector(valor, alElegir, textoVacio = t('video.jd.destino.ninguno')) {
    const opciones = [el('option', { attrs: { value: '' }, text: textoVacio })];
    const conocidas = new Set();
    for (const d of destinos) {
      conocidas.add(d.carpeta);
      opciones.push(el('option', { attrs: { value: d.carpeta }, text: etiquetaDestino(d) }));
    }
    for (const c of carpetasNuevas) {
      if (!conocidas.has(c)) opciones.push(el('option', { attrs: { value: c }, text: `${c} ✚` }));
    }
    opciones.push(
      el('option', { attrs: { value: '__nueva__' }, text: t('video.jd.destino.nueva') })
    );
    const select = el('select', {
      className: 'input input--small jd-destino',
      attrs: { 'aria-label': t('video.jd.destino'), title: t('video.jd.destino') },
      children: opciones,
    });
    select.value = valor ?? '';
    select.addEventListener('click', e => e.stopPropagation());
    select.addEventListener('change', async () => {
      if (select.value !== '__nueva__') {
        alElegir(select.value === '' ? undefined : select.value);
        return;
      }
      const nombre = await promptDialog({
        titleKey: 'video.jd.destino.nuevaTitulo',
        labelKey: 'video.jd.destino.nuevaLabel',
      });
      const limpio = (nombre || '').trim().replace(/^\/+|\/+$/g, '');
      if (!limpio) {
        select.value = valor ?? '';
        return;
      }
      if (!carpetasNuevas.includes(limpio)) carpetasNuevas.push(limpio);
      alElegir(limpio);
    });
    return select;
  }

  function asignar(urls, carpeta) {
    for (const u of urls) {
      if (carpeta === undefined) asignados.delete(u);
      else asignados.set(u, carpeta);
    }
    alCambiar();
  }

  // ── Barra (va en la cabecera de resultados) ─────────────────────────
  const agruparHueco = el('span', { className: 'jd-agrupar' });
  const enviarTodos = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => enviarPreguntando(visibles()) },
  });
  texto(enviarTodos, 'video.jd.todos');
  atributo(enviarTodos, 'title', 'video.jd.todos.titulo');
  const cola = el('button', {
    className: 'button button--small',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => enviarGrupos([...asignados.keys()]) },
  });
  atributo(cola, 'title', 'video.jd.cola.titulo');

  function pintarBarra() {
    const n = asignados.size;
    const g = new Set(asignados.values()).size;
    enviarTodos.hidden = !configurado;
    cola.hidden = !configurado || n === 0;
    cola.textContent = t('video.jd.cola', { n, g });
    agruparHueco.replaceChildren(
      configurado
        ? selector(
            '',
            carpeta => {
              if (carpeta !== undefined) asignar(visibles(), carpeta);
            },
            t('video.jd.agrupar')
          )
        : ''
    );
  }

  async function cargar() {
    let jd = {};
    try {
      jd = await ajustes.jdownloader();
      configurado = Boolean(jd.url);
    } catch {
      configurado = false;
    }
    destinos = [];
    if (configurado && jd.biblioteca !== null && jd.biblioteca !== undefined) {
      try {
        const d = await ajustes.destinos();
        const b = (d.bibliotecas || []).find(x => x.id === jd.biblioteca);
        destinos = b ? b.carpetas : [];
      } catch {
        destinos = [];
      }
    }
    pintarBarra();
    alCambiar();
  }
  cargar();
  window.addEventListener('clipscout:jdownloader', cargar);

  return {
    /** Nodos para la cabecera de resultados. */
    barra: [agruparHueco, enviarTodos, cola],
    pintarBarra,
    configurado: () => configurado,
    /** Controles de una fila/tarjeta: destino + enviar este. Vacío si no hay JDownloader. */
    controles(url) {
      if (!configurado || !/^https?:\/\//i.test(url)) return [];
      return [
        selector(asignados.get(url), carpeta => asignar([url], carpeta)),
        el('button', {
          className: 'button button--secondary button--small',
          text: t('video.jd.boton'),
          attrs: { type: 'button', title: t('video.jd.boton.titulo') },
          on: {
            click: e => {
              e.stopPropagation();
              return asignados.has(url) ? enviarGrupos([url]) : enviarPreguntando([url]);
            },
          },
        }),
      ];
    },
    limpiar() {
      asignados.clear();
      pintarBarra();
    },
  };
}
