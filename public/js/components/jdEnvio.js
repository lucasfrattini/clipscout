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
  let ultima = null; // la última carpeta elegida en esta lista (se propone la primera)

  /**
   * Carpeta NUEVA: ¿de quién o de qué es? Con eso la carpeta va a su sitio (People/…,
   * Categories/…) y clipkeeper cataloga solo lo que llegue (persona con su rol, o categoría/etiqueta).
   */
  async function tipoDeCarpetaNueva(texto) {
    const limpio = texto.replace(/^\/+|\/+$/g, '');
    const nombre = limpio.split('/').pop();
    const ruta = prefijo => (limpio.includes('/') ? limpio : `${prefijo}/${nombre}`);
    const opciones = [
      { valor: 'actriz', titulo: t('jd.tipo.actriz'), detalle: ruta('People') },
      { valor: 'actor', titulo: t('jd.tipo.actor'), detalle: ruta('People') },
      { valor: 'artista', titulo: t('jd.tipo.artista'), detalle: ruta('People') },
      { valor: 'categoria', titulo: t('jd.tipo.categoria'), detalle: ruta('Categories') },
      { valor: 'etiqueta', titulo: t('jd.tipo.etiqueta'), detalle: ruta('Unsorted') },
      { valor: 'carpeta', titulo: t('jd.tipo.carpeta'), detalle: limpio },
    ];
    const tipo = await chooseDialog({
      titleKey: 'jd.tipo.titulo',
      labelKey: 'jd.tipo.label',
      labelParams: { nombre },
      opciones,
    });
    if (tipo === null) return null;
    if (tipo === 'carpeta') return { carpeta: limpio, regla: null };
    if (['actriz', 'actor', 'artista'].includes(tipo)) {
      return { carpeta: ruta('People'), regla: { personas: [{ nombre, rol: tipo }] } };
    }
    if (tipo === 'categoria') {
      return { carpeta: ruta('Categories'), regla: { etiquetas: [{ nombre, grupo: 'Tipo' }] } };
    }
    return { carpeta: ruta('Unsorted'), regla: { etiquetas: [{ nombre, grupo: 'Etiqueta' }] } };
  }

  async function elegirCarpeta(n) {
    if (!destinos) {
      const carpeta = await promptDialog({
        titleKey: 'video.jd.todos',
        labelKey: 'video.jd.carpeta',
        labelParams: { n },
        defaultValue: ultima || '',
      });
      return carpeta === null ? null : { carpeta: carpeta.trim(), regla: null };
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
    // La última que se usó en esta lista, la primera: lo normal es seguir mandando ahí.
    if (ultima !== null) {
      const i = opciones.findIndex(o => o.valor === ultima);
      const previa = i >= 0 ? opciones.splice(i, 1)[0] : { valor: ultima, titulo: ultima };
      opciones.unshift({ ...previa, detalle: t('jd.ultima') });
    }
    const elegida = await chooseDialog({
      titleKey: 'video.jd.todos',
      labelKey: 'video.jd.elegir',
      labelParams: { n },
      opciones,
      nuevaKey: 'video.jd.nueva',
    });
    if (elegida === null) return null;
    if (opciones.some(o => o.valor === elegida)) return { carpeta: elegida, regla: null };
    return tipoDeCarpetaNueva(elegida);
  }

  /** Crear una carpeta nueva ahora (nombre y qué es), sin mandar nada todavía. */
  async function nuevaCarpeta() {
    const nombre = await promptDialog({
      titleKey: 'jd.tipo.titulo',
      labelKey: 'jd.nueva.nombre',
      defaultValue: '',
    });
    if (nombre === null || !nombre.trim()) return null;
    return tipoDeCarpetaNueva(nombre.trim());
  }

  /** `carpeta` fijada de antemano (p. ej. «Descargar en» del buscador): no se pregunta. */
  async function enviar(links, { carpeta, regla = null } = {}) {
    if (links.length === 0) return;
    const elegido = carpeta !== undefined ? { carpeta, regla } : await elegirCarpeta(links.length);
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
