/*
 * Guía de bienvenida de Clipgeist: tres pasos (qué hace la app → primera acción → las otras apps).
 * ESTE FICHERO ES IDÉNTICO en clipscout y clonbuster; clipkeeper la tiene en React (Guia.tsx) con el
 * mismo marcado y las clases .cc-guia* de crew.css.
 *
 *   abrirGuia({ app, textos, accion, apps: "#crew" })
 *     textos: titulo, lead, puntos: [[negrita, texto], …], accionTitulo, accionTexto, accionBoton,
 *             despues, appsTitulo, appsTexto, descargar, conectada, noConectada, siguiente, atras,
 *             listo, cerrar
 *     accion: función que lanza la primera acción (abrir «agregar carpeta», «agregar sitio"…)
 *     apps:   selector del <nav class="cc-apps"> de la cabecera; de ahí se lee qué está conectado
 *   guiaVista(app) → true si ya se mostró una vez (se recuerda en este navegador)
 */
(function () {
  'use strict';
  const clave = app => 'cg-guia-' + app;

  function guiaVista(app) {
    try {
      return localStorage.getItem(clave(app)) === '1';
    } catch (e) {
      return true;
    }
  }

  function el(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const h of hijos.flat()) if (h != null) n.append(h);
    return n;
  }

  function leerApps(selector, app) {
    const nav = document.querySelector(selector);
    if (!nav) return [];
    return [...nav.querySelectorAll('.cc-app')]
      .map(a => {
        const img = a.querySelector('img');
        const nombre = (img && img.getAttribute('alt')) || '';
        return {
          nombre,
          src: img ? img.getAttribute('src') : '',
          url: a.getAttribute('href'),
          conectada: !a.classList.contains('apagada'),
          actual: a.classList.contains('actual') || nombre === app,
        };
      })
      .filter(x => !x.actual);
  }

  function abrirGuia({ app, textos: T, accion, apps = '#crew' }) {
    document.querySelector('.cc-guia-fondo')?.remove();
    let paso = 0;
    // El logo de esta app, tal como lo sirve la cabecera (cada app lo tiene en su ruta).
    const logo =
      document.querySelector(apps + ' .cc-app.actual img')?.getAttribute('src') ||
      '/crew/' + app + '.png';
    const fondo = el('div', {
      class: 'cc-guia-fondo',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': T.titulo,
    });
    const caja = el('div', { class: 'cc-guia' });
    fondo.append(caja);

    const cerrar = () => {
      try {
        localStorage.setItem(clave(app), '1');
      } catch (e) {
        /* sin almacenamiento */
      }
      fondo.remove();
      document.removeEventListener('keydown', tecla);
    };
    const tecla = e => {
      if (e.key === 'Escape') cerrar();
    };
    fondo.addEventListener('click', e => {
      if (e.target === fondo) cerrar();
    });

    const puntos = () =>
      el(
        'div',
        { class: 'cc-guia-pasos', 'aria-hidden': 'true' },
        [0, 1, 2].map(i => el('i', { class: i === paso ? 'on' : '' }))
      );

    function pintar() {
      caja.replaceChildren();
      const cab = el(
        'div',
        { class: 'cc-guia-cab' },
        el('img', { src: logo, alt: '' }),
        el(
          'div',
          {},
          el('span', { class: 'cc-guia-eyebrow' }, 'Clipgeist · ' + app),
          el('h2', {}, paso === 0 ? T.titulo : paso === 1 ? T.accionTitulo : T.appsTitulo)
        )
      );
      caja.append(cab);

      if (paso === 0) {
        caja.append(
          el('p', { class: 'cc-guia-lead' }, T.lead),
          el(
            'ol',
            { class: 'cc-guia-puntos' },
            T.puntos.map(([b, txt]) => el('li', {}, el('b', {}, b), txt))
          )
        );
      } else if (paso === 1) {
        caja.append(
          el('p', { class: 'cc-guia-lead' }, T.accionTexto),
          el(
            'button',
            {
              class: 'cc-guia-btn prim cc-guia-accion',
              type: 'button',
              onclick: () => {
                cerrar();
                accion();
              },
            },
            T.accionBoton
          )
        );
      } else {
        const lista = leerApps(apps, app);
        caja.append(
          el('p', { class: 'cc-guia-lead' }, T.appsTexto),
          el(
            'div',
            { class: 'cc-guia-apps' },
            lista.map(a =>
              el(
                a.conectada && a.url ? 'a' : 'div',
                a.conectada && a.url
                  ? { class: 'cc-guia-app', href: a.url }
                  : { class: 'cc-guia-app' },
                el('img', { src: a.src, alt: '' }),
                el('b', {}, a.nombre),
                el(
                  'span',
                  { class: 'cc-guia-estado' + (a.conectada ? ' ok' : '') },
                  a.conectada ? T.conectada : T.noConectada
                )
              )
            )
          ),
          el(
            'p',
            { class: 'cc-guia-nota' },
            el(
              'a',
              { href: 'https://clipgeist.com/#instalar', target: '_blank', rel: 'noopener' },
              T.descargar
            )
          )
        );
      }

      const izq =
        paso === 0
          ? el('button', { class: 'cc-guia-btn', type: 'button', onclick: cerrar }, T.cerrar)
          : el(
              'button',
              {
                class: 'cc-guia-btn',
                type: 'button',
                onclick: () => {
                  paso--;
                  pintar();
                },
              },
              T.atras
            );
      const der =
        paso < 2
          ? el(
              'button',
              {
                class: 'cc-guia-btn' + (paso === 0 ? ' prim' : ''),
                type: 'button',
                onclick: () => {
                  paso++;
                  pintar();
                },
              },
              paso === 1 ? T.despues : T.siguiente
            )
          : el('button', { class: 'cc-guia-btn prim', type: 'button', onclick: cerrar }, T.listo);
      caja.append(puntos(), el('div', { class: 'cc-guia-botones' }, izq, der));
      (caja.querySelector('.cc-guia-accion') || der).focus();
    }

    document.addEventListener('keydown', tecla);
    document.body.append(fondo);
    pintar();
  }

  window.abrirGuia = abrirGuia;
  window.guiaVista = guiaVista;
})();
