/**
 * Miniaturas de las listas, pedidas de pocas en pocas y solo las que se ven.
 *
 * Por qué: el navegador abre como mucho 6 conexiones con un mismo servidor, y cada miniatura pasa
 * por /api/thumbnail (que la trae del sitio: casi un segundo, hasta 6 s si el sitio no contesta).
 * Con `loading="lazy"` igualmente salían cientos de golpe (su margen es enorme), y cualquier otra
 * petición —enviar a JDownloader al elegir la carpeta, abrir una ficha— esperaba en la cola detrás
 * de todas: medido, 5–8 s con una VPN, y en el iPhone parecía colgado.
 *
 * Así: la <img> nace sin `src`; un IntersectionObserver la apunta cuando está en pantalla (o cerca)
 * y salen como mucho MAXIMO a la vez. Las que se van de la pantalla antes de empezar dejan su
 * turno. Siempre quedan conexiones libres para la API.
 */

const MAXIMO = 4; // de las 6 conexiones por servidor del navegador: 2 quedan para la API
const MARGEN = '400px'; // se empiezan a pedir un poco antes de que entren en pantalla
const PLAZO_MS = 15000; // una imagen que no termina nunca no se queda con el turno

let enVuelo = 0;
const cola = []; // <img> a la vista esperando turno, por orden de llegada
const pendientes = new Map(); // <img> → src aún sin pedir
let observador = null;
let barrido = null;

function lanzar(img, src) {
  enVuelo += 1;
  let hecho = false;
  const fin = () => {
    if (hecho) return;
    hecho = true;
    clearTimeout(reloj);
    enVuelo -= 1;
    siguiente();
  };
  const reloj = setTimeout(fin, PLAZO_MS);
  img.addEventListener('load', fin, { once: true });
  img.addEventListener('error', fin, { once: true });
  img.src = src;
}

function siguiente() {
  while (enVuelo < MAXIMO && cola.length > 0) {
    const img = cola.shift();
    const src = pendientes.get(img);
    soltar(img);
    if (src && img.isConnected) lanzar(img, src);
  }
}

function soltar(img) {
  pendientes.delete(img);
  observador?.unobserve(img);
}

/** Las listas se repintan enteras: lo que ya no está en la página deja de vigilarse. */
function barrer() {
  barrido = null;
  for (const img of pendientes.keys()) {
    if (!img.isConnected) {
      soltar(img);
      const i = cola.indexOf(img);
      if (i !== -1) cola.splice(i, 1);
    }
  }
  siguiente();
}

function alVerse(entradas) {
  for (const e of entradas) {
    const img = e.target;
    if (!pendientes.has(img)) {
      observador.unobserve(img);
      continue;
    }
    const i = cola.indexOf(img);
    if (e.isIntersecting) {
      if (i === -1) cola.push(img);
    } else if (i !== -1) {
      cola.splice(i, 1);
    }
  }
  siguiente();
}

/**
 * Deja `src` apuntado en `img` para pedirlo cuando le toque. Devuelve la misma `img`.
 * Sin IntersectionObserver (navegadores muy viejos), se pide ya, como antes.
 */
export function cargarMiniatura(img, src) {
  if (!src) return img;
  if (typeof IntersectionObserver === 'undefined') {
    img.src = src;
    return img;
  }
  observador ||= new IntersectionObserver(alVerse, { rootMargin: `${MARGEN} 0px` });
  pendientes.set(img, src);
  observador.observe(img);
  barrido ||= setTimeout(barrer, 2000);
  return img;
}

/** Para las pruebas: cuántas hay en vuelo y en cola. */
export function estadoMiniaturas() {
  return { enVuelo, enCola: cola.length, pendientes: pendientes.size, maximo: MAXIMO };
}
