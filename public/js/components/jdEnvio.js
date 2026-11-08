import { ajustes } from '../api.js';
import { el, toast } from '../dom.js';
import { t, texto, atributo } from '../i18n/index.js';
import { carpetaDialog } from './dialog.js';

/**
 * «Enviar a JDownloader», compartido por el Explorador y la vista Vídeos.
 *
 * Al pulsarlo se elige la carpeta de destino: las subcarpetas de la biblioteca de clipkeeper donde
 * descarga JDownloader (con las personas y etiquetas que heredará lo que llegue), o una nueva. Todo
 * lo enviado de una vez va en UN paquete de JDownloader, a esa carpeta.
 *
 * `visibles()` devuelve las URLs que se ven; `origen()` la página analizada si es una sola.
 */
export function createJdEnvio({ visibles, origen = () => '' }) {
  let configurado = false;
  let destinos = null; // null = sin biblioteca de clipkeeper: se escribe la subcarpeta a mano
  let catalogo = {}; // personas y etiquetas de clipkeeper, aunque no tengan carpeta propia
  let ultima = null; // la última carpeta elegida en esta lista (se propone la primera)

  /** Carpeta en dos pasos (qué es → nombre); ver carpetaDialog. */
  function elegirCarpeta() {
    return carpetaDialog({
      existentes: (destinos || []).map(d => d.carpeta),
      catalogo,
      ultima,
    });
  }

  /** Para fijar la carpeta de toda una lista («Descargar en»): lo mismo, más «Preguntar cada vez». */
  function nuevaCarpeta() {
    return carpetaDialog({
      existentes: (destinos || []).map(d => d.carpeta),
      catalogo,
      ultima,
      conPreguntar: true,
    });
  }

  /** `carpeta` fijada de antemano (p. ej. «Descargar en» del buscador): no se pregunta. */
  async function enviar(links, { carpeta, regla = null } = {}) {
    if (links.length === 0) return;
    const elegido = carpeta !== undefined ? { carpeta, regla } : await elegirCarpeta();
    if (elegido === null) return;
    ultima = elegido.carpeta.replace(/^\/+|\/+$/g, '');
    try {
      const r = await ajustes.enviarJd({
        links,
        carpeta: ultima,
        origen: origen(),
        regla: elegido.regla,
      });
      toast(
        r.carpeta
          ? t('video.jd.enviadosA', { n: r.enviados, carpeta: r.carpeta })
          : t('video.jd.enviados', { n: r.enviados }),
        'success',
        5000
      );
      if (r.regla && !r.regla.ok) {
        toast(t('jd.reglaError', { error: r.regla.error }), 'error', 6000);
      }
      // La carpeta nueva ya existe para la próxima vez
      if (elegido.regla) cargar();
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  }

  const boton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button', hidden: '' },
    on: { click: () => enviar(visibles()) },
  });
  texto(boton, 'video.jd.todos');
  atributo(boton, 'title', 'video.jd.todos.titulo');

  const alCargar = new Set();
  async function cargar() {
    let jd = {};
    try {
      jd = await ajustes.jdownloader();
      configurado = Boolean(jd.url);
    } catch {
      configurado = false;
    }
    destinos = null;
    if (configurado && jd.biblioteca !== null && jd.biblioteca !== undefined) {
      try {
        const d = await ajustes.destinos();
        const b = (d.bibliotecas || []).find(x => x.id === jd.biblioteca);
        destinos = b ? b.carpetas : null;
        catalogo = d.catalogo || {};
      } catch {
        destinos = null;
      }
    }
    boton.hidden = !configurado;
    alCargar.forEach(fn => fn());
  }
  cargar();
  window.addEventListener('clipscout:jdownloader', cargar);

  return {
    boton,
    enviar,
    configurado: () => configurado,
    /** Carpetas de clipkeeper (o null) y la última usada, para un «Descargar en» fijo. */
    destinos: () => destinos,
    nuevaCarpeta,
    ultima: () => ultima,
    /** Avisa cuando se sabe si hay JDownloader (para repintar botones por fila). */
    alCargar: fn => alCargar.add(fn),
  };
}
