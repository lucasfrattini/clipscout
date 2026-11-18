// Prueba de humo de la interfaz (SU-21, CS-24): un navegador de verdad recorre clipscout como un
// usuario nuevo. Todo es local y sintético: un sitio falso y un JDownloader falso los sirve la
// propia prueba, y los datos van a una carpeta temporal (DATA_DIR, CREW_PATH y PROFILES_PATH).
//
//   asistente (usuario → JDownloader → alta de un sitio → apps → móvil)
//   → condiciones de uso → buscar en el sitio falso (vista grande y compacta; un solo botón de
//   filtros) → elegir varios resultados y enviarlos a la cola falsa → Actividad → Ajustes →
//   Sitios → editor de sitio → Avanzada → Apps → «Parar» con un sitio que no responde.
//
// Fase 3 (cómoda con una mano), todo a 390×844: en cada pantalla se mide que el primer contenido
// útil empiece antes de 160 px, que ningún control visible mida menos de 44 px de alto y que no
// haya desplazamiento horizontal; se falla si no. Con E2E_CAPTURAS=<carpeta> guarda capturas.
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
import { cerrar, crearSitio } from './_comun.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOPE_MS = Number(process.env.E2E_TOPE_MS) || 180000;
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const registro = (...a) => console.log('[humo]', ...a);
// E2E_CAPTURAS=<carpeta>: guarda una captura de cada pantalla del asistente (para revisarlas).
const CAPTURAS = process.env.E2E_CAPTURAS || '';
const capturar = (pagina, nombre, fullPage = true) =>
  CAPTURAS ? pagina.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage }) : null;
const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * Medidas de una pantalla a 390×844 (apartado 7 de la fase 3). Cuenta los controles que se ven en
 * pantalla; una casilla dentro de su <label> cuenta por la etiqueta (es lo que se toca).
 */
async function medir(pagina, nombre, selectorPrimero) {
  await esperar(350); // que acaben las transiciones (barra, marcas) antes de medir y capturar
  const m = await pagina.evaluate(sel => {
    const visible = e => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const enPantalla = e => {
      const r = e.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const selector =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab]';
    // Excepciones justificadas: el enlace «Saltar al contenido» (fuera de pantalla hasta el foco)
    // y los campos dentro de una etiqueta que ya mide 44 px.
    const controles = [
      ...new Set(
        [...document.querySelectorAll(selector)]
          .filter(e => !e.classList.contains('skip-link'))
          .filter(e => !e.closest('[inert], [aria-hidden="true"]'))
          .map(
            e => (e.matches('input[type=checkbox],input[type=radio]') && e.closest('label')) || e
          )
      ),
    ].filter(e => visible(e) && enPantalla(e));
    const pequenos = controles
      .filter(e => e.getBoundingClientRect().height < 43.5)
      .map(
        e =>
          `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} «${(
            e.getAttribute('aria-label') ||
            e.textContent ||
            e.placeholder ||
            ''
          )
            .trim()
            .slice(0, 24)}» ${Math.round(e.getBoundingClientRect().height)}px`
      );
    const primero = sel ? document.querySelector(sel) : null;
    const filas = [...document.querySelectorAll('.buscar__tarjeta')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
    }).length;
    return {
      primerContenido: primero ? Math.round(primero.getBoundingClientRect().top + scrollY) : null,
      controles: controles.length,
      pequenos,
      desbordaHorizontal: document.documentElement.scrollWidth > innerWidth + 1,
      filasEnPantalla: filas,
    };
  }, selectorPrimero);
  registro('medida', nombre, JSON.stringify(m));
  medidas[nombre] = m;
  await capturar(pagina, nombre, false);
  const fallos = [];
  // selectorPrimero null: no se mide dónde empieza (pantallas con su propia guía, como Avanzada).
  if (selectorPrimero && m.primerContenido === null) fallos.push('sin primer contenido');
  else if (m.primerContenido !== null && m.primerContenido >= 160)
    fallos.push(`primer contenido a ${m.primerContenido} px`);
  if (m.pequenos.length) fallos.push(`controles < 44 px: ${m.pequenos.join(', ')}`);
  if (m.desbordaHorizontal) fallos.push('desplazamiento horizontal');
  if (fallos.length) throw new Error(`[${nombre}] ${fallos.join(' · ')}`);
  return m;
}
const medidas = {};

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
const errores = [];

async function limpiar() {
  if (navegador) await navegador.close().catch(() => {});
  if (servidor && servidor.exitCode === null) {
    servidor.kill('SIGTERM');
    await Promise.race([new Promise(r => servidor.once('exit', r)), esperar(5000)]);
    if (servidor.exitCode === null) servidor.kill('SIGKILL');
  }
  cerrar(sitio);
  cerrar(jd);
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

  // Un segundo sitio, y nombres neutros para las capturas («sitio A», «sitio B»): el mismo sitio
  // falso visto como 127.0.0.1 y como localhost.
  const perfiles = await (await pagina.request.get(`${base}/api/profiles`)).json();
  const [primero] = perfiles.profiles;
  const segundo = JSON.parse(JSON.stringify(primero));
  segundo.config.searchUrl = segundo.config.searchUrl.replace('127.0.0.1', 'localhost');
  if (segundo.config.url) segundo.config.url = segundo.config.url.replace('127.0.0.1', 'localhost');
  const guardado = await pagina.request.put(`${base}/api/profiles`, {
    headers: { 'X-Clipgeist': '1' },
    data: {
      profiles: [
        { ...primero, name: 'sitio A' },
        { ...segundo, name: 'sitio B' },
      ],
    },
  });
  if (!guardado.ok()) throw new Error(`no se pudo preparar el segundo sitio: ${guardado.status()}`);
  await pagina.reload();
  await pagina.locator('.buscar__entrada').waitFor();
  await esperar(500);
  await medir(pagina, 'buscar-vacio', '.buscar__entrada');

  // Buscar en los dos sitios falsos: lista compacta, una sola fila de marcas y filtros en hoja.
  await pagina.locator('.buscar__entrada').fill('playa');
  await pagina.locator('.buscar__entrada').press('Enter');
  await pagina.locator('.buscar__tarjeta').first().waitFor({ timeout: 60000 });
  // Terminada: el botón «Parar» de la línea de estado ya no se ve.
  await pagina.waitForFunction(() => document.querySelector('.buscar__parar')?.hidden, null, {
    timeout: 90000,
  });
  await esperar(500);
  await pagina.evaluate(() => window.scrollTo(0, 0));
  // Un solo botón de filtros (antes había dos: opciones junto a la caja y «Filtros» en las marcas).
  const botonesFiltros = await pagina.evaluate(
    () =>
      [...document.querySelectorAll('#view-buscar button')].filter(b => {
        const r = b.getBoundingClientRect();
        const nombre = (b.getAttribute('aria-label') || b.textContent || '').trim();
        return r.width > 0 && /^(filtros|opciones)/i.test(nombre);
      }).length
  );
  if (botonesFiltros !== 1) throw new Error(`hay ${botonesFiltros} botones de filtros (uno)`);
  // Vista grande (por defecto): dos por fila, miniatura de 170 px o más y 4 enteros o más.
  const grande = await medir(pagina, 'buscar-resultados', '.buscar__tarjeta');
  const miniatura = await pagina.evaluate(() => {
    const r = document.querySelector('.buscar__imagen').getBoundingClientRect();
    return { ancho: Math.round(r.width), alto: Math.round(r.height) };
  });
  if (miniatura.ancho < 170) throw new Error(`miniatura de ${miniatura.ancho} px (mínimo 170)`);
  if (grande.filasEnPantalla < 4) {
    throw new Error(`solo ${grande.filasEnPantalla} resultados enteros en pantalla (mínimo 4)`);
  }
  registro(
    'vista grande:',
    grande.filasEnPantalla,
    'enteros; miniatura',
    JSON.stringify(miniatura)
  );
  // La hoja de filtros: dos partes; «Lista compacta» se elige ahí y se recuerda.
  await pagina.locator('.buscar__boton-filtros').click();
  await pagina.locator('cg-hoja.buscar__hoja-filtros[abierta]').waitFor();
  await esperar(400);
  await capturar(pagina, 'buscar-filtros', false);
  const partes = await pagina.locator('cg-hoja.buscar__hoja-filtros h3').allTextContents();
  if (partes.join('|') !== 'Qué buscar|Filtrar resultados') {
    throw new Error(`partes de la hoja de filtros: ${partes.join(' | ')}`);
  }
  await pagina.locator('label.cs-casilla', { hasText: 'Lista compacta' }).click();
  await pagina.keyboard.press('Escape');
  await esperar(400);
  const lista = await medir(pagina, 'buscar-compacta', '.buscar__tarjeta');
  if (lista.filasEnPantalla < 7) {
    throw new Error(`lista compacta: solo ${lista.filasEnPantalla} enteros (mínimo 7)`);
  }
  registro('lista compacta:', lista.filasEnPantalla, 'enteros');
  await pagina.reload();
  await pagina.locator('.buscar__tarjeta').first().waitFor();
  if (await pagina.locator('.buscar__rejilla--grande').count()) {
    throw new Error('la lista compacta no se recuerda al recargar');
  }
  await pagina.evaluate(() => localStorage.setItem('clipscout:buscar-vista', 'grande'));
  await pagina.reload();
  await pagina.locator('.buscar__rejilla--grande .buscar__tarjeta').first().waitFor();
  await esperar(500);

  // Selección: pulsación larga en una fila y la casilla de otra; se envían desde la barra de acción.
  const filas = pagina.locator('.buscar__tarjeta');
  const caja = await filas.nth(0).locator('.buscar__texto').boundingBox();
  await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await pagina.mouse.down();
  await esperar(700);
  await pagina.mouse.up();
  await filas.nth(2).locator('.buscar__casilla').click();
  await pagina.locator('cg-barra-accion[cuenta="2"]').waitFor();
  await esperar(300);
  await medir(pagina, 'buscar-seleccion', '.buscar__tarjeta');
  const elegidos = await pagina.evaluate(() =>
    [...document.querySelectorAll('.buscar__tarjeta.cg-seleccionado')].map(n => n.dataset.id)
  );
  if (elegidos.length !== 2) throw new Error(`seleccionados: ${elegidos.length}`);
  await pagina.locator('cg-barra-accion button[data-icono="descargar"]').click();
  await pagina.locator('button[data-tipo="etiqueta"]').click();
  await pagina.locator('.dialog__input').fill('Prueba de humo');
  await pagina.locator('.dialog__input').press('Enter');
  for (let i = 0; i < 100 && recibidos.length === 0; i += 1) await esperar(100);
  if (recibidos.length === 0) throw new Error('La cola falsa no recibió nada');
  const enlaces = recibidos.flatMap(r =>
    String(r.links || '')
      .split(/\s+/)
      .filter(Boolean)
  );
  if (!elegidos.every(e => enlaces.includes(e))) {
    throw new Error(`La cola falsa no recibió los dos elegidos: ${enlaces.join(' ')}`);
  }
  registro('enviados a la cola falsa:', enlaces.length);
  // Lo enviado sale de la lista (con su contador) y de «Descargar todo».
  await pagina.locator('.buscar__contador', { hasText: '2 ya enviados' }).waitFor();
  const visiblesTras = await pagina.locator('.buscar__tarjeta').count();
  const todo = await pagina.locator('.buscar__descargar-todo').textContent();
  if (!todo.includes(`(${visiblesTras})`)) {
    throw new Error(`«Descargar todo» no cuadra con lo visible: ${todo} / ${visiblesTras}`);
  }
  if (await pagina.locator('cg-barra-accion[abierta]').count()) {
    throw new Error('la barra de selección sigue abierta tras enviar');
  }
  await capturar(pagina, 'buscar-enviados', false);

  // Actividad: la búsqueda, el paquete enviado y las programadas, en un sitio.
  await pagina.locator('cg-barra-inferior a[href="#/actividad"]').click();
  await pagina.locator('.cs-fila').first().waitFor();
  await medir(pagina, 'actividad-busquedas', '.cs-fila');
  await pagina.locator('cg-chips.actividad__pestanas button[value="descargas"]').click();
  await pagina.locator('.cs-fila', { hasText: 'Prueba de humo' }).waitFor();
  const pulsada = await pagina
    .locator('cg-chips.actividad__pestanas button[aria-pressed="true"]')
    .allTextContents();
  if (pulsada.length !== 1 || !pulsada[0].includes('Descargas')) {
    throw new Error(`pestaña marcada en Actividad: ${pulsada.join(' | ')}`);
  }
  await medir(pagina, 'actividad-descargas', '.cs-fila');
  await pagina.locator('cg-chips.actividad__pestanas button[value="programadas"]').click();
  await pagina.getByRole('button', { name: 'Nueva programada' }).click();
  await pagina.locator('#form-programada').waitFor();
  await esperar(400);
  await capturar(pagina, 'actividad-programada', false);
  await pagina.keyboard.press('Escape');
  await esperar(400);

  // Ajustes: índice de 4 secciones → Búsqueda → Sitios (interruptor y «⋯») → editor de sitio.
  await pagina.locator('cg-barra-inferior a[href="#/ajustes"]').click();
  await pagina.locator('.cs-ajustes-indice a').first().waitFor();
  const secciones = await pagina.locator('.cs-ajustes-indice a').count();
  if (secciones !== 4) throw new Error(`Ajustes tiene ${secciones} secciones (4 esperadas)`);
  await medir(pagina, 'ajustes', '.cs-ajustes-indice a');
  await pagina.locator('.cs-ajustes-indice a[href="#/ajustes/busqueda"]').click();
  await pagina.locator('.cs-sitio').first().waitFor();
  await medir(pagina, 'ajustes-sitios', '.cs-sitio');
  await pagina.locator('.cs-sitio').first().locator('button[aria-haspopup]').click();
  await pagina.getByRole('button', { name: /^Editar/ }).click();
  await pagina.waitForURL(/#\/explorer\/0/);
  await pagina.getByText('Editando «sitio A»').waitFor();
  await esperar(400);
  await capturar(pagina, 'editor-sitio', false);

  // Avanzada (segundo botón de la barra): la pantalla de recorrer una página o un sitio.
  const orden = await pagina
    .locator('cg-barra-inferior > a:not([data-marca]), cg-barra-inferior > button[data-icono]')
    .allTextContents();
  if (orden.map(x => x.trim()).join('|') !== 'Buscar|Avanzada|Actividad|Ajustes|Apps') {
    throw new Error(`barra: ${orden.map(x => x.trim()).join(' | ')}`);
  }
  await pagina.locator('cg-barra-inferior a[href="#/explorer"]').click();
  await pagina.locator('#explorer-cabecera', { hasText: 'Búsqueda avanzada' }).waitFor();
  if (!(await pagina.locator('cg-barra-inferior a[href="#/explorer"][data-activo]').count())) {
    throw new Error('«Avanzada» no queda marcada en la barra');
  }
  // Es la pantalla de siempre (con su guía de pasos): se mide lo táctil, no dónde empieza.
  await medir(pagina, 'avanzada', null);

  // «Apps», el último botón de la barra: las otras apps (aquí ninguna conectada) y «Salir».
  await pagina.locator('#boton-apps').click();
  await pagina.locator('#hoja-apps[abierta]').waitFor();
  await esperar(400);
  await capturar(pagina, 'menu-apps', false);
  await pagina.keyboard.press('Escape');
  await esperar(400);

  // Escritorio: la misma estructura con la barra lateral (solo capturas, para revisarlas).
  if (CAPTURAS) {
    await pagina.emulateMedia({ colorScheme: 'dark' });
    await pagina.goto(`${base}/#/buscar`);
    await pagina.locator('.buscar__tarjeta').first().waitFor();
    await esperar(600);
    await capturar(pagina, 'oscuro-buscar', false);
    await pagina.emulateMedia({ colorScheme: 'light' });
    await pagina.setViewportSize({ width: 1280, height: 800 });
    await pagina.goto(`${base}/#/buscar`);
    await pagina.locator('.buscar__tarjeta').first().waitFor();
    await esperar(600);
    await capturar(pagina, 'escritorio-buscar', false);
    await pagina.goto(`${base}/#/ajustes/busqueda`);
    await pagina.locator('.cs-sitio').first().waitFor();
    await esperar(400);
    await capturar(pagina, 'escritorio-ajustes', false);
  }
  // «Parar» con un sitio que no responde (30 s): parada al instante, en pantalla y en el servidor.
  await pagina.emulateMedia({ colorScheme: 'light' });
  await pagina.setViewportSize({ width: 390, height: 844 });
  await pagina.goto(`${base}/#/buscar`);
  await pagina.locator('.buscar__entrada').fill('lento');
  await pagina.locator('.buscar__entrada').press('Enter');
  await pagina.locator('.buscar__parar:not([hidden])').waitFor();
  await esperar(1500);
  const t0 = Date.now();
  await pagina.locator('.buscar__parar').click();
  await pagina.waitForFunction(
    () =>
      document.querySelector('.buscar__parar')?.hidden &&
      document.querySelector('.buscar__estado .buscar__girando')?.hidden &&
      /parada/i.test(document.querySelector('.buscar__estado')?.textContent || ''),
    null,
    { timeout: 1000 }
  );
  let paradaServidor = null;
  for (let i = 0; i < 30 && paradaServidor === null; i += 1) {
    const cola = (await (await pagina.request.get(`${base}/api/buscar/cola`)).json()).busquedas;
    if (cola.find(x => x.q === 'lento')?.estado === 'fin') paradaServidor = Date.now() - t0;
    else await esperar(100);
  }
  if (paradaServidor === null) throw new Error('el servidor sigue con la búsqueda tras parar');
  registro('«Parar»: en el servidor en', paradaServidor, 'ms');

  registro('medidas', JSON.stringify(medidas));
  if (errores.length) throw new Error(`Errores en la página: ${errores.join(' | ')}`);
  codigo = 0;
  registro('OK');
} catch (error) {
  console.error('[humo] FALLA:', error.message);
  if (navegador) {
    const [abierta] = navegador.contexts().flatMap(c => c.pages());
    if (abierta) await capturar(abierta, 'fallo', false)?.catch(() => {});
  }
  if (errores.length) console.error('[humo] errores en la página:', errores.join(' | '));
  console.error(salida.split('\n').slice(-30).join('\n'));
} finally {
  clearTimeout(tope);
  await limpiar();
  process.exit(codigo);
}
