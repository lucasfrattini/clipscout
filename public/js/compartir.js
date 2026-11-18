/**
 * «Compartir» del móvil (CS-N8, Web Share Target del manifiesto): el navegador abre
 * /compartir?title=…&text=…&url=… con lo compartido. Se queda con el enlace (o, si no hay, con el
 * texto), lo guarda en esta pestaña y abre Buscar, que lo busca. Pasa por sessionStorage y no por
 * la dirección para que sobreviva a la pantalla de acceso si no había sesión.
 *
 * Sin dependencias: esta página se sirve también sin sesión (no lleva ningún dato).
 */
export const CLAVE_COMPARTIDO = 'clipscout:compartido';

/** Lo que se busca de lo compartido: el primer enlace http(s) o, si no hay, el texto. */
export function enlaceCompartido({ url = '', text = '', title = '' } = {}) {
  for (const parte of [url, text, title]) {
    const m = /https?:\/\/[^\s<>"']+/i.exec(String(parte || ''));
    if (m) return m[0].replace(/[).,;!?»”]+$/, '');
  }
  return String(text || title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

if (typeof location !== 'undefined' && location.pathname.startsWith('/compartir')) {
  const p = new URLSearchParams(location.search);
  const valor = enlaceCompartido({
    url: p.get('url') || '',
    text: p.get('text') || '',
    title: p.get('title') || '',
  });
  try {
    if (valor) sessionStorage.setItem(CLAVE_COMPARTIDO, valor);
  } catch {
    /* sin almacenamiento: se abre Buscar sin nada */
  }
  location.replace('/#/buscar');
}
