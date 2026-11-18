// Prueba de humo de la interfaz (SU-21, CS-24): un navegador de verdad recorre clipscout como un
// usuario nuevo. Todo es local y sintético: un sitio falso y un JDownloader falso los sirve la
// propia prueba, y los datos van a una carpeta temporal (DATA_DIR, CREW_PATH y PROFILES_PATH).
//
//   asistente (usuario → JDownloader → alta de un sitio → apps → móvil)
//   → condiciones de uso → buscar en el sitio falso → enviar un resultado a la cola falsa.
//
// Uso:  npm run e2e
// Necesita Playwright con Chromium: en CI `npm i --no-save playwright && npx playwright install
// --with-deps chromium`; en local, PLAYWRIGHT=/ruta/a/node_modules/playwright/index.mjs si está
// instalado en otro proyecto. Se para sola a los 3 minutos (navegador y servidor, por PID).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOPE_MS = Number(process.env.E2E_TOPE_MS) || 180000;
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const registro = (...a) => console.log('[humo]', ...a);
// E2E_CAPTURAS=<carpeta>: guarda una captura de cada pantalla del asistente (para revisarlas).
const CAPTURAS = process.env.E2E_CAPTURAS || '';
const capturar = (pagina, nombre) =>
  CAPTURAS
    ? pagina.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true })
    : null;
const esperar = ms => new Promise(r => setTimeout(r, ms));

/* ── Sitio falso: portada con buscador, listado paginado y fichas con su vídeo ── */
function crearSitio() {
  return http.createServer((req, res) => {
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
      const pagina = Number(url.searchParams.get('page') || '1');
      const fichas = q && pagina <= 2 ? [1, 2, 3, 4, 5].map(n => n + (pagina - 1) * 5) : [];
      return html(`<h1>Resultados de ${q}</h1>
        ${fichas.map(n => `<a href="/v/${n}/clip-de-prueba-${n}">Clip de prueba ${n}</a>`).join('')}
        <a href="/ayuda">ayuda</a><a href="/contacto">contacto</a>
        <nav>${[2, 3].map(p => `<a href="/resultados?q=${encodeURIComponent(q)}&page=${p}">${p}</a>`).join('')}</nav>`);
    }
    if (url.pathname.startsWith('/v/')) {
      const n = url.pathname.split('/')[2];
      return html(`<title>Clip de prueba ${n}</title><video src="/media/clip-${n}.mp4"></video>`);
    }
    if (url.pathname.startsWith('/media/')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '1024' });
      return res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(1024));
    }
    res.writeHead(404);
    return res.end('no');
  });
}

/* ── JDownloader falso (la «Deprecated API»): la cola donde acaba lo enviado ── */
function crearJd(recibidos) {
  return http.createServer((req, res) => {
    const [ruta, query = ''] = req.url.split('?');
    const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
    const responder = data => res.end(JSON.stringify({ data }));
    if (ruta === '/jd/version') return responder(48637);
    if (ruta === '/config/get') return responder('/descargas');
    if (ruta === '/linkgrabberv2/addLinks') {
      recibidos.push(params[0]);
      return responder({ id: 7 });
    }
    if (ruta === '/linkgrabberv2/queryLinkCrawlerJobs') return responder([]);
    if (ruta === '/linkgrabberv2/queryLinks') return responder([]);
    if (ruta.startsWith('/linkgrabberv2/') || ruta.startsWith('/downloadcontroller/')) {
      return responder(true);
    }
    res.statusCode = 404;
    return res.end('{}');
  });
}

const escuchar = srv =>
  new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

const datos = fs.mkdtempSync(path.join(process.env.E2E_DIR || os.tmpdir(), 'clipscout-humo-'));
const recibidos = [];
const sitio = crearSitio();
const jd = crearJd(recibidos);
let servidor = null;
let navegador = null;
let salida = '';

async function limpiar() {
  if (navegador) await navegador.close().catch(() => {});
  if (servidor && servidor.exitCode === null) {
    servidor.kill('SIGTERM');
    await Promise.race([new Promise(r => servidor.once('exit', r)), esperar(5000)]);
    if (servidor.exitCode === null) servidor.kill('SIGKILL');
  }
  sitio.close();
  jd.close();
  fs.rmSync(datos, { recursive: true, force: true });
}

const tope = setTimeout(async () => {
  console.error('[humo] tiempo agotado');
  await limpiar();
  process.exit(2);
}, TOPE_MS);

let codigo = 1;
try {
  const urlSitio = await escuchar(sitio);
  const urlJd = await escuchar(jd);
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
    SEARXNG_URL: '',
    OUTBOUND_PROXY: '',
    CRAWL_PAGE_DELAY_MS: '0',
    THROTTLE_MIN_INTERVAL_MS: '0',
    HTTP_RETRY_BASE_DELAY_MS: '0',
    THUMBNAILS_ENABLED: 'false',
  });
  // «./server.js»: así no lo confunde una limpieza que busca «node server.js».
  servidor = spawn(process.execPath, ['./server.js'], {
    cwd: RAIZ,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => (salida += d));
  servidor.stderr.on('data', d => (salida += d));
  registro('servidor PID', servidor.pid, 'en el puerto', puerto);
  const base = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* aún no */
    }
    await esperar(100);
  }

  navegador = await chromium.launch();
  const pagina = await navegador.newPage({
    locale: 'es-ES',
    viewport: { width: 390, height: 844 },
  });
  pagina.setDefaultTimeout(30000);
  const errores = [];
  pagina.on('pageerror', e => errores.push(e.message));

  // 1. Instalación nueva: la raíz lleva al asistente.
  await pagina.goto(`${base}/`);
  await pagina.waitForURL(/\/bienvenida/);
  await pagina.locator('#asis-usuario').waitFor();
  await capturar(pagina, '1-cuenta');
  await pagina.locator('#asis-usuario').fill('ana');
  await pagina.locator('#asis-clave').fill('una-clave-larga-1');
  await pagina.locator('#asis-siguiente').click();
  registro('paso 1: usuario creado');

  // 2a. ¿Dónde se descargan? JDownloader (falso).
  await pagina.locator('#asis-jd').fill(urlJd);
  await pagina.getByRole('button', { name: 'Probar' }).click();
  await pagina.getByText('Responde').waitFor();
  await capturar(pagina, '2-descargas');
  await pagina.locator('#asis-siguiente').click();
  registro('paso 2: JDownloader guardado');

  // 2b. Elige 1–3 sitios: alta automática del sitio falso, probada de verdad.
  await pagina.locator('#asis-anadir-sitios').click();
  await pagina.locator('#alta-sitios').fill(urlSitio);
  await pagina.locator('#alta-termino').fill('playa');
  await pagina
    .getByRole('button', { name: /^Probar/ })
    .last()
    .click();
  const guardar = pagina.getByRole('button', { name: /^Guardar/ });
  await guardar.and(pagina.locator(':enabled')).waitFor({ timeout: 60000 });
  await guardar.click();
  await pagina.locator('.asis-ok').first().waitFor();
  await capturar(pagina, '3-sitios');
  await pagina.locator('#asis-siguiente').click();
  registro('paso 3: sitio dado de alta');

  // 3. Apps: no hay otras en esta prueba. 4. Móvil: dirección (y QR si hay red local).
  await pagina.getByRole('heading', { name: /otras apps/ }).waitFor();
  await capturar(pagina, '4-apps');
  await pagina.locator('#asis-siguiente').click();
  await pagina.getByRole('heading', { name: /móvil/ }).waitFor();
  await capturar(pagina, '5-movil');
  registro('paso 5: QR', await pagina.locator('svg.asis-qr').count());
  await pagina.locator('#asis-siguiente').click();
  await pagina.waitForURL(/#\/buscar/);

  // Condiciones de uso (la primera vez) y la guía de bienvenida.
  await pagina.locator('#aviso-acepto').check();
  await pagina.locator('.cc-aviso .cc-guia-btn.prim').click();
  const guia = pagina.locator('.cc-guia-fondo');
  if (await guia.isVisible().catch(() => false)) await pagina.keyboard.press('Escape');
  if (await guia.isVisible().catch(() => false)) {
    await guia.getByRole('button').last().click();
  }

  // Buscar en el sitio falso y mandar un resultado a la cola falsa.
  await pagina.locator('.buscar__entrada').fill('playa');
  await pagina.locator('.buscar__entrada').press('Enter');
  const descargar = pagina.getByRole('button', { name: '⬇ Descargar', exact: true }).first();
  await descargar.waitFor({ timeout: 60000 });
  registro('resultados en pantalla');
  await descargar.click();
  await pagina.locator('button[data-tipo="etiqueta"]').click();
  await pagina.locator('.dialog__input').fill('Prueba de humo');
  await pagina.locator('.dialog__input').press('Enter');
  for (let i = 0; i < 100 && recibidos.length === 0; i += 1) await esperar(100);
  if (recibidos.length === 0) throw new Error('La cola falsa no recibió nada');
  registro('enviado a la cola falsa:', JSON.stringify(recibidos[0]).slice(0, 160));
  if (errores.length) throw new Error(`Errores en la página: ${errores.join(' | ')}`);
  codigo = 0;
  registro('OK');
} catch (error) {
  console.error('[humo] FALLA:', error.message);
  console.error(salida.split('\n').slice(-30).join('\n'));
} finally {
  clearTimeout(tope);
  await limpiar();
  process.exit(codigo);
}
