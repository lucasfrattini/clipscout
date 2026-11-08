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

export function aplicarTema(tema) {
  if (tema === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', tema);
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
