// Piezas comunes de las pruebas de navegador (humo.mjs y desplazamiento.mjs): el sitio falso, el
// servidor de clipscout con sus datos en una carpeta temporal y una miniatura de color.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

export const esperar = ms => new Promise(r => setTimeout(r, ms));

export const escuchar = srv =>
  new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

/* ── Miniatura sintética: un PNG de 160×90 de un color, con un degradado suave ── */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function png([r, g, b]) {
  const w = 160;
  const h = 90;
  const fila = w * 3 + 1;
  const crudo = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = y * fila + 1 + x * 3;
      const f = 0.7 + 0.3 * (x / w);
      crudo[o] = r * f;
      crudo[o + 1] = g * f;
      crudo[o + 2] = b * f;
    }
  }
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(w, 0);
  cabecera.writeUInt32BE(h, 4);
  cabecera[8] = 8;
  cabecera[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo('IHDR', cabecera),
    trozo('IDAT', zlib.deflateSync(crudo)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}
const COLORES = [
  [220, 80, 80],
  [80, 160, 220],
  [90, 190, 120],
  [230, 170, 60],
  [150, 100, 210],
  [60, 180, 180],
];

/**
 * Sitio falso: portada con buscador, listado paginado y fichas con su vídeo, su miniatura (un
 * color) y su duración. Buscar «lento» deja la petición del listado colgada `lentoMs` (un sitio
 * que no responde, como con el proxy de salida caído).
 */
export function crearSitio({ porPagina = 8, paginas = 2, retrasoFicha = 0, lentoMs = 30000 } = {}) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const html = cuerpo => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body>${cuerpo}</body></html>`);
    };
    if (url.pathname === '/') {
      return html('<a href="/ayuda">ayuda</a><form action="/resultados"><input name="q"></form>');
    }
    if (url.pathname === '/resultados') {
      const q = url.searchParams.get('q') || '';
      if (q === 'lento') await esperar(lentoMs);
      const pagina = Number(url.searchParams.get('page') || '1');
      const fichas =
        q && pagina <= paginas
          ? Array.from({ length: porPagina }, (_, i) => i + 1 + (pagina - 1) * porPagina)
          : [];
      const siguientes = Array.from({ length: paginas }, (_, i) => i + 2);
      return html(`<h1>Resultados de ${q}</h1>
        ${fichas.map(n => `<a href="/v/${n}/clip-de-prueba-${n}">Clip de prueba ${n}</a>`).join('')}
        <a href="/ayuda">ayuda</a><a href="/contacto">contacto</a>
        <nav>${siguientes.map(p => `<a href="/resultados?q=${encodeURIComponent(q)}&page=${p}">${p}</a>`).join('')}</nav>`);
    }
    if (url.pathname.startsWith('/v/')) {
      if (retrasoFicha) await esperar(retrasoFicha);
      const n = Number(url.pathname.split('/')[2]);
      return html(
        `<title>Clip de prueba ${n}</title><video src="/media/clip-${n}.mp4" poster="/img/${n}.png" data-duration="${60 + n * 7}"></video>`
      );
    }
    if (url.pathname.startsWith('/img/')) {
      const n = Number.parseInt(url.pathname.split('/')[2], 10) || 0;
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png(COLORES[n % COLORES.length]));
    }
    if (url.pathname.startsWith('/media/')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '1024' });
      return res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(1024));
    }
    res.writeHead(404);
    return res.end('no');
  });
  return srv;
}

/** Cierra un servidor de prueba sin esperar a las peticiones colgadas (el sitio «lento»). */
export function cerrar(srv) {
  srv.closeAllConnections?.();
  srv.close();
}

/**
 * Arranca clipscout (por PID, «./server.js» para que no lo confunda una limpieza que busca
 * «node server.js») con sus datos en `datos`. Devuelve { servidor, base, salida() }.
 */
export async function arrancar(raiz, datos, extra = {}) {
  const puerto = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.ADMIN_PASSWORD;
  delete env.CLIPGEIST_CLAVE;
  Object.assign(env, {
    PORT: String(puerto),
    HOST: '127.0.0.1',
    DATA_DIR: datos,
    CREW_PATH: path.join(datos, 'crew.json'),
    PROFILES_PATH: path.join(datos, 'profiles.json'),
    BROWSER_ENABLED: 'false',
    SECURITY_BLOCK_PRIVATE_ADDRESSES: 'false',
    CLIPGEIST_DETECTAR: 'no',
    // Nunca a clipgeist.com desde las pruebas (SU-13).
    CLIPGEIST_VERSIONES_URL: 'http://127.0.0.1:9/versiones.json',
    SEARXNG_URL: '',
    OUTBOUND_PROXY: '',
    CRAWL_PAGE_DELAY_MS: '0',
    THROTTLE_MIN_INTERVAL_MS: '0',
    HTTP_RETRY_BASE_DELAY_MS: '0',
    ...extra,
  });
  const servidor = spawn(process.execPath, ['./server.js'], {
    cwd: raiz,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  servidor.stdout.on('data', d => (salida += d));
  servidor.stderr.on('data', d => (salida += d));
  const base = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* aún no */
    }
    await esperar(100);
  }
  return { servidor, base, salida: () => salida };
}

/** Para el servidor por su PID (SIGTERM y, si no sale, SIGKILL). */
export async function parar(servidor) {
  if (!servidor || servidor.exitCode !== null) return;
  servidor.kill('SIGTERM');
  await Promise.race([new Promise(r => servidor.once('exit', r)), esperar(5000)]);
  if (servidor.exitCode === null) servidor.kill('SIGKILL');
}
