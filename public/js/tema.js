/**
 * Tema claro / oscuro / del sistema. Se elige en Ajustes → Apariencia y se recuerda en este
 * navegador. «system» quita `data-theme` y manda el del sistema operativo.
 */
const CLAVE = 'clipscout:theme';
export const TEMAS = ['system', 'light', 'dark'];

export function temaGuardado() {
  try {
    // La app se llamaba URL Explorer: se respeta el tema guardado con la clave antigua.
    const t = localStorage.getItem(CLAVE) || localStorage.getItem('urlexplorer:theme');
    return TEMAS.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Color de la barra del sistema (móvil instalado) para cada tema: el fondo de la app. */
const COLOR_BARRA = { light: '#f4f6f9', dark: '#0b1220' };

export function aplicarTema(tema) {
  if (tema === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', tema);
  // SU-14: con un tema elegido a mano, las dos etiquetas (claro/oscuro del sistema) dicen ese.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const delSistema = /dark/.test(meta.getAttribute('media') || '') ? 'dark' : 'light';
    meta.setAttribute('content', COLOR_BARRA[tema === 'system' ? delSistema : tema]);
  }
}

export function cambiarTema(tema) {
  if (!TEMAS.includes(tema)) return;
  aplicarTema(tema);
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // sin almacenamiento: el tema no persiste, no es crítico
  }
}
