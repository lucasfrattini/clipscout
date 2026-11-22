/*
 * cg-ui — paquete común de interfaz de Clipgeist (clipkeeper · clipscout · clonbuster).
 *
 * COPIA IDÉNTICA BYTE A BYTE en las tres apps. La canónica es la de clonbuster
 * (src/clonbuster/web/cg/); se cambia ahí y se copia. API y ejemplos: LEEME.md y cg-ui.html.
 *
 * Script clásico (no módulo), sin dependencias: al cargarse registra los custom elements
 *   <cg-barra-inferior> <cg-cabecera> <cg-hoja> <cg-dialogo> <cg-aviso> <cg-chips> <cg-barra-accion>
 * y deja las funciones cgAviso(), cgConfirmar(), cgSeleccion() y cgIcono() como globales y en window.cg.
 * Sin shadow DOM: los estilos (cg-ui.css) se pueden ajustar desde cada app. Los componentes no
 * mueven los hijos del autor (solo añaden los suyos), para que React pueda seguir gestionándolos.
 */
(function () {
  'use strict';
  if (window.cg && window.cg.version) return; // cargado dos veces: nada

  const VERSION = '1.4.0';
  const raiz = document.documentElement;

  // ── Textos ────────────────────────────────────────────────────────────
  const TEXTOS = {
    es: {
      cerrar: 'Cerrar',
      cancelar: 'Cancelar',
      aceptar: 'Aceptar',
      deshacer: 'Deshacer',
      mas: 'Más',
      novedad: 'hay novedades',
      filtros: 'Filtros',
      filtrosActivos: n => (n ? `Filtros (${n} activos)` : 'Filtros'),
      filtrosRapidos: 'Filtros rápidos',
      atras: 'Atrás',
      navegacion: 'Navegación principal',
      plegar: 'Plegar menú',
      desplegar: 'Desplegar menú',
      avisos: 'Avisos',
      acciones: 'Acciones con la selección',
      seleccionados: n => (n === 1 ? 'seleccionado' : 'seleccionados'),
      mantener: b => `Mantén pulsado «${b}» para confirmar.`,
    },
    en: {
      cerrar: 'Close',
      cancelar: 'Cancel',
      aceptar: 'OK',
      deshacer: 'Undo',
      mas: 'More',
      novedad: 'something new',
      filtros: 'Filters',
      filtrosActivos: n => (n ? `Filters (${n} active)` : 'Filters'),
      filtrosRapidos: 'Quick filters',
      atras: 'Back',
      navegacion: 'Main navigation',
      plegar: 'Collapse menu',
      desplegar: 'Expand menu',
      avisos: 'Notifications',
      acciones: 'Actions on the selection',
      seleccionados: () => 'selected',
      mantener: b => `Press and hold “${b}” to confirm.`,
    },
  };
  function idioma() {
    const l = (raiz.lang || navigator.language || 'es').toLowerCase();
    return l.startsWith('es') ? 'es' : 'en';
  }
  function t(clave, arg) {
    const v = TEXTOS[idioma()][clave] ?? TEXTOS.es[clave] ?? clave;
    return typeof v === 'function' ? v(arg) : v;
  }
  // Componentes montados que tienen textos propios: se rehacen si cambia <html lang>.
  const conTextos = new Set();
  new MutationObserver(() => conTextos.forEach(c => c._textos())).observe(raiz, {
    attributes: true,
    attributeFilter: ['lang'],
  });

  // ── Iconos (trazo de 24×24; los dibujos son propios) ─────────────────────
  const CARPETA = 'M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z';
  const ICONOS = {
    biblioteca: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    limpiar: '<path d="M11 3.5l1.8 4.7 4.7 1.8-4.7 1.8L11 16.5l-1.8-4.7L4.5 10l4.7-1.8z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
    reels: '<rect x="3.5" y="3" width="17" height="18" rx="4"/><path d="M10 8.8v6.4l5.4-3.2z"/>',
    personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M17.8 14.9c1.8.8 3 2.4 3.6 5.1"/>',
    persona: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
    mas: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    buscar: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
    actividad: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    ajustes: '<path d="M19.4 10.5L21.9 10.7 21.9 13.3 19.4 13.5 18.3 16.2 19.9 18.1 18.1 19.9 16.2 18.3 13.5 19.4 13.3 21.9 10.7 21.9 10.5 19.4 7.8 18.3 5.9 19.9 4.1 18.1 5.7 16.2 4.6 13.5 2.1 13.3 2.1 10.7 4.6 10.5 5.7 7.8 4.1 5.9 5.9 4.1 7.8 5.7 10.5 4.6 10.7 2.1 13.3 2.1 13.5 4.6 16.2 5.7 18.1 4.1 19.9 5.9 18.3 7.8z"/><circle cx="12" cy="12" r="3"/>',
    papelera: '<path d="M4 7h16M10 3.5h4"/><path d="M6 7l1 12.6A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.4L18 7"/><path d="M10 11v6M14 11v6"/>',
    revisar: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    etiqueta: '<path d="M3 12.2V4a1 1 0 0 1 1-1h8.2a1 1 0 0 1 .7.3l8.4 8.4a1 1 0 0 1 0 1.4l-8.2 8.2a1 1 0 0 1-1.4 0l-8.4-8.4a1 1 0 0 1-.3-.7z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    carpeta: `<path d="${CARPETA}"/>`,
    mover: `<path d="${CARPETA}"/><path d="M8.5 13.5h7M13 11l2.5 2.5L13 16"/>`,
    apartar: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
    filtros: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    atras: '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    inicio: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9v10.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V9"/>',
    descargar: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>',
    estrella: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    estadisticas: '<path d="M5 20v-8M10 20V5M15 20v-6M20 20V9"/>',
    plegar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15.5 10l-2 2 2 2"/>',
    apps: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/>',
    salir: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
    deshacer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    anadir: '<path d="M12 5v14M5 12h14"/>',
  };
  const plantilla = document.createElement('template');
  /** Un icono: <svg class="cg-icono"> si el nombre existe; si no, el texto tal cual (p. ej. un emoji). */
  function icono(nombre) {
    if (ICONOS[nombre]) {
      plantilla.innerHTML = `<svg class="cg-icono" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONOS[nombre]}</svg>`;
      return plantilla.content.firstChild;
    }
    return el('span', { class: 'cg-icono-texto', 'aria-hidden': 'true' }, nombre || '');
  }

  // ── Utilidades ────────────────────────────────────────────────────────
  function el(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos) if (h != null && h !== false) n.append(h);
    return n;
  }
  let contador = 0;
  const nuevoId = p => `${p}-${++contador}`;
  const mqMovil = window.matchMedia('(max-width: 768px)');
  function duracion() {
    const v = getComputedStyle(raiz).getPropertyValue('--cg-medio');
    const ms = parseFloat(v);
    return Number.isFinite(ms) ? (v.trim().endsWith('ms') ? ms : ms * 1000) : 240;
  }
  function emitir(nodo, nombre, detail, cancelable) {
    return nodo.dispatchEvent(new CustomEvent(nombre, { bubbles: true, cancelable: !!cancelable, detail }));
  }
  const vibrar = ms => {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* sin vibración */
    }
  };

  // ── Modales: pila, Escape, foco atrapado y página bloqueada ──────────────
  const pila = [];
  let bloqueos = 0;
  function bloquear(si) {
    bloqueos = Math.max(0, bloqueos + (si ? 1 : -1));
    raiz.classList.toggle('cg-bloqueado', bloqueos > 0);
  }
  const ENFOCABLE =
    'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  function enfocables(nodo) {
    return [...nodo.querySelectorAll(ENFOCABLE)].filter(e => e.getClientRects().length && !e.closest('[inert]'));
  }
  document.addEventListener(
    'keydown',
    e => {
      const arriba = pila[pila.length - 1];
      if (!arriba) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        arriba._escape();
      } else if (e.key === 'Tab') {
        const lista = enfocables(arriba);
        const activo = document.activeElement;
        if (!lista.length) {
          e.preventDefault();
          arriba.focus();
          return;
        }
        const primero = lista[0];
        const ultimo = lista[lista.length - 1];
        if (!arriba.contains(activo) || activo === arriba) {
          e.preventDefault();
          (e.shiftKey ? ultimo : primero).focus();
        } else if (e.shiftKey && activo === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && activo === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    },
    true,
  );
  // Si el foco se escapa (clic en el velo, programa…), vuelve al modal de arriba.
  document.addEventListener('focusin', e => {
    const arriba = pila[pila.length - 1];
    if (arriba && !arriba.contains(e.target)) arriba.focus({ preventScroll: true });
  });

  /** Base de <cg-hoja> y <cg-dialogo>: abrir/cerrar con animación, velo, foco y Escape. */
  class Modal extends HTMLElement {
    _abrirModal(claseVelo) {
      clearTimeout(this._finTimer);
      if (this._finTimer) this._terminarCierre();
      this._abierto = true;
      this._previo = document.activeElement;
      const velo = (this._velo = el('div', { class: claseVelo, 'aria-hidden': 'true' }));
      velo.addEventListener('click', () => this._escape());
      document.body.append(velo);
      bloquear(true);
      pila.push(this);
      this.classList.remove('cg-cerrando');
      this.style.removeProperty('--cg-arrastre');
      this.scrollTop = 0;
      this.getBoundingClientRect(); // fuerza el estilo inicial para que se anime
      velo.getBoundingClientRect();
      this.classList.add('cg-visible');
      velo.classList.add('cg-visible');
      const auto = this.querySelector('[autofocus]');
      (auto || this).focus({ preventScroll: true });
      emitir(this, 'cg-abrir');
    }
    _cerrarModal(detalle) {
      if (!this._abierto) return;
      this._abierto = false;
      const i = pila.indexOf(this);
      if (i >= 0) pila.splice(i, 1);
      bloquear(false);
      this.classList.remove('cg-visible');
      this.classList.add('cg-cerrando');
      if (this._velo) {
        this._velo.classList.remove('cg-visible');
        this._velo.style.opacity = '';
      }
      const previo = this._previo;
      this._previo = null;
      if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus({ preventScroll: true });
      this._finTimer = setTimeout(() => this._terminarCierre(), this.isConnected ? duracion() + 40 : 0);
      emitir(this, 'cg-cerrar', detalle);
    }
    _terminarCierre() {
      this._finTimer = null;
      this.classList.remove('cg-cerrando');
      this.style.removeProperty('--cg-arrastre');
      if (this._velo) this._velo.remove();
      this._velo = null;
      if (this._alTerminar) this._alTerminar();
    }
    disconnectedCallback() {
      if (this._abierto) this._cerrarModal();
      clearTimeout(this._finTimer);
      if (this._velo) this._velo.remove();
      this._velo = null;
      conTextos.delete(this);
    }
  }

  // ── <cg-hoja> ─────────────────────────────────────────────────────────
  class CgHoja extends Modal {
    static get observedAttributes() {
      return ['abierta', 'titulo'];
    }
    connectedCallback() {
      if (!this._montada) this._montar();
      conTextos.add(this);
      if (this.hasAttribute('abierta') && !this._abierto) this._abrirModal('cg-velo');
    }
    _montar() {
      this._montada = true;
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
      this.tabIndex = -1;
      const id = this.id || nuevoId('cg-hoja');
      this._titulo = el('h2', { class: 'cg-hoja-titulo', id: id + '-titulo' });
      this._cerrarBtn = el(
        'button',
        { type: 'button', class: 'cg-boton cg-boton--fantasma cg-boton--icono cg-hoja-cerrar' },
        icono('cerrar'),
      );
      this._cerrarBtn.addEventListener('click', () => this.cerrar());
      const cab = el(
        'div',
        { class: 'cg-hoja-cab' },
        el('div', { class: 'cg-hoja-asa', 'aria-hidden': 'true' }),
        el('div', { class: 'cg-hoja-fila' }, this._titulo, this._cerrarBtn),
      );
      this.prepend(cab);
      this.setAttribute('aria-labelledby', this._titulo.id);
      this._ponerTitulo();
      this._textos();
      this._arrastre(cab);
    }
    _textos() {
      if (!this._cerrarBtn) return;
      this._cerrarBtn.setAttribute('aria-label', t('cerrar'));
      this._cerrarBtn.title = t('cerrar');
    }
    _ponerTitulo() {
      const titulo = this.getAttribute('titulo') || '';
      this._titulo.textContent = titulo;
      if (!titulo) this.setAttribute('aria-label', this.getAttribute('aria-label') || t('cerrar'));
    }
    attributeChangedCallback(nombre, antes, ahora) {
      if (!this._montada) return;
      if (nombre === 'titulo') this._ponerTitulo();
      else if (ahora !== null && !this._abierto && this.isConnected) this._abrirModal('cg-velo');
      else if (ahora === null && this._abierto) this._cerrarModal();
    }
    abrir() {
      this.setAttribute('abierta', '');
    }
    cerrar() {
      this.removeAttribute('abierta');
    }
    get abierta() {
      return this.hasAttribute('abierta');
    }
    _escape() {
      this.cerrar();
    }
    /** Arrastrar el asa o la cabecera hacia abajo cierra (móvil). */
    _arrastre(cab) {
      cab.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !mqMovil.matches || e.target.closest('button, a, input, select, textarea')) return;
        const y0 = e.clientY;
        let dy = 0;
        let vel = 0;
        let yAnt = y0;
        let tAnt = performance.now();
        const alto = this.offsetHeight || 1;
        cab.setPointerCapture(e.pointerId);
        this.classList.add('cg-arrastrando');
        const mover = ev => {
          const bruto = ev.clientY - y0;
          dy = bruto > 0 ? bruto : bruto / 6; // hacia arriba, con resistencia
          this.style.setProperty('--cg-arrastre', dy + 'px');
          if (this._velo) this._velo.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / alto));
          const ahora = performance.now();
          vel = (ev.clientY - yAnt) / Math.max(1, ahora - tAnt);
          yAnt = ev.clientY;
          tAnt = ahora;
        };
        const soltar = () => {
          if (performance.now() - tAnt > 100) vel = 0; // se paró antes de soltar: no es un lanzamiento
          cab.removeEventListener('pointermove', mover);
          cab.removeEventListener('pointerup', soltar);
          cab.removeEventListener('pointercancel', soltar);
          this.classList.remove('cg-arrastrando');
          if (dy > alto * 0.3 || (vel > 0.5 && dy > 24)) {
            this.cerrar();
          } else {
            this.style.setProperty('--cg-arrastre', '0px');
            if (this._velo) this._velo.style.opacity = '';
          }
        };
        cab.addEventListener('pointermove', mover);
        cab.addEventListener('pointerup', soltar);
        cab.addEventListener('pointercancel', soltar);
      });
    }
  }

  // ── <cg-dialogo> y cgConfirmar() ──────────────────────────────────────
  class CgDialogo extends Modal {
    static get observedAttributes() {
      return ['abierto'];
    }
    connectedCallback() {
      if (!this._montada) {
        this._montada = true;
        if (!this.hasAttribute('role')) this.setAttribute('role', 'dialog');
        this.setAttribute('aria-modal', 'true');
        this.tabIndex = -1;
        const titulo = this.querySelector('h1, h2, h3, .cg-dialogo-titulo');
        if (titulo && !this.hasAttribute('aria-labelledby')) {
          titulo.id = titulo.id || nuevoId('cg-dialogo-titulo');
          this.setAttribute('aria-labelledby', titulo.id);
        }
        const texto = this.querySelector('.cg-dialogo-texto');
        if (texto && !this.hasAttribute('aria-describedby')) {
          texto.id = texto.id || nuevoId('cg-dialogo-texto');
          this.setAttribute('aria-describedby', texto.id);
        }
        // Un botón con data-valor cierra el diálogo y pasa ese valor en el evento cg-cerrar.
        this.addEventListener('click', e => {
          const b = e.target.closest('[data-valor]');
          if (b && this.contains(b) && !b.classList.contains('cg-mantener')) this.cerrar(b.dataset.valor);
        });
      }
      if (this.hasAttribute('abierto') && !this._abierto) this._abrirModal('cg-velo cg-velo--dialogo');
    }
    attributeChangedCallback(nombre, antes, ahora) {
      if (!this._montada) return;
      if (ahora !== null && !this._abierto && this.isConnected) this._abrirModal('cg-velo cg-velo--dialogo');
      else if (ahora === null && this._abierto) this._cerrarModal({ valor: this._valor ?? null });
    }
    abrir() {
      this._valor = null;
      this.setAttribute('abierto', '');
    }
    cerrar(valor) {
      this._valor = valor ?? null;
      this.removeAttribute('abierto');
    }
    get abierto() {
      return this.hasAttribute('abierto');
    }
    _escape() {
      this.cerrar(null);
    }
  }

  /** El botón solo «se pulsa» tras mantenerlo apretado `ms` (ratón, dedo, Espacio o Intro). */
  function mantenerPulsado(boton, ms, alCompletar, alSoltarAntes) {
    let temporizador = null;
    boton.classList.add('cg-mantener');
    boton.style.touchAction = 'none';
    const empezar = () => {
      if (temporizador) return;
      boton.classList.add('cg-llenando');
      vibrar(8);
      temporizador = setTimeout(() => {
        temporizador = null;
        boton.classList.remove('cg-llenando');
        vibrar(20);
        alCompletar();
      }, ms);
    };
    const parar = () => {
      if (!temporizador) return;
      clearTimeout(temporizador);
      temporizador = null;
      boton.classList.remove('cg-llenando');
      if (alSoltarAntes) alSoltarAntes();
    };
    const tecla = e => e.key === ' ' || e.key === 'Enter';
    boton.addEventListener('pointerdown', e => {
      if (e.button === 0) empezar();
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(n => boton.addEventListener(n, parar));
    boton.addEventListener('keydown', e => {
      if (!tecla(e)) return;
      e.preventDefault();
      if (!e.repeat) empezar();
    });
    boton.addEventListener('keyup', e => {
      if (tecla(e)) parar();
    });
    boton.addEventListener('click', e => e.preventDefault());
    boton.addEventListener('contextmenu', e => e.preventDefault());
  }

  /**
   * cgConfirmar({titulo, texto, aceptar, cancelar, peligro, mantener}) → Promise<boolean>.
   * Con `mantener`, el botón de aceptar exige mantenerlo pulsado 1,5 s (lo irreversible).
   */
  function cgConfirmar(opciones) {
    const o = typeof opciones === 'string' ? { texto: opciones } : opciones || {};
    return new Promise(resolver => {
      const textoAceptar = o.aceptar || t('aceptar');
      const aceptar = el(
        'button',
        {
          type: 'button',
          class: 'cg-boton ' + (o.peligro ? 'cg-boton--peligro' : 'cg-boton--principal'),
          'data-cg-aceptar': '',
        },
        el('span', {}, textoAceptar),
      );
      const cancelar = el('button', { type: 'button', class: 'cg-boton', 'data-cg-cancelar': '' }, o.cancelar || t('cancelar'));
      const pista = o.mantener ? el('p', { class: 'cg-dialogo-pista' }, t('mantener', textoAceptar)) : null;
      const dialogo = el(
        'cg-dialogo',
        { role: 'alertdialog', class: o.peligro ? 'cg-dialogo--peligro' : null },
        o.titulo ? el('h2', { class: 'cg-dialogo-titulo' }, o.titulo) : null,
        o.texto ? el('p', { class: 'cg-dialogo-texto' }, o.texto) : null,
        pista,
        el('div', { class: 'cg-dialogo-botones' }, cancelar, aceptar),
      );
      if (!o.titulo) dialogo.setAttribute('aria-label', o.texto || textoAceptar);
      let respuesta = false;
      dialogo.addEventListener('cg-cerrar', () => resolver(respuesta), { once: true });
      dialogo._alTerminar = () => dialogo.remove();
      cancelar.addEventListener('click', () => dialogo.cerrar());
      if (o.mantener) {
        if (pista) pista.id = nuevoId('cg-pista');
        aceptar.setAttribute('aria-describedby', pista.id);
        mantenerPulsado(
          aceptar,
          o.ms || 1500,
          () => {
            respuesta = true;
            dialogo.cerrar(true);
          },
          () => {
            pista.animate?.([{ color: 'var(--cg-acento)' }, { color: '' }], { duration: 900 });
          },
        );
      } else {
        aceptar.addEventListener('click', () => {
          respuesta = true;
          dialogo.cerrar(true);
        });
      }
      document.body.append(dialogo);
      dialogo.abrir();
      // Lo peligroso empieza en «Cancelar»; lo demás, en el botón principal.
      (o.peligro ? cancelar : aceptar).focus({ preventScroll: true });
    });
  }

  // ── <cg-aviso> y cgAviso() ────────────────────────────────────────────
  class CgAviso extends HTMLElement {
    connectedCallback() {
      if (this._montado) return;
      this._montado = true;
      this.setAttribute('role', 'region');
      this.setAttribute('aria-live', 'polite');
      this.setAttribute('aria-relevant', 'additions');
      this._textos();
      conTextos.add(this);
    }
    disconnectedCallback() {
      conTextos.delete(this);
    }
    _textos() {
      this.setAttribute('aria-label', t('avisos'));
    }
    /** Ver cgAviso(). */
    mostrar(texto, opciones) {
      const o = opciones || {};
      const tipo = o.tipo || 'info';
      const error = tipo === 'error';
      const accion = o.deshacer ? { texto: t('deshacer'), fn: o.deshacer } : o.accion;
      const dur = o.duracion != null ? o.duracion : error ? 0 : accion ? 6000 : 4000;
      const uno = el('div', { class: `cg-aviso-uno cg-aviso-uno--${tipo}`, role: error ? 'alert' : 'status' });
      if (tipo === 'ok' || error) uno.append(icono(error ? 'error' : 'ok'));
      if (uno.firstChild) uno.firstChild.classList.add('cg-aviso-marca');
      uno.append(el('span', { class: 'cg-aviso-texto' }, texto));
      let restante = dur;
      let inicio = 0;
      let reloj = null;
      const cerrar = () => {
        clearTimeout(reloj);
        if (!uno.isConnected || uno.classList.contains('cg-saliendo')) return;
        uno.classList.add('cg-saliendo');
        setTimeout(() => uno.remove(), Math.min(duracion(), 200) + 20);
      };
      if (accion) {
        uno.append(
          el(
            'button',
            {
              type: 'button',
              class: 'cg-aviso-accion',
              onclick: () => {
                cerrar();
                accion.fn();
              },
            },
            accion.texto,
          ),
        );
      }
      uno.append(
        el(
          'button',
          { type: 'button', class: 'cg-aviso-cerrar', 'aria-label': t('cerrar'), title: t('cerrar'), onclick: cerrar },
          icono('cerrar'),
        ),
      );
      const seguir = () => {
        if (restante > 0 && !reloj) {
          inicio = Date.now();
          reloj = setTimeout(cerrar, restante);
        }
      };
      const pausar = () => {
        if (!reloj) return;
        clearTimeout(reloj);
        reloj = null;
        restante = Math.max(1500, restante - (Date.now() - inicio));
      };
      uno.addEventListener('pointerenter', pausar);
      uno.addEventListener('pointerleave', seguir);
      uno.addEventListener('focusin', pausar);
      uno.addEventListener('focusout', seguir);
      // Uno solo a la vez: el nuevo sustituye al anterior (también a un error, y
      // el «Deshacer» del anterior se pierde). Se quita sin animación para que
      // no se vean dos apilados ni un instante.
      for (const viejo of [...this.children]) viejo.remove();
      this.append(uno);
      seguir();
      return { cerrar, elemento: uno };
    }
  }

  /**
   * cgAviso(texto, {deshacer: fn, accion: {texto, fn}, duracion: ms, tipo: 'info'|'ok'|'error'})
   * → {cerrar(), elemento}. Los errores no se cierran solos; con «Deshacer» dura 6 s.
   */
  function cgAviso(texto, opciones) {
    let caja = document.querySelector('cg-aviso');
    if (!caja) {
      caja = document.createElement('cg-aviso');
      document.body.append(caja);
    }
    return caja.mostrar(texto, opciones);
  }

  // ── <cg-barra-inferior> ───────────────────────────────────────────────
  const PROPIOS = 'cg-barra-mas cg-barra-plegar cg-barra-separador'.split(' ');
  const esPropio = n => PROPIOS.some(c => n.classList.contains(c));
  const CLAVE_PLEGADA = 'cg-barra-plegada';

  class CgBarraInferior extends HTMLElement {
    connectedCallback() {
      if (!this._montada) {
        this._montada = true;
        this.setAttribute('role', 'navigation');
        this._mas = el(
          'button',
          { type: 'button', class: 'cg-barra-mas', 'aria-haspopup': 'dialog' },
          el('span', { class: 'cg-barra-icono' }, icono('mas')),
          el('span', { class: 'cg-barra-texto' }),
        );
        this._mas.addEventListener('click', () => this._abrirMas());
        this._plegar = el(
          'button',
          { type: 'button', class: 'cg-barra-plegar' },
          el('span', { class: 'cg-barra-icono' }, icono('plegar')),
          el('span', { class: 'cg-barra-texto' }),
        );
        this._plegar.addEventListener('click', () => this.plegada = !this.plegada);
        this._separador = el('span', { class: 'cg-barra-separador', 'aria-hidden': 'true' });
        this._obs = new MutationObserver(() => this._refrescar());
        let plegada = false;
        try {
          plegada = localStorage.getItem(CLAVE_PLEGADA) === '1';
        } catch (e) {
          /* sin almacenamiento */
        }
        if (plegada) this.setAttribute('plegada', '');
      }
      raiz.classList.add('cg-con-barra');
      raiz.classList.toggle('cg-barra-plegada', this.hasAttribute('plegada'));
      conTextos.add(this);
      this._refrescar();
    }
    disconnectedCallback() {
      this._obs.disconnect();
      conTextos.delete(this);
      if (!document.querySelector('cg-barra-inferior')) raiz.classList.remove('cg-con-barra', 'cg-barra-plegada');
      if (this._hoja) this._hoja.remove();
      this._hoja = null;
    }
    get plegada() {
      return this.hasAttribute('plegada');
    }
    set plegada(si) {
      this.toggleAttribute('plegada', !!si);
      raiz.classList.toggle('cg-barra-plegada', !!si);
      try {
        localStorage.setItem(CLAVE_PLEGADA, si ? '1' : '0');
      } catch (e) {
        /* sin almacenamiento */
      }
      this._textos();
    }
    /** Marca el destino actual (elemento o href); el resto deja de estarlo. */
    activar(destino) {
      for (const n of this._destinos()) {
        const es = typeof destino === 'string' ? n.getAttribute('href') === destino : n === destino;
        n.toggleAttribute('data-activo', es);
      }
    }
    _destinos() {
      // El logo ([data-marca]) no es un destino: ni se marca activo ni lleva icono.
      return [...this.children].filter(
        n => (n.tagName === 'A' || n.tagName === 'BUTTON') && !esPropio(n) && !n.hasAttribute('data-marca'),
      );
    }
    _textos() {
      this.setAttribute('aria-label', this.getAttribute('etiqueta') || t('navegacion'));
      this._mas.querySelector('.cg-barra-texto').textContent = t('mas');
      const pl = t(this.plegada ? 'desplegar' : 'plegar');
      this._plegar.querySelector('.cg-barra-texto').textContent = pl;
      this._plegar.setAttribute('aria-label', pl);
      this._plegar.title = pl;
      this._plegar.setAttribute('aria-expanded', String(!this.plegada));
      for (const n of this._destinos()) {
        // Plegada solo se ven los iconos: el nombre pasa a la información emergente.
        if (this.plegada && !n.title) {
          n.title = n.textContent.trim();
          n.dataset.cgTitulo = '';
        } else if (!this.plegada && 'cgTitulo' in n.dataset) {
          n.removeAttribute('title');
          delete n.dataset.cgTitulo;
        }
      }
      if (this._hoja) this._hoja.setAttribute('titulo', t('mas'));
    }
    _refrescar() {
      this._obs.disconnect();
      let hayMas = false;
      let masActivo = false;
      this._separador.remove();
      for (const n of this._destinos()) {
        const nombre = n.dataset.icono || '';
        let caja = n.querySelector(':scope > .cg-barra-icono');
        if (!caja) {
          caja = el('span', { class: 'cg-barra-icono', 'aria-hidden': 'true' });
          n.prepend(caja);
        }
        if (caja.dataset.nombre !== nombre) {
          caja.replaceChildren(icono(nombre));
          caja.dataset.nombre = nombre;
        }
        // data-aviso (o data-punto): punto de aviso; su valor (si lo hay, si no «hay novedades») se
        // lee en voz alta tras el nombre.
        let punto = n.querySelector(':scope > .cg-punto-texto');
        const conAviso = n.hasAttribute('data-aviso') || n.hasAttribute('data-punto');
        const textoPunto = conAviso
          ? n.getAttribute('data-aviso') || n.getAttribute('data-punto') || t('novedad') : '';
        n.toggleAttribute('data-cg-aviso', conAviso);
        if (textoPunto) {
          if (!punto) {
            punto = el('span', { class: 'cg-punto-texto' });
            n.append(punto);
          }
          if (punto.textContent !== ', ' + textoPunto) punto.textContent = ', ' + textoPunto;
        } else if (punto) punto.remove();
        const activo = n.hasAttribute('data-activo');
        if (activo) n.setAttribute('aria-current', 'page');
        else n.removeAttribute('aria-current');
        if (n.hasAttribute('data-mas')) {
          if (!hayMas) n.before(this._separador);
          hayMas = true;
          masActivo = masActivo || activo;
        }
      }
      // «Más» va justo detrás del último destino que guarda: así un destino que el
      // autor pone después (p. ej. «Apps») sigue siendo el último de la barra.
      const guardados = this._destinos().filter(n => n.hasAttribute('data-mas'));
      if (hayMas) guardados[guardados.length - 1].after(this._mas);
      else this._mas.remove();
      this._mas.toggleAttribute('data-cg-aviso', guardados.some(n => n.hasAttribute('data-cg-aviso')));
      if (masActivo) this._mas.setAttribute('aria-current', 'page');
      else this._mas.removeAttribute('aria-current');
      this.append(this._plegar);
      this._textos();
      this._obs.observe(this, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-activo', 'data-icono', 'data-mas', 'data-punto', 'data-aviso'],
      });
    }
    _abrirMas() {
      if (!this._hoja) {
        this._hoja = el('cg-hoja', { titulo: t('mas'), class: 'cg-barra-hoja' });
        this._lista = el('nav', { class: 'cg-hoja-lista', 'aria-label': t('mas') });
        this._hoja.append(this._lista);
        document.body.append(this._hoja);
      }
      this._lista.replaceChildren(
        ...this._destinos()
          .filter(n => n.hasAttribute('data-mas'))
          .map(n => {
            const nombre = [...n.childNodes].filter(x => !(x.classList && x.classList.contains('cg-punto-texto')))
              .map(x => x.textContent).join('').trim();
            const b = el('button', { type: 'button' }, icono(n.dataset.icono || ''), nombre);
            if (n.hasAttribute('data-activo')) b.setAttribute('aria-current', 'page');
            if (n.hasAttribute('data-cg-aviso')) b.setAttribute('data-cg-aviso', '');
            b.addEventListener('click', () => {
              this._hoja.cerrar();
              n.click(); // el destino de verdad: vale su href o el manejador de la app
            });
            return b;
          }),
      );
      this._hoja.abrir();
    }
  }

  // ── <cg-cabecera> ─────────────────────────────────────────────────────
  class CgCabecera extends HTMLElement {
    static get observedAttributes() {
      return ['titulo'];
    }
    connectedCallback() {
      if (!this._montada) {
        this._montada = true;
        this._h = this.querySelector(':scope > h1');
        if (!this._h) {
          this._h = el('h1', { class: 'cg-cabecera-titulo' });
          this.prepend(this._h);
        }
        if (this.hasAttribute('atras')) {
          this._atras = el('button', { type: 'button', class: 'cg-cabecera-atras' }, icono('atras'));
          this._atras.addEventListener('click', () => {
            if (emitir(this, 'cg-atras', null, true)) history.back();
          });
          this.prepend(this._atras);
        }
        this._ultimo = 0;
        this._raf = 0;
        this._alDesplazar = () => {
          if (this._raf) return;
          this._raf = requestAnimationFrame(() => this._mirar());
        };
        this.addEventListener('focusin', () => this.removeAttribute('data-oculta'));
      }
      this._ponerTitulo();
      this._textos();
      conTextos.add(this);
      const sel = this.getAttribute('desplaza');
      this._scroller = sel ? document.querySelector(sel) : window;
      (this._scroller || window).addEventListener('scroll', this._alDesplazar, { passive: true });
    }
    disconnectedCallback() {
      (this._scroller || window).removeEventListener('scroll', this._alDesplazar);
      conTextos.delete(this);
    }
    attributeChangedCallback() {
      if (this._montada) this._ponerTitulo();
    }
    _ponerTitulo() {
      if (this.hasAttribute('titulo')) this._h.textContent = this.getAttribute('titulo');
    }
    _textos() {
      if (!this._atras) return;
      this._atras.setAttribute('aria-label', t('atras'));
      this._atras.title = t('atras');
    }
    _mirar() {
      this._raf = 0;
      const s = this._scroller && this._scroller !== window ? this._scroller : null;
      const y = s ? s.scrollTop : window.scrollY;
      this.toggleAttribute('data-sombra', y > 2);
      const d = y - this._ultimo;
      if (!mqMovil.matches || this.hasAttribute('fija') || pila.length || y < 60) {
        this.removeAttribute('data-oculta');
        this._ultimo = y;
        return;
      }
      if (Math.abs(d) < 8) return;
      this.toggleAttribute('data-oculta', d > 0 && !this.contains(document.activeElement));
      this._ultimo = y;
    }
  }

  // ── <cg-chips> ────────────────────────────────────────────────────────
  class CgChips extends HTMLElement {
    static get observedAttributes() {
      return ['filtros'];
    }
    connectedCallback() {
      if (!this._montado) {
        this._montado = true;
        this.setAttribute('role', 'group');
        this._filtros = el('button', { type: 'button', class: 'cg-chips-filtros', 'aria-haspopup': 'dialog' });
        this.addEventListener('click', e => this._clic(e));
        this._obs = new MutationObserver(() => this._refrescar());
      }
      conTextos.add(this);
      this._refrescar();
    }
    disconnectedCallback() {
      this._obs.disconnect();
      conTextos.delete(this);
    }
    attributeChangedCallback() {
      if (this._montado) this._refrescar();
    }
    /** Los chips activos (botones con aria-pressed="true"). */
    get activos() {
      return this._chips().filter(b => b.getAttribute('aria-pressed') === 'true');
    }
    _chips() {
      return [...this.children].filter(n => n.tagName === 'BUTTON' && n !== this._filtros);
    }
    _textos() {
      this._refrescar();
    }
    _refrescar() {
      this._obs.disconnect();
      if (!this.hasAttribute('aria-label') || this._etiquetaPropia) {
        this._etiquetaPropia = true;
        this.setAttribute('aria-label', t('filtrosRapidos'));
      }
      for (const b of this._chips()) {
        if (!b.hasAttribute('type')) b.type = 'button';
        if (!b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(b.hasAttribute('data-activo')));
        if (!b.querySelector(':scope > .cg-chip-marca')) {
          const marca = icono('check');
          marca.classList.add('cg-chip-marca');
          b.prepend(marca);
        }
        if (b.dataset.icono && !b.querySelector(':scope > .cg-chip-icono')) {
          const i = icono(b.dataset.icono);
          i.classList.add('cg-chip-icono');
          b.querySelector(':scope > .cg-chip-marca').after(i);
        }
      }
      if (this.hasAttribute('filtros')) {
        const n = parseInt(this.getAttribute('filtros'), 10) || 0;
        const piezas = [icono('filtros'), el('span', {}, t('filtros'))];
        if (n) piezas.push(el('span', { class: 'cg-chips-cuenta', 'aria-hidden': 'true' }, String(n)));
        this._filtros.replaceChildren(...piezas); // sin null: replaceChildren lo pintaría como texto
        this._filtros.setAttribute('aria-label', t('filtrosActivos', n));
        this.append(this._filtros);
      } else {
        this._filtros.remove();
      }
      this._obs.observe(this, { childList: true });
    }
    _clic(e) {
      const b = e.target.closest('button');
      if (!b || b.parentElement !== this) return;
      if (b === this._filtros) {
        emitir(this, 'cg-filtros');
        return;
      }
      const activo = b.getAttribute('aria-pressed') !== 'true';
      if (!emitir(this, 'cg-cambio', { chip: b, activo, valor: b.value || b.dataset.valor || '' }, true)) return;
      if (this.hasAttribute('unico') && activo) this._chips().forEach(o => o.setAttribute('aria-pressed', 'false'));
      if (this.hasAttribute('unico') && !activo) return; // en «único» siempre queda uno
      b.setAttribute('aria-pressed', String(activo));
      emitir(this, 'cg-cambiado', { chip: b, activo, activos: this.activos });
    }
  }

  // ── <cg-barra-accion> ─────────────────────────────────────────────────
  class CgBarraAccion extends HTMLElement {
    static get observedAttributes() {
      return ['cuenta'];
    }
    connectedCallback() {
      if (!this._montada) {
        this._montada = true;
        this.setAttribute('role', 'toolbar');
        this._cancelar = el('button', { type: 'button', class: 'cg-accion-cancelar' }, icono('cerrar'));
        this._cancelar.addEventListener('click', () => {
          if (emitir(this, 'cg-cancelar', null, true)) this.cuenta = 0;
        });
        this._numero = el('span', { class: 'cg-accion-numero' });
        this._etiqueta = el('span', { class: 'cg-accion-etiqueta' });
        this._caja = el('div', { class: 'cg-accion-cuenta', 'aria-live': 'polite' }, this._numero, this._etiqueta);
        this.prepend(this._cancelar, this._caja);
        this._obs = new MutationObserver(() => this._iconos());
      }
      conTextos.add(this);
      this._iconos();
      this._pintar();
    }
    disconnectedCallback() {
      this._obs.disconnect();
      conTextos.delete(this);
      this.removeAttribute('abierta');
      this._marcarRaiz();
    }
    attributeChangedCallback() {
      if (this._montada) this._pintar();
    }
    get cuenta() {
      return parseInt(this.getAttribute('cuenta'), 10) || 0;
    }
    set cuenta(n) {
      this.setAttribute('cuenta', String(Math.max(0, n | 0)));
    }
    _textos() {
      this._pintar();
    }
    _iconos() {
      this._obs.disconnect();
      const acciones = [...this.children].filter(n => n !== this._cancelar && n !== this._caja);
      for (const n of acciones) {
        if (n.dataset.icono && !n.querySelector(':scope > .cg-icono, :scope > .cg-icono-texto')) {
          n.prepend(icono(n.dataset.icono));
        }
        // Con muchas acciones el móvil enseña solo los iconos: el nombre queda en aria-label.
        const nombre = n.textContent.trim();
        if (nombre && (!n.hasAttribute('aria-label') || 'cgEtiqueta' in n.dataset)) {
          n.setAttribute('aria-label', nombre);
          n.dataset.cgEtiqueta = '';
        }
      }
      // A partir de 5 acciones no caben los nombres a 390 px: solo iconos (CSS, ≤ 768 px).
      this.toggleAttribute('data-compacta', acciones.length >= 5);
      this._obs.observe(this, { childList: true, subtree: true, characterData: true });
    }
    _pintar() {
      const n = this.cuenta;
      this._numero.textContent = n.toLocaleString(idioma());
      this._etiqueta.textContent = t('seleccionados', n);
      this._cancelar.setAttribute('aria-label', t('cancelar'));
      this._cancelar.title = t('cancelar');
      this.setAttribute('aria-label', t('acciones'));
      const abrir = n > 0;
      if (abrir !== this.hasAttribute('abierta')) this.toggleAttribute('abierta', abrir);
      this.inert = !abrir;
      this._marcarRaiz();
    }
    _marcarRaiz() {
      raiz.classList.toggle('cg-seleccionando', !!document.querySelector('cg-barra-accion[abierta]'));
    }
  }

  // ── cgSeleccion() ─────────────────────────────────────────────────────
  /**
   * cgSeleccion(contenedor, {item, clave, alCambiar, espera, desplaza}) → controlador.
   *   item       selector de los elementos seleccionables (por defecto '[data-id]')
   *   clave      el → identificador estable (por defecto el.dataset.id); la selección sobrevive a repintados
   *   alCambiar  (claves[], controlador) cada vez que cambia
   * Pulsación larga (500 ms) entra en modo selección; en modo, un toque alterna; mantener y arrastrar
   * selecciona el rango; mayúsculas+clic selecciona el rango y Ctrl/Cmd+clic alterna (escritorio);
   * Escape sale.
   */
  function cgSeleccion(contenedor, opciones) {
    const o = opciones || {};
    const caja = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
    const selector = o.item || '[data-id]';
    const clave = o.clave || (n => (n.dataset.id != null ? n.dataset.id : n));
    const alCambiar = o.alCambiar || (() => {});
    const espera = o.espera != null ? o.espera : 500;
    const scroller = o.desplaza ? (typeof o.desplaza === 'string' ? document.querySelector(o.desplaza) : o.desplaza) : null;
    // {lista: true}: filas en vez de tarjetas: ni encoge ni pinta el círculo (la app pone su casilla).
    if (o.lista) caja.classList.add('cg-sel-lista');
    const claves = new Set();
    let modo = false;
    let ancla = null; // clave del último elemento tocado (inicio de un rango con mayúsculas)
    let pulsacion = null;
    let suprimirClic = false;

    const items = () => [...caja.querySelectorAll(selector)];
    const itemDe = n => {
      const i = n && n.closest ? n.closest(selector) : null;
      return i && caja.contains(i) ? i : null;
    };
    function pintar() {
      caja.classList.toggle('cg-modo-seleccion', modo);
      for (const it of items()) {
        it.classList.add('cg-sel-item');
        const si = claves.has(clave(it));
        it.classList.toggle('cg-seleccionado', si);
        if (modo) it.setAttribute('aria-selected', String(si));
        else it.removeAttribute('aria-selected');
      }
    }
    function avisar() {
      if (!claves.size) modo = false;
      pintar();
      alCambiar([...claves], ctl);
    }
    function rango(a, b) {
      const lista = items();
      const ia = lista.findIndex(n => clave(n) === a);
      const ib = lista.findIndex(n => clave(n) === b);
      if (ia < 0 || ib < 0) return [b];
      return lista.slice(Math.min(ia, ib), Math.max(ia, ib) + 1).map(clave);
    }
    function cancelarPulsacion() {
      if (!pulsacion) return;
      clearTimeout(pulsacion.timer);
      cancelAnimationFrame(pulsacion.raf);
      pulsacion = null;
      caja.removeEventListener('touchmove', alTocarMover);
    }
    function extender() {
      const p = pulsacion;
      if (!p || !p.ultimo) return;
      const debajo = itemDe(document.elementFromPoint(p.ultimo.x, p.ultimo.y));
      if (!debajo) return;
      const antes = claves.size + '|' + [...claves].join(',');
      claves.clear();
      p.base.forEach(k => claves.add(k));
      rango(p.clave, clave(debajo)).forEach(k => claves.add(k));
      if (antes !== claves.size + '|' + [...claves].join(',')) avisar();
    }
    // Arrastrando cerca del borde, la lista se desplaza sola.
    function autodesplazar() {
      const p = pulsacion;
      if (!p || !p.arrastrando) return;
      if (p.ultimo) {
        const r = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        const margen = 72;
        let v = 0;
        if (p.ultimo.y < r.top + margen) v = -Math.ceil((r.top + margen - p.ultimo.y) / 6);
        else if (p.ultimo.y > r.bottom - margen) v = Math.ceil((p.ultimo.y - (r.bottom - margen)) / 6);
        if (v) {
          (scroller || window).scrollBy(0, v);
          extender();
        }
      }
      p.raf = requestAnimationFrame(autodesplazar);
    }

    const alPulsar = e => {
      suprimirClic = false;
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const it = itemDe(e.target);
      if (!it) return;
      cancelarPulsacion();
      const p = (pulsacion = { id: e.pointerId, tipo: e.pointerType, x: e.clientX, y: e.clientY, clave: clave(it) });
      p.timer = setTimeout(() => {
        p.disparada = true;
        p.arrastrando = true;
        suprimirClic = true;
        modo = true;
        // Solo mientras se arrastra para seleccionar: un `touchmove` no pasivo siempre puesto hace
        // que WebKit (Safari y Chrome de iPhone) espere al JS en cada gesto y el scroll vaya a tirones.
        caja.addEventListener('touchmove', alTocarMover, { passive: false });
        claves.add(p.clave);
        p.base = new Set(claves);
        ancla = p.clave;
        vibrar(12);
        avisar();
        p.raf = requestAnimationFrame(autodesplazar);
      }, espera);
    };
    const alMover = e => {
      const p = pulsacion;
      if (!p || e.pointerId !== p.id) return;
      if (!p.disparada) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelarPulsacion();
        return;
      }
      p.ultimo = { x: e.clientX, y: e.clientY };
      extender();
    };
    const alSoltar = e => {
      if (pulsacion && e.pointerId === pulsacion.id) cancelarPulsacion();
    };
    // Mientras se arrastra para seleccionar, el dedo no desplaza la página (lo hace autodesplazar).
    const alTocarMover = e => {
      if (pulsacion && pulsacion.arrastrando && e.cancelable) e.preventDefault();
    };
    // Los enlaces e imágenes se arrastran solos: eso cortaría la selección por arrastre.
    const alArrastrarNativo = e => {
      if (pulsacion || modo) e.preventDefault();
    };
    const alMenu = e => {
      if ((pulsacion && pulsacion.tipo !== 'mouse') || (pulsacion && pulsacion.disparada)) e.preventDefault();
    };
    const alClic = e => {
      if (suprimirClic) {
        suprimirClic = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const it = itemDe(e.target);
      if (!it) return;
      const k = clave(it);
      if (e.shiftKey && (modo || ancla != null)) {
        e.preventDefault();
        e.stopPropagation();
        modo = true;
        rango(ancla != null ? ancla : k, k).forEach(x => claves.add(x));
        ancla = k;
        avisar();
      } else if (e.ctrlKey || e.metaKey || modo || e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        modo = true;
        if (claves.has(k)) claves.delete(k);
        else claves.add(k);
        ancla = k;
        // Sin nada marcado se sale del modo selección: si no, cada toque seguiría marcando y nada
        // se abriría (en el móvil parecía que la página no respondía).
        if (!claves.size) {
          modo = false;
          ancla = null;
        }
        avisar();
      }
    };
    const alTecla = e => {
      if (e.key === 'Escape' && modo && !pila.length) {
        e.preventDefault();
        ctl.limpiar();
      }
    };

    caja.classList.add('cg-seleccionable');
    caja.addEventListener('pointerdown', alPulsar);
    window.addEventListener('pointermove', alMover, { passive: true });
    window.addEventListener('pointerup', alSoltar);
    window.addEventListener('pointercancel', alSoltar);
    // Si la página se desplaza antes de que salte la pulsación larga, era un desplazamiento, no
    // «mantener para seleccionar» (en iPhone el dedo apoyado al frenar el scroll la disparaba).
    const alDesplazar = () => {
      if (pulsacion && !pulsacion.disparada) cancelarPulsacion();
    };
    window.addEventListener('scroll', alDesplazar, { passive: true, capture: true });
    caja.addEventListener('contextmenu', alMenu);
    caja.addEventListener('dragstart', alArrastrarNativo);
    caja.addEventListener('click', alClic, true);
    document.addEventListener('keydown', alTecla);
    // Si la app repinta la lista, la selección se vuelve a marcar (por clave).
    let rafPintar = 0;
    const obs = new MutationObserver(() => {
      if (!rafPintar)
        rafPintar = requestAnimationFrame(() => {
          rafPintar = 0;
          pintar();
        });
    });
    obs.observe(caja, { childList: true, subtree: true });

    const ctl = {
      get claves() {
        return [...claves];
      },
      get cuenta() {
        return claves.size;
      },
      get modo() {
        return modo;
      },
      /** Los elementos cargados que están seleccionados. */
      get elementos() {
        return items().filter(n => claves.has(clave(n)));
      },
      /** Añade (o quita, con si=false) claves o elementos. */
      seleccionar(lista, si = true) {
        for (const x of [].concat(lista)) {
          const k = x instanceof Element ? clave(x) : x;
          if (si) claves.add(k);
          else claves.delete(k);
        }
        if (claves.size) modo = true;
        avisar();
      },
      /** Sustituye la selección entera (p. ej. «Seleccionar los 1.240 del filtro», cargados o no). */
      poner(lista) {
        claves.clear();
        ctl.seleccionar(lista);
      },
      alternar(x) {
        const k = x instanceof Element ? clave(x) : x;
        ctl.seleccionar([k], !claves.has(k));
      },
      /** Todos los elementos cargados. */
      todos() {
        ctl.seleccionar(items());
      },
      limpiar() {
        claves.clear();
        modo = false;
        ancla = null;
        avisar();
      },
      destruir() {
        cancelarPulsacion();
        obs.disconnect();
        caja.removeEventListener('pointerdown', alPulsar);
        window.removeEventListener('pointermove', alMover);
        window.removeEventListener('pointerup', alSoltar);
        window.removeEventListener('pointercancel', alSoltar);
        caja.removeEventListener('touchmove', alTocarMover);
        window.removeEventListener('scroll', alDesplazar, { capture: true });
        caja.removeEventListener('contextmenu', alMenu);
        caja.removeEventListener('dragstart', alArrastrarNativo);
        caja.removeEventListener('click', alClic, true);
        document.removeEventListener('keydown', alTecla);
        claves.clear();
        modo = false;
        pintar();
        caja.classList.remove('cg-seleccionable', 'cg-modo-seleccion');
      },
    };
    pintar();
    return ctl;
  }

  // ── Registro ──────────────────────────────────────────────────────────
  const definir = (nombre, clase) => {
    if (!customElements.get(nombre)) customElements.define(nombre, clase);
  };
  definir('cg-hoja', CgHoja);
  definir('cg-dialogo', CgDialogo);
  definir('cg-aviso', CgAviso);
  definir('cg-barra-inferior', CgBarraInferior);
  definir('cg-cabecera', CgCabecera);
  definir('cg-chips', CgChips);
  definir('cg-barra-accion', CgBarraAccion);

  window.cg = Object.freeze({
    version: VERSION,
    aviso: cgAviso,
    confirmar: cgConfirmar,
    seleccion: cgSeleccion,
    icono,
    iconos: Object.keys(ICONOS),
    textos: TEXTOS,
    t,
  });
  window.cgAviso = cgAviso;
  window.cgConfirmar = cgConfirmar;
  window.cgSeleccion = cgSeleccion;
  window.cgIcono = icono;
})();
