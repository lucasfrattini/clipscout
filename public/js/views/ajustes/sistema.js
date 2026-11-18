/**
 * Ajustes → Sistema: copias, diagnóstico y «Acerca de» (versiones y qué sale del equipo).
 *
 * Sale de ajustes.js (CS-22) con lo nuevo de la fase 5: Diagnóstico (SU-11), la copia de la suite
 * (SU-20), el aviso de versiones (SU-13) y «Qué sale de este equipo» (SU-22). Todo con `el()`.
 */

import { ajustes, sistema } from '../../api.js';
import { confirmDialog } from '../../components/dialog.js';
import { el, toast } from '../../dom.js';
import { t } from '../../i18n/index.js';

const tarjeta = ({ id, titulo, hint, cuerpo }) =>
  el('section', {
    className: 'card',
    attrs: id ? { id } : undefined,
    children: [
      el('div', {
        className: 'card__header',
        children: [
          el('h3', { className: 'card__title', text: titulo }),
          hint ? el('p', { className: 'card__hint', text: hint }) : null,
        ],
      }),
      el('div', { className: 'card__body', children: cuerpo }),
    ],
  });

const boton = (texto, onClick, clase = 'button button--small button--secondary') =>
  el('button', {
    className: clase,
    attrs: { type: 'button' },
    text: texto,
    on: { click: onClick },
  });

const enlaceDescarga = (href, texto, nombre) =>
  el('a', {
    className: 'button button--small button--secondary',
    attrs: { href, download: nombre },
    text: texto,
  });

/* ── Avisos del sistema (CS-N5) ──────────────────────────────────────── */

/**
 * Notificaciones del navegador para los avisos (programadas, paquetes, sitios rotos, búsquedas
 * largas). En la app siempre hay el punto en Actividad; esto es lo que sale fuera de la página.
 */
export function tarjetaNotificaciones() {
  const nota = el('p', { className: 'card__hint', attrs: { role: 'status' } });
  const interruptor = el('input', { attrs: { type: 'checkbox', role: 'switch' } });
  async function pintar() {
    const m = await import('../../avisos.js');
    const posible = m.notificacionesPosibles();
    interruptor.checked = m.notificacionesActivas();
    interruptor.disabled = posible !== 'si';
    nota.textContent = posible === 'si' ? t('aj.notif.nota') : t(`aj.notif.${posible}`);
  }
  interruptor.addEventListener('change', async () => {
    const m = await import('../../avisos.js');
    const activas = await m.cambiarNotificaciones(interruptor.checked);
    if (interruptor.checked && !activas) toast(t('aj.notif.denegado'), 'error', 6000);
    pintar();
  });
  pintar();
  return tarjeta({
    id: 'tarjeta-notificaciones',
    titulo: t('aj.notif.titulo'),
    hint: t('aj.notif.hint'),
    cuerpo: [
      el('label', {
        className: 'cs-casilla',
        children: [interruptor, el('span', { text: t('aj.notif.activar') })],
      }),
      nota,
    ],
  });
}

/* ── Copias de seguridad (diarias) y copia de la suite ───────────────── */

export function tarjetaRespaldos({ recargar }) {
  const lista = el('ul', { className: 'ajustes-paquetes' });
  const kb = n => `${Math.max(1, Math.round(n / 1024))} KB`;
  async function cargarRespaldos() {
    let datos;
    try {
      datos = await ajustes.respaldos();
    } catch (error) {
      lista.replaceChildren(el('li', { className: 'ajustes-error', text: error.message }));
      return;
    }
    if (!datos.copias.length) {
      lista.replaceChildren(el('li', { className: 'field__hint', text: t('aj.resp.vacio') }));
      return;
    }
    lista.replaceChildren(
      ...datos.copias.map(c =>
        el('li', {
          className: 'ajustes-paquetes__fila',
          children: [
            el('div', {
              className: 'programadas__texto',
              children: [
                el('strong', { text: c.previa ? t('aj.resp.previa') : c.id }),
                el('span', {
                  className: 'field__hint',
                  text: c.ficheros.map(f => `${f.nombre} (${kb(f.bytes)})`).join(' · '),
                }),
              ],
            }),
            el('div', {
              className: 'ajustes-acciones',
              children: [
                enlaceDescarga(
                  `/api/ajustes/respaldos/${encodeURIComponent(c.id)}/descargar`,
                  t('aj.resp.descargar'),
                  `clipscout-respaldo-${c.id}.json`
                ),
                boton(
                  t('aj.resp.restaurar'),
                  async () => {
                    const ok = await confirmDialog({
                      titleKey: 'aj.resp.restaurar',
                      bodyKey: 'aj.resp.restaurarConfirmar',
                      variant: 'danger',
                    });
                    if (!ok) return;
                    try {
                      await ajustes.restaurarRespaldo(c.id);
                      toast(t('aj.resp.restaurado'));
                      recargar();
                    } catch (error) {
                      toast(error.message, 'error', 6000);
                    }
                  },
                  'button button--small button--secondary ajustes-peligro'
                ),
              ],
            }),
          ],
        })
      )
    );
  }
  cargarRespaldos();
  return tarjeta({
    id: 'ajustes-respaldos',
    titulo: t('aj.resp.titulo'),
    hint: t('aj.resp.hint'),
    cuerpo: [
      el('div', {
        className: 'ajustes-acciones',
        children: [
          boton(t('aj.resp.ahora'), async () => {
            try {
              await ajustes.respaldarAhora();
              toast(t('aj.resp.hecha'));
              cargarRespaldos();
            } catch (error) {
              toast(error.message, 'error', 6000);
            }
          }),
        ],
      }),
      lista,
    ],
  });
}

/** Copia de Clipgeist (SU-20): un zip para llevarse clipscout a otro equipo. */
export function tarjetaCopiaSuite({ recargar }) {
  const resultado = el('p', { className: 'ajustes-resultado', attrs: { 'aria-live': 'polite' } });
  const fichero = el('input', {
    className: 'visually-hidden',
    attrs: { type: 'file', accept: '.zip,application/zip', tabindex: '-1' },
  });
  fichero.addEventListener('change', async () => {
    const elegido = fichero.files?.[0];
    fichero.value = '';
    if (!elegido) return;
    const ok = await confirmDialog({
      titleKey: 'aj.copia.restaurar',
      bodyKey: 'aj.copia.restaurarConfirmar',
      bodyParams: { nombre: elegido.name },
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const r = await sistema.restaurarCopia(elegido);
      resultado.className = 'ajustes-resultado ajustes-resultado--ok';
      resultado.textContent = t('aj.copia.restaurada', { version: r.de?.version || '?' });
      recargar?.({ sinPintar: true });
    } catch (error) {
      resultado.className = 'ajustes-resultado ajustes-resultado--mal';
      resultado.textContent = error.message;
    }
  });
  const fecha = new Date().toISOString().slice(0, 10);
  return tarjeta({
    id: 'ajustes-copia',
    titulo: t('aj.copia.titulo'),
    hint: t('aj.copia.hint'),
    cuerpo: [
      el('div', {
        className: 'ajustes-acciones',
        children: [
          enlaceDescarga(
            '/api/crew/v1/copia',
            t('aj.copia.descargar'),
            `clipscout-copia-${fecha}.zip`
          ),
          boton(t('aj.copia.restaurar'), () => fichero.click()),
          fichero,
        ],
      }),
      resultado,
    ],
  });
}

/* ── Diagnóstico (SU-11) ─────────────────────────────────────────────── */

function nombreComprobacion(nombre) {
  const m = /^conexion[:_](.+)$/.exec(nombre);
  if (m) return t('aj.diag.c.conexion', { app: m[1] });
  const clave = `aj.diag.c.${nombre}`;
  const traducido = t(clave);
  return traducido === clave ? nombre : traducido;
}

export function tarjetaDiagnostico() {
  const estado = el('p', { className: 'ajustes-resultado', attrs: { 'aria-live': 'polite' } });
  const lista = el('ul', { className: 'cs-diagnostico' });
  const errores = el('div');
  const registro = el('pre', { className: 'cs-registro', attrs: { hidden: '', tabindex: '0' } });
  const fecha = new Date().toISOString().slice(0, 10);

  async function comprobar() {
    estado.className = 'ajustes-resultado';
    estado.textContent = t('aj.diag.comprobando');
    let d;
    try {
      d = await sistema.diagnostico();
    } catch (error) {
      estado.className = 'ajustes-resultado ajustes-resultado--mal';
      estado.textContent = error.message;
      return;
    }
    const bien = d.estado === 'ok';
    estado.className = `ajustes-resultado ajustes-resultado--${bien ? 'ok' : 'mal'}`;
    estado.textContent = t(bien ? 'aj.diag.ok' : 'aj.diag.degradado', { version: d.version });
    lista.replaceChildren(
      ...d.comprobaciones.map(c =>
        el('li', {
          className: `cs-diagnostico__fila${c.ok ? '' : ' cs-diagnostico__fila--mal'}`,
          children: [
            el('span', {
              className: 'cs-diagnostico__marca',
              attrs: { 'aria-hidden': 'true' },
              text: c.ok ? '✓' : '✕',
            }),
            el('div', {
              children: [
                el('strong', { text: nombreComprobacion(c.nombre) }),
                el('span', {
                  className: 'visually-hidden',
                  text: c.ok ? t('aj.diag.bien') : t('aj.diag.mal'),
                }),
                c.detalle ? el('span', { className: 'field__hint', text: c.detalle }) : null,
              ],
            }),
          ],
        })
      )
    );
    errores.replaceChildren(
      ...(d.ultimos_errores.length
        ? [
            el('p', { className: 'field__hint', text: t('aj.diag.errores') }),
            el('ul', {
              className: 'cs-diagnostico__errores',
              children: d.ultimos_errores.slice(0, 5).map(e =>
                el('li', {
                  text: `${new Date(e.fecha).toLocaleString()} · ${e.codigo} · ${e.id}`,
                })
              ),
            }),
          ]
        : [])
    );
  }

  const verRegistro = boton(t('aj.diag.verRegistro'), async () => {
    if (!registro.hidden) {
      registro.hidden = true;
      verRegistro.textContent = t('aj.diag.verRegistro');
      return;
    }
    try {
      const { lineas } = await sistema.registro(200);
      registro.textContent = lineas.length ? lineas.join('\n') : t('aj.diag.registroVacio');
      registro.hidden = false;
      verRegistro.textContent = t('aj.diag.ocultarRegistro');
      registro.scrollTop = registro.scrollHeight;
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  });

  comprobar();
  return tarjeta({
    id: 'ajustes-diagnostico',
    titulo: t('aj.diag.titulo'),
    hint: t('aj.diag.hint'),
    cuerpo: [
      estado,
      lista,
      errores,
      el('div', {
        className: 'ajustes-acciones',
        children: [
          boton(t('aj.diag.otraVez'), comprobar),
          verRegistro,
          enlaceDescarga(
            '/api/diagnostico/informe',
            t('aj.diag.informe'),
            `clipscout-informe-${fecha}.zip`
          ),
        ],
      }),
      el('p', { className: 'field__hint', text: t('aj.diag.informe.hint') }),
      registro,
    ],
  });
}

/* ── Acerca de: versión, versiones nuevas, qué sale del equipo ───────── */

function bloqueVersion(estado) {
  const caja = el('div', { className: 'cs-version', attrs: { 'aria-live': 'polite' } });
  const pintar = e => {
    if (!e.hay_nueva) {
      caja.replaceChildren(
        el('p', {
          className: 'field__hint',
          text: e.comprobado
            ? t('aj.version.alDia', { cuando: new Date(e.comprobado).toLocaleString() })
            : t('aj.version.sinComprobar'),
        })
      );
      return;
    }
    caja.replaceChildren(
      el('p', {
        className: 'ajustes-resultado ajustes-resultado--ok',
        text: t('aj.version.nueva', { version: e.ultima, actual: e.actual }),
      }),
      e.notas ? el('p', { className: 'cs-version__notas', text: e.notas }) : null,
      e.docker && e.comando
        ? el('div', {
            children: [
              el('p', { className: 'field__hint', text: t('aj.version.docker') }),
              el('code', { className: 'cs-version__comando', text: e.comando }),
            ],
          })
        : el('a', {
            className: 'cg-boton',
            attrs: { href: e.url, target: '_blank', rel: 'noopener' },
            text: t('aj.version.descargar'),
          })
    );
  };
  pintar(estado);
  return { caja, pintar };
}

const TIPOS_SALIENTES = ['sitios', 'web', 'gestor', 'proxy', 'ip_salida', 'apps', 'versiones'];

function listaSalientes(salientes) {
  const por = Object.fromEntries(salientes.map(s => [s.tipo, s]));
  return el('ul', {
    className: 'cs-salientes',
    children: TIPOS_SALIENTES.filter(tipo => por[tipo]).map(tipo => {
      const s = por[tipo];
      let detalle;
      if (!s.activo) detalle = t('aj.priv.no');
      else if (tipo === 'sitios') detalle = t('aj.priv.sitios.n', { n: s.n });
      else if (tipo === 'apps') detalle = s.apps.map(a => `${a.app} (${a.url})`).join(' · ');
      else detalle = s.url;
      return el('li', {
        className: s.activo ? '' : 'cs-salientes--no',
        children: [
          el('strong', { text: t(`aj.priv.${tipo}`) }),
          el('span', { className: 'field__hint', text: t(`aj.priv.${tipo}.que`) }),
          el('span', { className: 'cs-salientes__ahora', text: detalle }),
        ],
      });
    }),
  });
}

export function tarjetaAcercaDe({ general, alCambiarVersiones }) {
  const enlace = (href, clave) =>
    el('a', { attrs: { href, target: '_blank', rel: 'noopener' }, text: t(clave) });
  const version = bloqueVersion({});
  const interruptor = el('input', { attrs: { type: 'checkbox', role: 'switch' } });
  const comprobarAhora = boton(t('aj.version.comprobar'), async () => {
    comprobarAhora.disabled = true;
    try {
      const e = await sistema.comprobarActualizaciones();
      version.pintar(e);
      alCambiarVersiones?.(e);
    } catch (error) {
      toast(error.message, 'error', 6000);
    } finally {
      comprobarAhora.disabled = !interruptor.checked;
    }
  });
  const salientes = el('div', { children: [el('p', { className: 'field__hint', text: '…' })] });
  const cargarSalientes = () =>
    sistema
      .privacidad()
      .then(r => salientes.replaceChildren(listaSalientes(r.salientes)))
      .catch(error =>
        salientes.replaceChildren(el('p', { className: 'ajustes-error', text: error.message }))
      );
  interruptor.addEventListener('change', async () => {
    try {
      await sistema.buscarActualizaciones(interruptor.checked);
      comprobarAhora.disabled = !interruptor.checked;
      cargarSalientes();
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error', 6000);
    }
  });
  sistema
    .actualizaciones()
    .then(e => {
      interruptor.checked = e.activo;
      comprobarAhora.disabled = !e.activo;
      version.pintar(e);
    })
    .catch(() => {});
  cargarSalientes();

  return tarjeta({
    id: 'ajustes-acerca',
    titulo: t('aj.acerca.titulo'),
    hint: t('aj.esta.hint', { app: general.app, version: general.version }),
    cuerpo: [
      version.caja,
      el('label', {
        className: 'ajustes-casilla',
        children: [interruptor, t('aj.version.buscar')],
      }),
      el('p', { className: 'field__hint', text: t('aj.version.buscar.hint') }),
      el('div', { className: 'ajustes-acciones', children: [comprobarAhora] }),
      el('h4', { className: 'cs-subtitulo', text: t('aj.priv.titulo') }),
      el('p', { className: 'field__hint', text: t('aj.priv.hint') }),
      salientes,
      el('h4', { className: 'cs-subtitulo', text: t('aj.acerca.licenciaTitulo') }),
      el('p', { text: t('aj.acerca.licencia') }),
      el('ul', {
        children: [
          el('li', { children: [enlace('/api/licencia', 'aj.acerca.verLicencia')] }),
          el('li', { children: [enlace('/api/terceros', 'aj.acerca.terceros')] }),
          el('li', { children: [enlace('https://clipgeist.com/', 'aj.acerca.web')] }),
        ],
      }),
    ],
  });
}

/**
 * Aviso de compatibilidad para Ajustes → Conexiones (SU-13): la versión de la app conectada frente
 * a la mínima que pide esta. Devuelve el texto del aviso o ''.
 */
export function avisoCompatibilidad(app, versionConectada, minimas = {}) {
  const minima = minimas[app];
  if (!minima || !versionConectada) return '';
  const partes = v =>
    String(v)
      .split('.')
      .map(n => Number.parseInt(n, 10) || 0);
  const [a, b] = [partes(versionConectada), partes(minima)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) {
      return (a[i] || 0) < (b[i] || 0)
        ? t('aj.con.vieja', { app, version: versionConectada, minima })
        : '';
    }
  }
  return '';
}
