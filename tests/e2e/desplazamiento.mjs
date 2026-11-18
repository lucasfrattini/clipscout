// Prueba de navegador con WebKit emulando un iPhone 15 (Safari y Chrome del iPhone son WebKit):
//
//   1. La página no vuelve sola hacia arriba. Con una búsqueda que va trayendo resultados, se
//      desplaza hacia abajo con gestos táctiles y se mira 10 s sin tocar nada (a mitad se rehacen
//      todas las filas, también las de arriba): la tarjeta que está bajo el dedo no debe moverse. Luego, ya terminada, se sube a saltos de 200 px desde el
//      final: cada salto debe mover la lista exactamente 200 px (en las dos vistas, grande y
//      compacta), y abrir y cerrar una hoja no debe cambiar el desplazamiento.
//      Causa del fallo de la 2.20: `content-visibility: auto` en las filas. WebKit no ancla el
//      desplazamiento: las filas fuera de pantalla medían lo estimado (74 px) y no lo real
//      (62 px), así que cada fila que se rehacía o se pintaba por encima movía la lista.
//   2. «Parar» para AL INSTANTE: con un sitio que tarda 30 s en responder, tras pulsar «Parar» la
//      pantalla dice «Búsqueda parada» sin el indicador girando, y el servidor la da por
//      terminada en seguida.
//
// Uso:  npm run e2e   (va después de humo.mjs). Necesita Playwright con WebKit: en CI
// `npx playwright install --with-deps webkit`; en local, PLAYWRIGHT=/ruta/a/playwright/index.mjs
// y, si el WebKit instalado es otro, PLAYWRIGHT_WEBKIT=/ruta/al/ejecutable. Se para sola a los
// 3 minutos (navegador y servidor, por PID). E2E_CAPTURAS=<carpeta> guarda capturas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar, cerrar, crearSitio, escuchar, esperar, parar } from './_comun.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOPE_MS = Number(process.env.E2E_TOPE_MS) || 180000;
const { webkit, devices } = await import(process.env.PLAYWRIGHT || 'playwright');
const registro = (...a) => console.log('[desplazamiento]', ...a);
const CAPTURAS = process.env.E2E_CAPTURAS || '';
const capturar = (pagina, nombre) =>
  CAPTURAS ? pagina.screenshot({ path: path.join(CAPTURAS, `iphone-${nombre}.png`) }) : null;

const datos = fs.mkdtempSync(path.join(process.env.E2E_DIR || os.tmpdir(), 'clipscout-despl-'));
const sitio = crearSitio({ porPagina: 20, paginas: 5, retrasoFicha: 120 });
let servidor = null;
let navegador = null;
let salida = () => '';

async function limpiar() {
  if (navegador) await navegador.close().catch(() => {});
  await parar(servidor);
  cerrar(sitio);
  fs.rmSync(datos, { recursive: true, force: true });
}
const tope = setTimeout(async () => {
  console.error('[desplazamiento] tiempo agotado');
  await limpiar();
  process.exit(2);
}, TOPE_MS);

/** E2E_CON_FALLO=1: vuelve a poner en las filas lo que causaba el fallo de la 2.20. */
const volverAlFallo = () => {
  const hoja = [...document.styleSheets].find(h => /una-mano/.test(h.href || ''));
  hoja.insertRule(
    '.buscar__tarjeta{content-visibility:auto;contain-intrinsic-size:auto 63px}',
    hoja.cssRules.length
  );
};

/** La tarjeta bajo el punto (150, 330) de la pantalla y dónde está. */
const ANCLA = () => {
  const c = document.elementFromPoint(150, 330)?.closest?.('.buscar__tarjeta');
  return c ? { id: c.dataset.id, top: c.getBoundingClientRect().top } : null;
};

/** Desplaza hacia abajo como un dedo: toques (touchstart/move/end) y el desplazamiento. */
async function deslizar(pagina, veces, paso) {
  for (let i = 0; i < veces; i += 1) {
    await pagina.evaluate(dy => {
      const t = document.elementFromPoint(200, 420) || document.body;
      const toque = (tipo, y) => {
        const ev = new Event(tipo, { bubbles: true, cancelable: true });
        const p = [{ identifier: 1, target: t, clientX: 200, clientY: y, pageX: 200, pageY: y }];
        Object.defineProperty(ev, 'touches', { value: tipo === 'touchend' ? [] : p });
        Object.defineProperty(ev, 'changedTouches', { value: p });
        t.dispatchEvent(ev);
      };
      toque('touchstart', 520);
      toque('touchmove', 420);
      window.scrollBy(0, dy);
      toque('touchmove', 220);
      toque('touchend', 220);
    }, paso);
    await esperar(120);
  }
}

/** 1a. Mientras llegan resultados: 10 s quieto, la tarjeta bajo el dedo no se mueve. */
async function quietoDiezSegundos(pagina) {
  await deslizar(pagina, 6, 300);
  await esperar(300);
  const inicio = await pagina.evaluate(ANCLA);
  if (!inicio) throw new Error('no hay tarjeta bajo el dedo tras desplazar');
  const y0 = await pagina.evaluate(() => scrollY);
  let peor = 0;
  for (let i = 0; i < 40; i += 1) {
    await esperar(250);
    // A mitad, las filas se rehacen todas (también las de arriba, fuera de pantalla), como cuando
    // llegan duraciones, «ya lo tengo» o lo enviado: aquí, con un cambio de idioma y vuelta.
    if (i === 12 || i === 24) {
      await pagina.evaluate(
        async idioma => {
          const i18n = await import('/js/i18n/index.js');
          i18n.cambiarIdioma(idioma);
        },
        i === 12 ? 'en' : 'es'
      );
    }
    const a = await pagina.evaluate(ANCLA);
    if (!a || a.id !== inicio.id) {
      const y = await pagina.evaluate(() => scrollY);
      throw new Error(`la lista se movió sola: otra tarjeta bajo el dedo (scrollY ${y0} → ${y})`);
    }
    peor = Math.max(peor, Math.abs(a.top - inicio.top));
  }
  if (peor > 4) throw new Error(`la lista se movió sola ${Math.round(peor)} px en 10 s`);
  registro('10 s quieto: la tarjeta bajo el dedo se movió', Math.round(peor), 'px; scrollY', y0);
}

/** 1b. Subir a saltos de 200 px desde el final: cada salto, 200 px exactos. */
async function subirASaltos(pagina, vista) {
  const pasos = await pagina.evaluate(async ancla => {
    const leer = new Function(`return (${ancla})()`);
    const dormir = ms => new Promise(r => setTimeout(r, ms));
    window.scrollTo(0, document.documentElement.scrollHeight);
    await dormir(400);
    const r = [];
    for (let i = 0; i < 15; i += 1) {
      const a = leer();
      const y0 = window.scrollY;
      window.scrollBy(0, -200);
      await dormir(100);
      const nodo = a && document.querySelector(`.buscar__tarjeta[data-id="${CSS.escape(a.id)}"]`);
      r.push({
        movido: Math.round(y0 - window.scrollY),
        visto: nodo ? Math.round(nodo.getBoundingClientRect().top - a.top) : null,
      });
    }
    return r;
  }, ANCLA.toString());
  const malos = pasos.filter(p => p.visto !== null && Math.abs(p.visto - p.movido) > 4);
  if (malos.length) {
    throw new Error(
      `[${vista}] al subir, la lista no sigue al dedo: ${malos
        .slice(0, 4)
        .map(p => `desplazado ${p.movido} px, la tarjeta se movió ${p.visto} px`)
        .join(' · ')}`
    );
  }
  registro(`[${vista}] 15 saltos de 200 px hacia arriba: la lista sigue al dedo`);
}

/** 1c. Abrir y cerrar la hoja de filtros no cambia el desplazamiento. */
async function hojaSinSalto(pagina) {
  await pagina.evaluate(() => window.scrollTo(0, 1500));
  await esperar(300);
  const antes = await pagina.evaluate(() => Math.round(scrollY));
  await pagina.locator('.buscar__boton-filtros').tap();
  await pagina.locator('cg-hoja.buscar__hoja-filtros[abierta]').waitFor();
  await esperar(500);
  await capturar(pagina, 'filtros');
  await pagina.keyboard.press('Escape');
  await esperar(600);
  const despues = await pagina.evaluate(() => Math.round(scrollY));
  if (Math.abs(despues - antes) > 4) {
    throw new Error(`abrir y cerrar la hoja movió la página: ${antes} → ${despues}`);
  }
  registro('hoja abierta y cerrada sin salto:', antes, '→', despues);
}

let codigo = 1;
try {
  const urlSitio = await escuchar(sitio);
  fs.writeFileSync(
    path.join(datos, 'profiles.json'),
    JSON.stringify({
      profiles: ['sitio A', 'sitio B'].map((name, i) => ({
        name,
        config: {
          searchUrl: `${i ? urlSitio.replace('127.0.0.1', 'localhost') : urlSitio}/resultados?q={q}`,
          pageParam: 'page',
          linkPattern: '/v/',
          fileExtensions: '.mp4',
        },
      })),
    })
  );
  let base;
  ({ servidor, base, salida } = await arrancar(RAIZ, datos));
  registro('servidor PID', servidor.pid);
  const alta = await fetch(`${base}/api/auth/primer-usuario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Clipgeist': '1' },
    body: JSON.stringify({ usuario: 'ana', contrasena: 'una-clave-larga-1' }),
  });
  if (!alta.ok) throw new Error(`no se pudo crear el usuario: ${alta.status}`);
  const [nombre, valor] = (alta.headers.get('set-cookie') || '').split(';')[0].split('=');

  navegador = await webkit.launch({ executablePath: process.env.PLAYWRIGHT_WEBKIT || undefined });
  const contexto = await navegador.newContext({ ...devices['iPhone 15'], locale: 'es-ES' });
  await contexto.addCookies([
    { name: nombre, value: valor, url: base },
    { name: 'cs-aviso-uso', value: 'e2e', url: base },
    { name: 'cg-guia-clipscout', value: '1', url: base },
  ]);
  await contexto.addInitScript(() => {
    try {
      localStorage.setItem('clipscout:buscar-paginas', '5');
    } catch {
      /* sin almacenamiento */
    }
  });
  const pagina = await contexto.newPage();
  pagina.setDefaultTimeout(30000);
  const errores = [];
  pagina.on('pageerror', e => errores.push(e.message));

  await pagina.goto(`${base}/#/buscar`);
  // Para comprobar que la prueba detecta el fallo de la 2.20: vuelve a poner lo que lo causaba.
  if (process.env.E2E_CON_FALLO) await pagina.evaluate(volverAlFallo);
  await pagina.locator('.buscar__entrada').fill('playa');
  await pagina.locator('.buscar__entrada').press('Enter');
  await pagina.locator('.buscar__tarjeta').nth(12).waitFor({ timeout: 60000 });
  if (!(await pagina.locator('.buscar__girando:visible').count())) {
    throw new Error('la búsqueda ya había terminado: la prueba necesita que siga trayendo');
  }
  await quietoDiezSegundos(pagina);
  await capturar(pagina, 'quieto');
  await pagina.waitForFunction(() => document.querySelector('.buscar__parar')?.hidden, null, {
    timeout: 90000,
  });
  await esperar(500);
  await subirASaltos(pagina, 'grande');
  await hojaSinSalto(pagina);
  await pagina.evaluate(() => localStorage.setItem('clipscout:buscar-vista', 'compacta'));
  await pagina.reload();
  await pagina.locator('.buscar__tarjeta').nth(40).waitFor({ timeout: 60000 });
  await esperar(500);
  if (process.env.E2E_CON_FALLO) {
    await pagina.evaluate(volverAlFallo);
  }
  await subirASaltos(pagina, 'compacta');
  await pagina.evaluate(() => localStorage.setItem('clipscout:buscar-vista', 'grande'));

  // 2. «Parar» con un sitio que no responde (30 s): parada al instante, aquí y en el servidor.
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.locator('.buscar__entrada').fill('lento');
  await pagina.locator('.buscar__entrada').press('Enter');
  await pagina.locator('.buscar__parar:not([hidden])').waitFor();
  await esperar(1500);
  const t0 = Date.now();
  await pagina.locator('.buscar__parar').tap();
  await pagina.waitForFunction(
    () =>
      document.querySelector('.buscar__parar')?.hidden &&
      document.querySelector('.buscar__estado .buscar__girando')?.hidden &&
      /parada/i.test(document.querySelector('.buscar__estado')?.textContent || ''),
    null,
    { timeout: 1000 }
  );
  registro('parada en pantalla en', Date.now() - t0, 'ms');
  await capturar(pagina, 'parada');
  let enServidor = null;
  for (let i = 0; i < 30 && !enServidor; i += 1) {
    const cola = (await (await pagina.request.get(`${base}/api/buscar/cola`)).json()).busquedas;
    const b = cola.find(x => x.q === 'lento');
    if (b?.estado === 'fin') enServidor = Date.now() - t0;
    else await esperar(100);
  }
  if (enServidor === null)
    throw new Error('el servidor sigue con la búsqueda 3 s después de parar');
  registro('parada en el servidor en', enServidor, 'ms');

  if (errores.length) throw new Error(`Errores en la página: ${errores.join(' | ')}`);
  codigo = 0;
  registro('OK');
} catch (error) {
  console.error('[desplazamiento] FALLA:', error.message);
  if (navegador) {
    const [abierta] = navegador.contexts().flatMap(c => c.pages());
    if (abierta) await capturar(abierta, 'fallo')?.catch(() => {});
  }
  console.error(salida().split('\n').slice(-20).join('\n'));
} finally {
  clearTimeout(tope);
  await limpiar();
  process.exit(codigo);
}
