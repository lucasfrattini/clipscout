import { el, clear } from '../dom.js';
import { t, tp } from '../i18n/index.js';
import { autoSitio, guardarSitios } from '../api.js';
import { abrirDialogo } from './dialog.js';

/**
 * «Agregar sitios»: se pega la dirección de uno o varios sitios y clipscout hace el resto —encuentra
 * su buscador, la paginación, qué enlaces son vídeos— y lo PRUEBA con una búsqueda real. Solo se
 * pueden guardar los que dieron vídeos en la prueba; los demás dicen en qué paso fallaron.
 *
 * `Promise<number>`: cuántos sitios se guardaron (0 si se cerró sin guardar).
 */

const MOTIVOS = new Set(['buscador', 'listado', 'patron', 'sin_fichas', 'sin_ficheros', 'tiempo']);

function lineas(textoLibre) {
  return [
    ...new Set(
      String(textoLibre || '')
        .split(/[\s,]+/)
        .map(x => x.trim())
        .filter(Boolean)
    ),
  ];
}

export function altaSitiosDialog({ dominios = [], termino = '' } = {}) {
  return abrirDialogo({
    role: 'dialog',
    titleKey: 'alta.titulo',
    valorCancelar: 0,
    render({ cuerpo, acciones, cerrar }) {
      const controlador = new AbortController();
      const ayuda = el('p', { className: 'dialog__text' });
      const etiquetaSitios = el('label', {
        className: 'dialog__label',
        attrs: { for: 'alta-sitios' },
      });
      const sitios = el('textarea', {
        className: 'dialog__input input alta__sitios',
        attrs: { id: 'alta-sitios', rows: 3, spellcheck: 'false', autocomplete: 'off' },
      });
      sitios.value = dominios.join('\n');
      const etiquetaTermino = el('label', {
        className: 'dialog__label',
        attrs: { for: 'alta-termino' },
      });
      const prueba = el('input', {
        className: 'dialog__input input',
        attrs: { id: 'alta-termino', type: 'text', autocomplete: 'off' },
      });
      prueba.value = termino;
      const lista = el('ul', { className: 'alta__lista', attrs: { 'aria-live': 'polite' } });
      cuerpo.classList.add('alta');
      cuerpo.append(ayuda, etiquetaSitios, sitios, etiquetaTermino, prueba, lista);

      /** dominio → { fase: 'cola'|'prueba'|'ok'|'mal'|'ya', r } */
      let filas = new Map();
      let probando = false;

      const salir = n => {
        controlador.abort();
        cerrar(n);
      };
      const botonCerrar = el('button', {
        className: 'button button--secondary',
        attrs: { type: 'button' },
        on: { click: () => salir(0) },
      });
      const botonProbar = el('button', {
        className: 'button button--secondary',
        attrs: { type: 'button' },
        on: { click: () => probarTodos() },
      });
      const botonGuardar = el('button', {
        className: 'button',
        attrs: { type: 'button', disabled: '' },
        on: { click: () => guardar() },
      });
      acciones.append(botonCerrar, botonProbar, botonGuardar);

      const buenos = () => [...filas.values()].filter(f => f.fase === 'ok');

      function pintar() {
        clear(lista);
        for (const [dominio, f] of filas) {
          let estado;
          if (f.fase === 'cola') estado = t('alta.estado.cola');
          else if (f.fase === 'prueba') estado = t('alta.estado.probando');
          else if (f.fase === 'ya') estado = t('alta.estado.ya');
          else if (f.fase === 'ok') {
            const ej = f.r.prueba.ejemplos[0]?.titulo;
            estado =
              tp('alta.estado.ok', f.r.prueba.ficheros) + (ej ? ` · «${ej.slice(0, 60)}»` : '');
          } else {
            estado = MOTIVOS.has(f.r?.motivo)
              ? t(`alta.motivo.${f.r.motivo}`)
              : t('alta.motivo.error', { error: f.r?.error || '' });
          }
          const enCurso = f.fase === 'cola' || f.fase === 'prueba';
          lista.append(
            el('li', {
              className: `alta__fila alta__fila--${f.fase}`,
              children: [
                el('span', {
                  className: enCurso ? 'buscar__girando' : 'alta__icono',
                  text: enCurso ? '' : f.fase === 'ok' ? '✓' : f.fase === 'ya' ? '•' : '✗',
                }),
                el('strong', { text: dominio }),
                el('span', { className: 'alta__estado', text: estado }),
              ],
            })
          );
        }
        const n = buenos().length;
        botonGuardar.textContent = n ? tp('alta.guardar', n) : t('alta.guardar.ninguno');
        botonGuardar.disabled = n === 0 || probando;
        botonProbar.disabled = probando;
      }

      async function probarTodos() {
        const lista = lineas(sitios.value);
        const q = prueba.value.trim();
        if (lista.length === 0) return sitios.focus();
        if (q.length < 2) return prueba.focus();
        probando = true;
        filas = new Map(lista.map(d => [d, { fase: 'cola' }]));
        pintar();
        // Uno detrás de otro: cada prueba abre el navegador, y en paralelo se pisarían.
        for (const dominio of lista) {
          if (controlador.signal.aborted) return;
          filas.set(dominio, { fase: 'prueba' });
          pintar();
          let r;
          try {
            r = await autoSitio(dominio, q, { signal: controlador.signal });
          } catch (error) {
            if (error.name === 'AbortError') return;
            r = { ok: false, error: error.message };
          }
          filas.set(dominio, { fase: r.yaGuardado ? 'ya' : r.ok ? 'ok' : 'mal', r });
          pintar();
        }
        probando = false;
        pintar();
      }

      async function guardar() {
        const elegidos = buenos().map(f => ({ nombre: f.r.nombre, config: f.r.config }));
        if (elegidos.length === 0) return;
        botonGuardar.disabled = true;
        try {
          const r = await guardarSitios(elegidos);
          salir(r.guardados);
        } catch (error) {
          ayuda.textContent = error.message;
          botonGuardar.disabled = false;
        }
      }

      return {
        focoInicial: dominios.length ? prueba : sitios,
        refrescar() {
          ayuda.textContent = t('alta.ayuda');
          etiquetaSitios.textContent = t('alta.sitios');
          sitios.placeholder = t('alta.sitios.placeholder');
          etiquetaTermino.textContent = t('alta.termino');
          botonCerrar.textContent = t('alta.cerrar');
          botonProbar.textContent = t('alta.probar');
          pintar();
        },
      };
    },
  });
}
