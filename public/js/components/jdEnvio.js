import { ajustes } from '../api.js';
import { el, toast } from '../dom.js';
import { t, texto, atributo } from '../i18n/index.js';
import { chooseDialog, promptDialog } from './dialog.js';

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
  let ultima = '';

  async function elegirCarpeta(n) {
    if (!destinos) {
      const carpeta = await promptDialog({
        titleKey: 'video.jd.todos',
        labelKey: 'video.jd.carpeta',
        labelParams: { n },
        defaultValue: ultima,
      });
      return carpeta === null ? null : carpeta.trim();
    }
    const opciones = destinos.map(d => ({
      valor: d.carpeta,
      titulo: d.carpeta,
      detalle: [...(d.personas || []), ...(d.etiquetas || [])].join(' · '),
    }));
    opciones.push({
      valor: '',
      titulo: t('video.jd.porDefecto'),
      detalle: t('video.jd.porDefecto.detalle'),
    });
    return chooseDialog({
      titleKey: 'video.jd.todos',
      labelKey: 'video.jd.elegir',
      labelParams: { n },
      opciones,
      nuevaKey: 'video.jd.nueva',
    });
  }

  async function enviar(links) {
    if (links.length === 0) return;
    const carpeta = await elegirCarpeta(links.length);
    if (carpeta === null) return;
    ultima = carpeta.replace(/^\/+|\/+$/g, '');
    try {
      const r = await ajustes.enviarJd({ links, carpeta: ultima, origen: origen() });
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
    /** Avisa cuando se sabe si hay JDownloader (para repintar botones por fila). */
    alCargar: fn => alCargar.add(fn),
  };
}
