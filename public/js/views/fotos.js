/**
 * Pestaña «Fotos» de Buscar (fase 7, FO-1…FO-5): los álbumes de lo buscado en los sitios que tienen
 * sección de álbumes (plantilla en su configuración) y, si hay SearXNG, en la web (solo lo que
 * nombra a la persona). Se eligen álbumes y «Mandar a <persona>»: la persona sale de la lista de
 * clipkeeper (C1) y cada álbum va en su paquete a <carpeta de la persona>/Fotos/<álbum>.
 *
 * Es una hoja, como «Recoger»: no cambia nada de la lista de vídeos. clipscout nunca descarga: los
 * enlaces directos de las fotos van al gestor de descargas.
 */
import { fase7 } from '../api.js';
import { el, toast } from '../dom.js';
import { t, tp } from '../i18n/index.js';
import { abrirHoja } from '../hojas.js';

const normal = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const miniatura = (url, firma) =>
  url ? `/api/thumbnail?url=${encodeURIComponent(url)}&s=${firma || ''}` : '';

/**
 * @param {object} c
 * @param {string} c.q               lo buscado
 * @param {boolean} c.jdConfigurado
 */
export function abrirFotos(c) {
  let albumes = [];
  let personas = [];
  let conectado = false;
  const elegidos = new Set(); // url
  let enviando = false;

  const estado = el('p', { className: 'fotos__estado', attrs: { role: 'status' } });
  const notas = el('p', { className: 'fotos__notas' });
  const rejilla = el('ul', { className: 'fotos__rejilla' });
  const selPersona = el('select', {
    className: 'input',
    attrs: { 'aria-label': t('fotos.persona') },
    on: { change: () => pintarBoton() },
  });
  const textoPersona = el('input', {
    className: 'input',
    attrs: { type: 'text', spellcheck: 'false', hidden: '', placeholder: t('fotos.persona.ej') },
    on: { input: () => pintarBoton() },
  });
  const campoPersona = el('label', {
    className: 'field',
    children: [
      el('span', { className: 'field__label', text: t('fotos.persona') }),
      selPersona,
      textoPersona,
    ],
  });
  const mandar = el('button', {
    className: 'cg-boton cg-boton--principal fotos__mandar',
    attrs: { type: 'button', disabled: '' },
    on: { click: () => enviar() },
  });

  const hoja = abrirHoja({
    titulo: t('fotos.titulo', { q: c.q }),
    clase: 'fotos',
    contenido: [estado, notas, rejilla],
    pie: [campoPersona, mandar],
  });

  const personaElegida = () => {
    if (!conectado || personas.length === 0) {
      const nombre = textoPersona.value.trim();
      return nombre ? { nombre } : null;
    }
    const p = personas[Number(selPersona.value)];
    return p
      ? {
          nombre: p.nombre,
          carpeta: p.carpeta || `People/${p.nombre}`,
          carpeta_fotos: p.carpeta_fotos,
          biblioteca_id: p.biblioteca_id,
        }
      : null;
  };

  function pintarBoton() {
    const p = personaElegida();
    const n = elegidos.size;
    mandar.disabled = enviando || !c.jdConfigurado || n === 0 || !p;
    mandar.textContent = !c.jdConfigurado
      ? t('recoger.sinGestor')
      : n === 0
        ? t('fotos.elige')
        : p
          ? tp('fotos.mandar', n, { persona: p.nombre })
          : t('fotos.eligePersona');
  }

  function textoTengo(a) {
    const e = a.tengo?.estado;
    if (e === 'tengo') return t('fotos.tengo');
    if (e === 'faltan') return t('fotos.faltan', { n: a.tengo.n ?? 0 });
    if (e === 'en_camino') return t('fotos.enCamino');
    return '';
  }

  function tarjeta(a) {
    const activo = elegidos.has(a.url);
    const tengo = textoTengo(a);
    const boton = el('button', {
      className: 'fotos__album',
      attrs: { type: 'button', 'aria-pressed': String(activo) },
      on: {
        click: () => {
          if (elegidos.has(a.url)) elegidos.delete(a.url);
          else elegidos.add(a.url);
          boton.setAttribute('aria-pressed', String(elegidos.has(a.url)));
          pintarBoton();
        },
      },
      children: [
        a.thumbnail
          ? el('img', {
              className: 'fotos__portada',
              attrs: {
                src: miniatura(a.thumbnail, a.thumbnailFirma),
                alt: '',
                loading: 'lazy',
                referrerpolicy: 'no-referrer',
              },
              // Portada que no carga: hueco gris en vez del icono de imagen rota.
              on: { error: e => e.target.replaceWith(el('span', { className: 'fotos__portada' })) },
            })
          : el('span', { className: 'fotos__portada' }),
        el('span', {
          className: 'fotos__texto',
          children: [
            el('strong', { text: a.titulo }),
            el('small', {
              text: [
                Number.isFinite(a.n_fotos) ? tp('fotos.nFotos', a.n_fotos) : '',
                a.origen === 'web' ? t('fotos.web') : a.sitio,
              ]
                .filter(Boolean)
                .join(' · '),
            }),
            tengo ? el('span', { className: 'fotos__tengo', text: tengo }) : null,
          ],
        }),
      ],
    });
    return el('li', { children: [boton] });
  }

  function pintar() {
    rejilla.replaceChildren(...albumes.map(tarjeta));
    pintarBoton();
  }

  async function cargarPersonas() {
    try {
      const r = await fase7.personas();
      conectado = Boolean(r.conectado);
      personas = r.personas || [];
    } catch {
      conectado = false;
      personas = [];
    }
    const q = normal(c.q);
    const propia = personas.findIndex(p =>
      [p.nombre, ...(p.alias || [])].some(n => normal(n) === q)
    );
    selPersona.replaceChildren(
      el('option', { attrs: { value: '' }, text: t('fotos.eligePersona') }),
      ...personas.map((p, i) => el('option', { attrs: { value: String(i) }, text: p.nombre }))
    );
    if (propia >= 0) selPersona.value = String(propia);
    const sinLista = !conectado || personas.length === 0;
    selPersona.hidden = sinLista;
    textoPersona.hidden = !sinLista;
    if (sinLista && !textoPersona.value) textoPersona.value = c.q;
    pintarBoton();
  }

  async function buscar() {
    estado.textContent = t('fotos.buscando');
    try {
      const r = await fase7.buscarFotos(c.q);
      albumes = r.albumes || [];
      const fallidos = (r.sitios || []).filter(s => s.error).map(s => s.nombre);
      estado.textContent = albumes.length
        ? tp('fotos.encontrados', albumes.length)
        : (r.sitios || []).length || r.web?.disponible
          ? t('fotos.nada')
          : t('fotos.sinSitios');
      notas.textContent = fallidos.length
        ? t('fotos.fallaron', { lista: fallidos.join(', ') })
        : '';
      // Lo que no tengo, elegido de entrada: así suele bastar un toque.
      for (const a of albumes) if (!a.tengo?.estado) elegidos.add(a.url);
      pintar();
    } catch (error) {
      estado.textContent = error.message;
    }
  }

  async function enviar() {
    const persona = personaElegida();
    const lista = albumes.filter(a => elegidos.has(a.url));
    if (!persona || !lista.length) return;
    enviando = true;
    pintarBoton();
    try {
      const { trabajo } = await fase7.mandarFotos({ persona, albumes: lista });
      estado.textContent = t('fotos.mandando');
      let r = null;
      for (let i = 0; i < 600; i += 1) {
        await new Promise(res => setTimeout(res, 1000));
        r = await fase7.envioFotos(trabajo);
        estado.textContent = t('fotos.mandandoN', { hechos: r.hechos, total: r.total });
        if (r.estado !== 'mandando') break;
      }
      const ok = (r?.resultados || []).filter(x => x.enviados > 0);
      const mal = (r?.resultados || []).filter(x => !x.enviados);
      toast(
        tp('fotos.mandados', ok.length, {
          fotos: ok.reduce((n, x) => n + x.enviados, 0),
          persona: persona.nombre,
        }),
        ok.length ? 'success' : 'error',
        6000
      );
      if (mal.length) toast(t('fotos.sinFotos', { n: mal.length }), 'error', 6000);
      for (const x of ok) {
        const a = albumes.find(y => y.url === x.url);
        if (a) a.tengo = { estado: 'tengo', n: x.enviados };
        elegidos.delete(x.url);
      }
      estado.textContent = '';
      pintar();
    } catch (error) {
      toast(error.message, 'error', 6000);
    } finally {
      enviando = false;
      pintarBoton();
    }
  }

  // Al irse a otra pantalla, la hoja se cierra (si no, quedaba encima de la siguiente).
  const alSalir = () => hoja?.cerrar?.();
  window.addEventListener('hashchange', alSalir, { once: true });
  hoja.addEventListener('cg-cerrar', () => window.removeEventListener('hashchange', alSalir), {
    once: true,
  });

  cargarPersonas();
  buscar();
  return hoja;
}
