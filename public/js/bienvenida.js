// Asistente de primer arranque (§2.6, CS-N3): un paso por pantalla, con «Atrás», barra de pasos y
// el botón principal abajo. Solo aparece en una instalación nueva (lo decide el servidor:
// /api/auth/estado → `asistente`); quien ya tiene usuario y sesión puede volver a abrirlo desde
// /bienvenida y empieza en el paso 2.
//
// Los módulos se cargan DESPUÉS de mirar el estado: con usuario y sin sesión no se sirven, y aquí
// se manda a la pantalla de acceso antes de pedirlos.
const CABECERAS = { 'Content-Type': 'application/json', 'X-Clipgeist': '1' };
const estado = await fetch('/api/auth/estado', { headers: CABECERAS })
  .then(r => r.json())
  .catch(() => ({}));

if (estado.protegido && !estado.sesion) {
  location.replace('/login');
} else {
  await iniciar();
}

async function iniciar() {
  const [i18n, dom, api, alta, qr, tema] = await Promise.all([
    import('./i18n/index.js'),
    import('./dom.js'),
    import('./api.js'),
    import('./components/altaSitios.js'),
    import('./qr.js'),
    import('./tema.js'),
  ]);
  const { t, traducirDocumento } = i18n;
  const { el } = dom;
  const { ajustes, getProfiles } = api;
  tema.aplicarTema(tema.temaGuardado());
  traducirDocumento();
  document.documentElement.lang = i18n.idiomaActual();
  document.title = `${t('asis.titulo')} · clipscout`;

  const $ = id => document.getElementById(id);
  const cuerpo = $('asis-cuerpo');
  const botonSiguiente = $('asis-siguiente');
  const botonAtras = $('asis-atras');
  const error = $('asis-error');

  const pedir = async (ruta, opciones = {}) => {
    const r = await fetch(ruta, { ...opciones, headers: CABECERAS });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.detail || t('api.errorHttp', { status: r.status }));
    return datos;
  };

  const campo = (etiqueta, control, ayuda) =>
    el('label', {
      className: 'field',
      children: [
        el('span', { className: 'field__label', text: etiqueta }),
        control,
        ayuda ? el('span', { className: 'field__hint', text: ayuda }) : null,
      ],
    });
  const entrada = (attrs = {}) =>
    el('input', { className: 'input', attrs: { type: 'text', ...attrs } });
  const titulo = clave => el('h1', { text: t(clave), attrs: { tabindex: '-1' } });
  const parrafo = (clave, params) => el('p', { text: t(clave, params) });

  /* ── Pasos ─────────────────────────────────────────────────────────── */

  // Cada paso pinta su pantalla y devuelve { siguiente, textoSiguiente }: `siguiente` hace lo que
  // toque (guardar, probar…) y devuelve true para avanzar.
  const PASOS = [
    {
      id: 'cuenta',
      async pintar() {
        const { apps = [] } = await pedir('/api/auth/apps').catch(() => ({}));
        const conUsuario = apps.filter(a => a.tieneUsuario);
        const usuario = entrada({
          autocomplete: 'username',
          autocapitalize: 'none',
          id: 'asis-usuario',
        });
        const clave = entrada({ type: 'password', autocomplete: 'new-password', id: 'asis-clave' });
        const codigo = entrada({
          autocomplete: 'one-time-code',
          placeholder: 'XXXX-XXXX',
          id: 'asis-codigo',
        });
        codigo.value = new URLSearchParams(location.search).get('codigo') || '';
        let cuentaDe = '';
        const pistaClave = el('span', { className: 'field__hint', text: t('asis.cuenta.minimo') });
        const opciones = conUsuario.length
          ? el('fieldset', {
              className: 'asis-opciones',
              children: [
                el('legend', { className: 'field__label', text: t('asis.cuenta.cual') }),
                ...[{ app: '' }, ...conUsuario].map(({ app }, i) => {
                  const radio = el('input', {
                    attrs: {
                      type: 'radio',
                      name: 'asis-cuenta',
                      value: app,
                      ...(i === 0 ? { checked: true } : {}),
                    },
                    on: {
                      change: () => {
                        cuentaDe = app;
                        clave.autocomplete = app ? 'current-password' : 'new-password';
                        pistaClave.textContent = app
                          ? t('asis.cuenta.misma.pista', { app })
                          : t('asis.cuenta.minimo');
                      },
                    },
                  });
                  return el('label', {
                    className: 'asis-opcion',
                    children: [
                      radio,
                      el('span', {
                        text: app ? t('asis.cuenta.misma', { app }) : t('asis.cuenta.nueva'),
                      }),
                    ],
                  });
                }),
              ],
            })
          : null;
        cuerpo.replaceChildren(
          titulo('asis.cuenta.titulo'),
          parrafo('asis.cuenta.texto'),
          opciones || '',
          campo(t('asis.cuenta.usuario'), usuario),
          el('label', {
            className: 'field',
            children: [
              el('span', { className: 'field__label', text: t('asis.cuenta.clave') }),
              clave,
              pistaClave,
            ],
          }),
          estado.pideCodigo
            ? campo(t('asis.cuenta.codigo'), codigo, t('asis.cuenta.codigo.pista'))
            : ''
        );
        return {
          textoSiguiente: t('asis.cuenta.crear'),
          async siguiente() {
            await pedir('/api/auth/primer-usuario', {
              method: 'POST',
              body: JSON.stringify({
                usuario: usuario.value,
                contrasena: clave.value,
                codigo: codigo.value,
                ...(cuentaDe ? { cuentaDe } : {}),
              }),
            });
            estado.protegido = true;
            estado.sesion = true;
            return true;
          },
        };
      },
    },
    {
      id: 'descargas',
      async pintar() {
        const actual = await ajustes.jdownloader().catch(() => ({}));
        const url = entrada({
          type: 'url',
          id: 'asis-jd',
          placeholder: 'http://192.168.1.10:3128',
          inputmode: 'url',
        });
        url.value = actual.url || '';
        const resultado = el('p', { className: 'asis-nota', attrs: { 'aria-live': 'polite' } });
        const probar = el('button', {
          className: 'button button--secondary button--small',
          text: t('asis.descargas.probar'),
          attrs: { type: 'button' },
          on: {
            click: async () => {
              resultado.textContent = t('asis.probando');
              try {
                const r = await ajustes.probarJd(url.value);
                resultado.textContent = r.ok
                  ? t('aj.jd.responde', { version: r.version, carpeta: r.carpeta })
                  : r.error;
              } catch (e) {
                resultado.textContent = e.message;
              }
            },
          },
        });
        const pintarBoton = () => {
          botonSiguiente.textContent = url.value.trim()
            ? t('asis.guardarSeguir')
            : t('asis.despues');
        };
        url.addEventListener('input', pintarBoton);
        cuerpo.replaceChildren(
          titulo('asis.descargas.titulo'),
          parrafo('asis.descargas.texto'),
          campo(t('aj.jd.url'), url, t('asis.descargas.pista')),
          probar,
          resultado
        );
        return {
          alPintar: pintarBoton,
          async siguiente() {
            if (url.value.trim()) {
              await ajustes.guardarJd({ url: url.value.trim(), autostart: true });
            }
            return true;
          },
        };
      },
    },
    {
      id: 'sitios',
      async pintar() {
        const lista = el('ul', { attrs: { 'aria-live': 'polite' } });
        const pintarLista = async () => {
          const perfiles = await getProfiles()
            .then(r => r.profiles || [])
            .catch(() => []);
          lista.replaceChildren(
            ...perfiles.map(p => el('li', { className: 'asis-ok', text: `✓ ${p.name}` }))
          );
          botonSiguiente.textContent = perfiles.length ? t('asis.siguiente') : t('asis.despues');
        };
        const anadir = el('button', {
          className: 'button button--secondary',
          text: t('asis.sitios.anadir'),
          attrs: { type: 'button', id: 'asis-anadir-sitios' },
          on: {
            click: async () => {
              await alta.altaSitiosDialog();
              await pintarLista();
            },
          },
        });
        cuerpo.replaceChildren(
          titulo('asis.sitios.titulo'),
          parrafo('asis.sitios.texto'),
          anadir,
          lista
        );
        return { alPintar: pintarLista, siguiente: async () => true };
      },
    },
    {
      id: 'apps',
      async pintar() {
        const { apps = [] } = await pedir('/api/auth/apps').catch(() => ({}));
        const filas = apps.map(a => {
          const estadoApp = el('span', { attrs: { 'aria-live': 'polite' } });
          const caja = el('div', { className: 'asis-app' });
          if (a.conectada) {
            estadoApp.textContent = `✓ ${t('asis.apps.conectada')}`;
            estadoApp.className = 'asis-ok';
            caja.append(
              el('div', {
                className: 'asis-app-fila',
                children: [el('strong', { text: a.app }), estadoApp],
              })
            );
            return caja;
          }
          if (a.automatica) {
            estadoApp.textContent = t('asis.apps.automatica');
            caja.append(
              el('div', {
                className: 'asis-app-fila',
                children: [el('strong', { text: a.app }), estadoApp],
              })
            );
            return caja;
          }
          const clave = entrada({ type: 'password', autocomplete: 'off' });
          const conectar = el('button', {
            className: 'button button--small',
            text: t('asis.apps.conectar'),
            attrs: { type: 'button' },
            on: {
              click: async () => {
                estadoApp.textContent = t('asis.probando');
                try {
                  await ajustes.conectar({ app: a.app, url: a.url, api_key: clave.value });
                  estadoApp.textContent = `✓ ${t('asis.apps.conectada')}`;
                  estadoApp.className = 'asis-ok';
                  detalle.hidden = true;
                  interruptor.disabled = true;
                } catch (e) {
                  estadoApp.textContent = e.message;
                }
              },
            },
          });
          const detalle = el('div', {
            children: [
              campo(
                t('asis.apps.clave', { app: a.app }),
                clave,
                t('asis.apps.clave.pista', { app: a.app })
              ),
              conectar,
            ],
          });
          detalle.hidden = true;
          const interruptor = el('input', {
            attrs: {
              type: 'checkbox',
              role: 'switch',
              'aria-label': t('asis.apps.conectarCon', { app: a.app }),
            },
            on: { change: () => (detalle.hidden = !interruptor.checked) },
          });
          caja.append(
            el('label', {
              className: 'asis-app-fila',
              children: [el('strong', { text: a.app }), interruptor],
            }),
            detalle,
            estadoApp
          );
          return caja;
        });
        cuerpo.replaceChildren(
          titulo('asis.apps.titulo'),
          parrafo(apps.length ? 'asis.apps.texto' : 'asis.apps.ninguna'),
          ...filas
        );
        return { textoSiguiente: t('asis.siguiente'), siguiente: async () => true };
      },
    },
    {
      id: 'movil',
      async pintar() {
        const red = await pedir('/api/asistente/red').catch(() => ({ direcciones: [] }));
        const dir = red.direcciones?.[0];
        const partes = [titulo('asis.movil.titulo')];
        if (dir) {
          const svg = qr.svgQR(dir, { etiqueta: t('asis.movil.qr', { dir }) });
          svg.classList.add('asis-qr');
          partes.push(
            parrafo('asis.movil.texto'),
            svg,
            el('p', { className: 'asis-direccion', text: dir })
          );
          for (const otra of red.direcciones.slice(1)) {
            partes.push(el('p', { className: 'asis-direccion asis-nota', text: otra }));
          }
          partes.push(parrafo('asis.movil.misma'));
        } else {
          partes.push(parrafo(red.docker ? 'asis.movil.docker' : 'asis.movil.sinRed'));
        }
        if (red.soloLocal) partes.push(parrafo('asis.movil.soloLocal'));
        cuerpo.replaceChildren(...partes);
        return {
          textoSiguiente: t('asis.empezar'),
          async siguiente() {
            location.replace('/#/buscar');
            return false;
          },
        };
      },
    },
  ];

  /* ── Navegación ────────────────────────────────────────────────────── */

  const primero = estado.protegido ? 1 : 0;
  let actual = primero;
  let paso = null;

  async function mostrar(i) {
    actual = i;
    error.textContent = '';
    const n = PASOS.length;
    $('asis-barra').style.width = `${((i + 1) / n) * 100}%`;
    const progreso = $('asis-progreso');
    progreso.setAttribute('aria-valuemax', String(n));
    progreso.setAttribute('aria-valuenow', String(i + 1));
    progreso.setAttribute('aria-valuetext', t('asis.pasoDe', { n: i + 1, total: n }));
    $('asis-paso').textContent = t('asis.pasoDe', { n: i + 1, total: n });
    // Con el usuario ya creado no se vuelve al paso 1.
    botonAtras.hidden = i === 0 || (i === 1 && estado.protegido);
    botonAtras.textContent = t('asis.atras');
    botonSiguiente.disabled = true;
    paso = await PASOS[i].pintar();
    botonSiguiente.textContent = paso.textoSiguiente || t('asis.siguiente');
    await paso.alPintar?.();
    botonSiguiente.disabled = false;
    cuerpo.querySelector('h1')?.focus();
  }

  botonSiguiente.addEventListener('click', async () => {
    if (!paso) return;
    error.textContent = '';
    botonSiguiente.disabled = true;
    try {
      if (await paso.siguiente()) await mostrar(Math.min(actual + 1, PASOS.length - 1));
    } catch (e) {
      error.textContent = e.message;
    } finally {
      botonSiguiente.disabled = false;
    }
  });
  botonAtras.addEventListener('click', () => {
    if (actual > (estado.protegido ? 1 : 0)) mostrar(actual - 1);
  });

  await mostrar(actual);
}
