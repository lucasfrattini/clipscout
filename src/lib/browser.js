'use strict';

const dns = require('node:dns').promises;
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const puppeteer = require('puppeteer');

const config = require('../config');
const logger = require('./logger');
const { AppError } = require('./errors');
const { assertUrlIsSafe, isPrivateAddress } = require('./ssrf');

/**
 * Pool de Puppeteer.
 *
 * La versión anterior hacía puppeteer.launch() + browser.close() por CADA
 * página: arrancar Chromium cuesta ~1s y bastante RAM, así que un crawl de 20
 * páginas lanzaba 20 navegadores en serie. Aquí se mantiene un único navegador
 * con un pool de pestañas, y se cierra solo tras un rato sin uso.
 */

const BASE_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  // Sin extensiones del usuario ni de nadie, sin sincronizar y sin servicios en segundo plano.
  '--disable-extensions',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-breakpad',
];
const SIN_SANDBOX = ['--no-sandbox', '--disable-setuid-sandbox', '--no-zygote'];

/**
 * ¿Hay que quitar el aislamiento (sandbox) de Chromium? (CS-S3)
 *
 * Fuera de un contenedor se deja PUESTO: en el escritorio se usa el Chrome/Edge del propio
 * usuario contra páginas de terceros, y sin aislamiento un fallo del navegador ejecutaría código
 * con sus permisos. Solo se quita donde no puede funcionar: dentro de Docker (el perfil seccomp
 * por defecto no deja crear los espacios de nombres que necesita) o corriendo como root.
 * `BROWSER_SANDBOX=on|off` lo fuerza.
 */
function sinSandbox() {
  const forzado = String(process.env.BROWSER_SANDBOX || '').toLowerCase();
  if (forzado === 'on' || forzado === 'true' || forzado === '1') return false;
  if (forzado === 'off' || forzado === 'false' || forzado === '0') return true;
  if (process.getuid?.() === 0) return true;
  return enContenedor();
}

function enContenedor() {
  try {
    if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return true;
    return /docker|containerd|kubepods|libpod/.test(fs.readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
}

/** Perfil NUEVO por cada arranque del navegador (se borra al cerrarlo): nada pasa de una sesión a otra. */
let restosBorrados = false;
function perfilTemporal() {
  const base = path.dirname(config.browser.userDataDir);
  const prefijo = `${path.basename(config.browser.userDataDir)}-`;
  fs.mkdirSync(base, { recursive: true });
  // Los que dejara un cierre brusco anterior de ESTE proceso de clipscout (solo hay uno).
  if (!restosBorrados) {
    restosBorrados = true;
    for (const n of fs
      .readdirSync(base)
      .filter(x => x.startsWith(prefijo) && x.length === prefijo.length + 6)) {
      fs.rmSync(path.join(base, n), { recursive: true, force: true });
    }
  }
  return fs.mkdtempSync(path.join(base, `${path.basename(config.browser.userDataDir)}-`));
}

function argumentosLanzamiento(perfil, { sandbox = !sinSandbox() } = {}) {
  const args = [
    ...(sandbox ? [] : SIN_SANDBOX),
    ...BASE_ARGS,
    // Con el sistema de ficheros en solo lectura (Docker con read_only: true), Chromium no puede
    // crear la base de datos de crashpad en su HOME: todo va a un directorio escribible.
    `--user-data-dir=${perfil}`,
  ];
  if (config.outboundProxy) {
    args.push(`--proxy-server=${config.outboundProxy.replace(/\/\/[^@]*@/, '//')}`);
    // Los que bloquean la VPN van directos (también en el navegador)
    if (config.outboundProxyBypass.length) {
      args.push(
        `--proxy-bypass-list=${config.outboundProxyBypass.flatMap(d => [d, `*.${d}`]).join(';')}`
      );
    }
  }
  return args;
}

/* ── Red local fuera del alcance de las páginas (CS-S6) ─────────────── */

const resueltos = new Map(); // host → {privado, hasta}
const RESUELTO_MS = 60 * 1000;

/**
 * ¿Esta petición del navegador va a la red local (privada, loopback, enlace local…)? Se mira
 * CADA petición: la primera dirección, las redirecciones, los marcos y lo que pida el código de
 * la página. Un nombre que no se puede resolver aquí no se corta (con proxy de salida lo resuelve
 * el proxy); uno que resuelve a una dirección privada, sí. El proxy de salida configurado no pasa
 * por aquí: Chromium habla con él directamente, no es una petición de la página.
 */
async function vaARedLocal(rawUrl) {
  if (!config.security.blockPrivateAddresses) return false;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'ws:', 'wss:', 'ftp:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  const previo = resueltos.get(host);
  if (previo && previo.hasta > Date.now()) return previo.privado;
  let privado = false;
  try {
    const direcciones = await dns.lookup(host, { all: true });
    privado = direcciones.some(d => isPrivateAddress(d.address));
  } catch {
    privado = false;
  }
  if (resueltos.size > 2000) resueltos.clear();
  resueltos.set(host, { privado, hasta: Date.now() + RESUELTO_MS });
  return privado;
}

/**
 * Intercepta todas las peticiones de la pestaña y corta las que van a la red local. Los
 * `observadores` (p. ej. la captura de vídeos de renderPageWithMedia) solo miran: quien decide
 * seguir o cortar es esto.
 */
async function protegerPestana(page, observadores = []) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    for (const mirar of observadores) {
      try {
        mirar(request);
      } catch {
        // no bloquear la navegación por un fallo al inspeccionar
      }
    }
    vaARedLocal(request.url())
      .then(local => {
        if (request.isInterceptResolutionHandled?.()) return undefined;
        if (local) {
          logger.debug(`Navegador: bloqueada una petición a la red local (${request.url()})`);
          return request.abort('addressunreachable');
        }
        return request.continue();
      })
      .catch(() => {});
  });
}

class BrowserPool {
  constructor(options = {}) {
    this.size = options.size ?? config.browser.poolSize;
    this.idleShutdownMs = options.idleShutdownMs ?? config.browser.idleShutdownMs;
    this.browser = null;
    this.launching = null;
    this.available = this.size;
    this.queue = [];
    this.idleTimer = null;
    this.closed = false;
  }

  async getBrowser() {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;

    const lanzar = sandbox => {
      const perfil = perfilTemporal();
      return puppeteer
        .launch({
          headless: true,
          args: argumentosLanzamiento(perfil, { sandbox }),
          protocolTimeout: config.browser.protocolTimeoutMs,
          // undefined = Chromium propio de Puppeteer; en Docker apunta al de apt
          executablePath: config.browser.executablePath,
        })
        .then(
          browser => {
            browser.perfilTemporal = perfil;
            browser.on('disconnected', () =>
              fs.rm(perfil, { recursive: true, force: true }, () => {})
            );
            return browser;
          },
          error => {
            fs.rm(perfil, { recursive: true, force: true }, () => {});
            throw error;
          }
        );
    };
    const conSandbox = !sinSandbox();
    this.launching = lanzar(conSandbox)
      .catch(error => {
        // Hay escritorios (algunos Linux con los espacios de nombres sin privilegios
        // desactivados) donde el aislamiento no arranca: antes que dejar la app sin navegador, se
        // sigue sin él, avisando. Con BROWSER_SANDBOX=on no se reintenta.
        const forzado = /^(on|true|1)$/i.test(String(process.env.BROWSER_SANDBOX || ''));
        if (!conSandbox || forzado || !/sandbox|namespace|zygote/i.test(error.message)) throw error;
        logger.warn(
          'El navegador no arranca aislado (sandbox) en este equipo: se usa SIN aislamiento. ' +
            'Pon BROWSER_SANDBOX=on para impedirlo.',
          String(error.message)
            .split('\n')
            .find(l => /sandbox/i.test(l)) || ''
        );
        return lanzar(false);
      })
      .then(browser => {
        this.browser = browser;
        this.launching = null;
        browser.on('disconnected', () => {
          if (this.browser === browser) this.browser = null;
        });
        logger.info('Navegador Puppeteer iniciado');
        return browser;
      })
      .catch(error => {
        this.launching = null;
        throw new AppError(
          `No se pudo iniciar el navegador: ${error.message}`,
          503,
          'BROWSER_UNAVAILABLE'
        );
      });

    return this.launching;
  }

  async acquireSlot() {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
    this.available -= 1;
  }

  releaseSlot() {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
    this.scheduleIdleShutdown();
  }

  scheduleIdleShutdown() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.available < this.size) return; // aún hay trabajo en curso
    this.idleTimer = setTimeout(() => {
      this.close().catch(error => logger.warn('Error cerrando el navegador', error.message));
    }, this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  /**
   * Ejecuta `task(page)` con una pestaña del pool y la cierra siempre.
   *
   * `signal`: al pararse una búsqueda se CIERRA la pestaña en el acto, así la navegación en curso
   * (que puede tardar hasta `navigationTimeoutMs` con un sitio que no responde) falla ya y libera
   * su hueco del pool, en vez de terminar su carga para nada.
   */
  async withPage(task, { protegeSola = false, signal } = {}) {
    if (!config.browser.enabled) {
      throw new AppError(
        'El navegador está desactivado por configuración',
        503,
        'BROWSER_DISABLED'
      );
    }
    const cancelada = () => new AppError('Búsqueda parada', 499, 'ABORTED');
    if (signal?.aborted) throw cancelada();

    await this.acquireSlot();
    let page = null;
    let alAbortar = null;
    try {
      if (signal?.aborted) throw cancelada();
      const browser = await this.getBrowser();
      page = await browser.newPage();
      if (signal) {
        const pestana = page;
        alAbortar = () => pestana.close().catch(() => {});
        signal.addEventListener('abort', alAbortar, { once: true });
        if (signal.aborted) throw cancelada();
      }
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      );
      page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
      if (!protegeSola) await protegerPestana(page);
      return await task(page);
    } catch (error) {
      if (signal?.aborted) throw cancelada();
      throw error;
    } finally {
      if (alAbortar) signal.removeEventListener('abort', alAbortar);
      if (page) {
        await page.close().catch(() => {});
      }
      this.releaseSlot();
    }
  }

  async close() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      await browser.close().catch(() => {});
      if (browser.perfilTemporal) {
        fs.rmSync(browser.perfilTemporal, { recursive: true, force: true, maxRetries: 3 });
      }
      logger.info('Navegador Puppeteer cerrado');
    }
  }
}

const pool = new BrowserPool();

/**
 * Scroll incremental para disparar la carga diferida.
 *
 * Va con tope propio: en páginas con scripts pesados el evaluate puede no
 * volver nunca, y como el scroll es un extra (no la razón de la visita), es
 * preferible seguir sin él que bloquear la pestaña y agotar el pool.
 */
async function autoScroll(page) {
  const { scrollStepPx, maxScrollPx, scrollTimeoutMs } = config.browser;
  const scrolling = page.evaluate(
    async (step, max) => {
      await new Promise(resolve => {
        let total = 0;
        const timer = setInterval(() => {
          const { scrollHeight } = document.body;
          window.scrollBy(0, step);
          total += step;
          if (total >= scrollHeight || total > max) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    },
    scrollStepPx,
    maxScrollPx
  );

  await Promise.race([
    scrolling,
    new Promise(resolve => setTimeout(resolve, scrollTimeoutMs)),
  ]).catch(() => {});
}

/** Renderiza una URL con JS y devuelve el HTML final. */
async function renderPage(url, { scroll = true, signal } = {}) {
  await assertUrlIsSafe(url);

  return pool.withPage(
    async page => {
      await page.goto(url, {
        waitUntil: config.browser.waitUntil,
        timeout: config.browser.navigationTimeoutMs,
      });

      if (scroll) {
        await autoScroll(page);
        // NOTA: page.waitForTimeout fue eliminado en Puppeteer v22.
        await new Promise(resolve => setTimeout(resolve, config.browser.settleMs));
      }

      return page.content();
    },
    { signal }
  );
}

/**
 * Renderiza una página que carga más resultados al bajar (scroll infinito).
 *
 * A diferencia de `autoScroll`, que baja a ciegas una cantidad fija, esta
 * OBSERVA: tras cada scroll cuenta los enlaces y sigue solo mientras aparezcan
 * nuevos. Así se adapta a sitios que cargan lotes de tamaños distintos.
 *
 * ── Por qué cada ronda es un evaluate corto ──────────────────────────
 * Sería más directo meter el bucle entero dentro de un solo page.evaluate,
 * pero entonces una página que bloquea el hilo dejaría esa llamada sin
 * volver, y con ella la pestaña colgada hasta agotar el protocolTimeout. Con
 * una orden corta por ronda, el control vuelve a Node entre medias y los
 * topes se comprueban de verdad.
 *
 * ── Los topes son obligatorios ───────────────────────────────────────
 * Esta función ocupa UNA pestaña del pool durante toda la fase 1, y el pool
 * tiene dos. Un sitio con scroll sin fin bloquearía la aplicación para todo
 * el mundo. Se corta por lo que llegue primero: rondas, tiempo, número de
 * enlaces, o varias rondas seguidas sin nada nuevo.
 */
async function renderPageWithInfiniteScroll(url, options = {}) {
  await assertUrlIsSafe(url);

  const {
    maxRounds = config.scroll.maxRounds,
    maxDurationMs = config.scroll.maxDurationMs,
    maxElements = config.scroll.maxElements,
    settleMs = config.scroll.settleMs,
    stableRounds = config.scroll.stableRounds,
    signal,
    onRound,
  } = options;

  return pool.withPage(
    async page => {
      await page.goto(url, {
        waitUntil: config.browser.waitUntil,
        timeout: config.browser.navigationTimeoutMs,
      });

      const startedAt = Date.now();
      let previousCount = 0;
      let sinCambios = 0;
      let rounds = 0;
      let motivo = 'sin-contenido-nuevo';

      // Una ronda: bajar del todo y devolver cuántos enlaces hay ahora
      const scrollOnce = () =>
        page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return document.querySelectorAll('a[href]').length;
        });

      // Recuento inicial, antes de tocar nada
      previousCount = await scrollOnce().catch(() => 0);

      while (rounds < maxRounds) {
        if (signal?.aborted) {
          motivo = 'cancelado';
          break;
        }
        if (Date.now() - startedAt > maxDurationMs) {
          motivo = 'tiempo-agotado';
          break;
        }
        if (previousCount >= maxElements) {
          motivo = 'tope-de-elementos';
          break;
        }

        await new Promise(resolve => setTimeout(resolve, settleMs));

        let count;
        try {
          count = await scrollOnce();
        } catch (error) {
          // La pestaña dejó de responder: se para y se aprovecha lo que haya
          logger.warn(`Scroll interrumpido en ${url}`, error.message);
          motivo = 'error-de-navegador';
          break;
        }

        rounds += 1;
        const nuevos = count - previousCount;
        previousCount = count;

        onRound?.({ round: rounds, totalElements: count, nuevos });

        if (nuevos <= 0) {
          sinCambios += 1;
          // Un solo lote lento cortaría la exploración antes de tiempo, así
          // que hacen falta varias rondas seguidas en blanco para creerse
          // que ya no queda nada.
          if (sinCambios >= stableRounds) {
            motivo = 'sin-contenido-nuevo';
            break;
          }
        } else {
          sinCambios = 0;
        }

        if (rounds >= maxRounds) motivo = 'tope-de-rondas';
      }

      return {
        html: await page.content(),
        rounds,
        totalElements: previousCount,
        motivo,
        durationMs: Date.now() - startedAt,
      };
    },
    { signal }
  );
}

/**
 * Renderiza y además captura las peticiones de red de tipo media, que es como
 * se cazan los videos que nunca aparecen en el HTML.
 */
async function renderPageWithMedia(url, { isMediaUrl, signal } = {}) {
  await assertUrlIsSafe(url);

  return pool.withPage(
    async page => {
      const mediaRequests = [];

      await protegerPestana(page, [
        request => {
          const requestUrl = request.url();
          const isMedia = request.resourceType() === 'media';
          if (isMedia || isMediaUrl?.(requestUrl)) {
            mediaRequests.push({ url: requestUrl, resourceType: request.resourceType() });
          }
        },
      ]);

      await page.goto(url, {
        waitUntil: config.browser.waitUntil,
        timeout: config.browser.navigationTimeoutMs,
      });

      await autoScroll(page);
      await new Promise(resolve => setTimeout(resolve, config.browser.settleMs));

      const domVideos = await page.evaluate(() => {
        const found = [];
        // `poster`, `duration`, `videoWidth`/`videoHeight` son propiedades del
        // <video>, no del <source> hijo que suele llevar la URL real del
        // fichero. Recorrer video y source como una lista plana les daba
        // `poster: null` a los <source> —no tienen esa propiedad— y saltaba
        // los <video> que solo declaran el fichero vía <source> (su `.src`
        // queda vacío sin el atributo). El resultado: una ficha con varios
        // vídeos acababa con todos sin miniatura propia, y aguas abajo se les
        // estampaba la de la página entera a todos por igual.
        const procesados = new Set();
        document.querySelectorAll('video').forEach(video => {
          const duration = Number.isFinite(video.duration) ? video.duration : null;
          const poster = video.poster || null;
          const width = video.videoWidth || video.getAttribute('width') || null;
          const height = video.videoHeight || video.getAttribute('height') || null;

          const fuentes = [];
          if (video.src) fuentes.push(video);
          video.querySelectorAll('source').forEach(source => fuentes.push(source));

          fuentes.forEach(el => {
            const src = el.src || el.getAttribute('data-src') || el.getAttribute('data-video-src');
            if (!src) return;
            procesados.add(el);
            found.push({
              url: src,
              element: el.tagName.toLowerCase(),
              duration,
              width,
              height,
              poster,
            });
          });
        });
        // <source> sin <video> padre: no hay poster ni duración que heredar.
        document.querySelectorAll('source').forEach(source => {
          if (procesados.has(source)) return;
          const src =
            source.src || source.getAttribute('data-src') || source.getAttribute('data-video-src');
          if (src) {
            found.push({
              url: src,
              element: 'source',
              duration: null,
              width: null,
              height: null,
              poster: null,
            });
          }
        });
        document.querySelectorAll('[data-video], [data-src], [data-video-url]').forEach(el => {
          const src =
            el.getAttribute('data-video') ||
            el.getAttribute('data-src') ||
            el.getAttribute('data-video-url');
          if (src) {
            found.push({ url: src, element: 'data-attribute', duration: null });
          }
        });
        return found;
      });

      const html = await page.content();
      return { html, domVideos, mediaRequests };
    },
    { protegeSola: true, signal }
  );
}

/**
 * Usa el buscador del propio sitio como lo haría una persona: abre la portada, escribe `termino`
 * en la caja de búsqueda y pulsa Intro. Devuelve la dirección a la que llevó (o null si no hay
 * caja o no navegó). Es lo único que funciona con los buscadores montados con JavaScript, que
 * convierten `?q=` en `/search/<término>/` o similares.
 */
async function enviarBusqueda(url, termino, { signal } = {}) {
  await assertUrlIsSafe(url);

  return pool.withPage(
    async page => {
      await page.goto(url, {
        waitUntil: config.browser.waitUntil,
        timeout: config.browser.navigationTimeoutMs,
      });
      const selector = await page.evaluate(() => {
        const visible = el => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const candidatos = [
          ...document.querySelectorAll(
            'input[type="search"], input[type="text"], input:not([type])'
          ),
        ];
        const pista = el =>
          /search|busca|query|keyword|^q$|^s$|^k$/i.test(
            [el.name, el.id, el.placeholder, el.className, el.getAttribute('aria-label')].join(' ')
          );
        const elegido =
          candidatos.find(el => el.type === 'search' && pista(el)) ||
          candidatos.find(el => pista(el) && visible(el)) ||
          candidatos.find(pista);
        if (!elegido) return null;
        elegido.setAttribute('data-clipscout-busqueda', '1');
        return '[data-clipscout-busqueda="1"]';
      });
      if (!selector) return null;
      const antes = page.url();
      // Las cajas ocultas (detrás de un icono de lupa) no aceptan teclas: se les da el valor directo.
      await page.$eval(
        selector,
        (el, valor) => {
          el.focus();
          el.value = valor;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        termino
      );
      await Promise.all([
        page
          .waitForNavigation({
            waitUntil: 'domcontentloaded',
            timeout: config.browser.navigationTimeoutMs,
          })
          .catch(() => null),
        page.$eval(selector, el => {
          const form = el.form;
          if (form?.requestSubmit) form.requestSubmit();
          else if (form) form.submit();
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }),
      ]);
      const despues = page.url();
      return despues !== antes ? despues : null;
    },
    { signal }
  );
}

module.exports = {
  pool,
  renderPage,
  renderPageWithMedia,
  enviarBusqueda,
  renderPageWithInfiniteScroll,
  BrowserPool,
  vaARedLocal,
  protegerPestana,
  argumentosLanzamiento,
  sinSandbox,
};
