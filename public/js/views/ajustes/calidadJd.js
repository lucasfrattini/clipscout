/**
 * Ajustes → JDownloader → «Calidad por sitio»: los ajustes de calidad de los plugins de JDownloader
 * para los sitios guardados (solo los que deciden QUÉ se baja: calidad preferida, solo la mejor,
 * formatos). Se leen de JDownloader cada vez y se cambian allí mismo: clipscout no guarda nada.
 */
import { ajustes } from '../../api.js';
import { el, toast } from '../../dom.js';
import { t } from '../../i18n/index.js';
import { abrirHoja } from '../../hojas.js';

/** «PreferredStreamQuality» → «Preferred stream quality»; «BEST_ONLY» → «Best only»; «720» → «720p». */
function nombreAjuste(clave) {
  if (/^\d{3,4}$/.test(clave)) return t('aj.jd.calidad.resolucion', { p: clave });
  const texto = String(clave)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function control(ajuste) {
  const guardar = async valor => {
    try {
      await ajustes.guardarCalidadJd({ ...ajuste, valor });
      ajuste.valor = valor;
      toast(t('aj.guardado'));
    } catch (error) {
      toast(error.message, 'error', 6000);
      return false;
    }
    return true;
  };
  if (ajuste.tipo === 'BOOLEAN' || typeof ajuste.valor === 'boolean') {
    const casilla = el('input', { attrs: { type: 'checkbox', role: 'switch' } });
    casilla.checked = ajuste.valor === true;
    casilla.addEventListener('change', async () => {
      if (!(await guardar(casilla.checked))) casilla.checked = !casilla.checked;
    });
    return el('label', {
      className: 'ajustes-casilla',
      children: [casilla, nombreAjuste(ajuste.clave)],
    });
  }
  if (ajuste.opciones?.length) {
    const lista = el('select', {
      className: 'input',
      children: ajuste.opciones.map(o =>
        el('option', { attrs: { value: String(o.valor) }, text: o.texto || String(o.valor) })
      ),
    });
    lista.value = String(ajuste.valor);
    lista.addEventListener('change', async () => {
      const antes = ajuste.valor;
      if (!(await guardar(lista.value))) lista.value = String(antes);
    });
    return el('label', {
      className: 'field',
      children: [
        el('span', { className: 'field__label', text: nombreAjuste(ajuste.clave) }),
        lista,
      ],
    });
  }
  return null;
}

export async function abrirCalidadJd() {
  const cuerpo = el('div', {
    className: 'cs-calidad-jd',
    children: [el('p', { className: 'cs-nota', text: t('aj.jd.calidad.cargando') })],
  });
  abrirHoja({ titulo: t('aj.jd.calidad.titulo'), contenido: [cuerpo] });
  let datos;
  try {
    datos = await ajustes.calidadJd();
  } catch (error) {
    cuerpo.replaceChildren(el('p', { className: 'ajustes-error', text: error.message }));
    return;
  }
  if (!datos.sitios.length) {
    cuerpo.replaceChildren(el('p', { className: 'cs-nota', text: t('aj.jd.calidad.nada') }));
    return;
  }
  cuerpo.replaceChildren(
    el('p', { className: 'cs-nota', text: t('aj.jd.calidad.hint') }),
    ...datos.sitios.map(s =>
      el('section', {
        className: 'cs-calidad-jd__sitio',
        children: [el('h4', { text: s.dominio }), ...s.ajustes.map(control).filter(Boolean)],
      })
    )
  );
}
