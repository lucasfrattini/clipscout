'use strict';

const path = require('node:path');
const express = require('express');

const config = require('./config');
const apiRoutes = require('./routes');
const thumbnailRoutes = require('./routes/thumbnail');
const { createRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * HTTP Basic con comparación en tiempo constante. Libres: el protocolo clip crew (tiene su
 * propia clave) y /api/health (healthcheck del contenedor).
 */
function requerirContrasena({ adminUser, adminPassword }) {
  const crypto = require('node:crypto');
  const igual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  return (req, res, next) => {
    if (req.path === '/api/health' || req.path.startsWith('/api/crew/v1/')) return next();
    const [tipo, valor] = (req.get('authorization') || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [usuario, ...resto] = Buffer.from(valor, 'base64').toString('utf8').split(':');
      if (igual(usuario, adminUser) && igual(resto.join(':'), adminPassword)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="clipscout", charset="UTF-8"');
    return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
  };
}

function createApp() {
  const app = express();

  /**
   * De quién se acepta `X-Forwarded-For`.
   *
   * NO poner `true` aquí. `true` es "confía en cualquiera", y como `req.ip`
   * sale de esa cabecera y el rate limiting va por `req.ip`, un cliente que
   * rote la cabecera se salta el límite entero. Ver `security.trustProxy`.
   */
  app.set('trust proxy', config.security.trustProxy);
  app.disable('x-powered-by');

  // Contraseña opcional (ADMIN_PASSWORD). Va lo primero para que nada se sirva sin ella.
  if (config.security.adminPassword) app.use(requerirContrasena(config.security));

  // Tope de body: nada legítimo se acerca a esto
  app.use(express.json({ limit: '64kb' }));

  // Cabeceras de seguridad. La CSP es estricta porque el front no carga
  // recursos externos ni usa scripts inline.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    next();
  });

  /**
   * Las miniaturas van con su PROPIO límite, y antes del general.
   *
   * El límite de /api son 30 peticiones por minuto porque está pensado para
   * lo caro: un crawl, un análisis de vídeo. Una miniatura es una imagen
   * pequeña que además se sirve de caché, y una sola lista de resultados
   * necesita decenas. Cuando compartían límite, las primeras 30 cargaban y
   * el resto aparecía como imagen rota.
   */
  app.use('/api', createRateLimiter(config.thumbnails.rateLimit), thumbnailRoutes);

  // Lo caro tiene su propio límite, más estricto; el resto de /api va con el general.
  app.use(
    ['/api/scrape', '/api/video', '/api/buscar/stream'],
    createRateLimiter({ maxRequests: config.security.rateLimit.maxPesadas })
  );
  app.use('/api', createRateLimiter(), apiRoutes);

  // no-cache no significa "no guardes", sino "revalida siempre antes de
  // usar". Con max-age=0 los navegadores seguian sirviendo modulos ES desde
  // memoria hasta un recargado forzado, asi que tras desplegar se veia la
  // version anterior. Con esto basta con recargar normal.
  // `/404.html` es un fichero real en `public/`, así que sin esto
  // `express.static` lo serviría con estado 200: una página de error
  // anunciándose como página buena, que es justo lo que arregla este bloque.
  app.get('/404.html', (req, res) => {
    res.status(404).set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      etag: true,
      lastModified: true,
      setHeaders: res => res.set('Cache-Control', 'no-cache'),
    })
  );

  /**
   * La raíz sirve el shell del front.
   *
   * ANTES esto era un comodín `/^\/(?!api\/).*​/` que devolvía el shell con
   * estado 200 para CUALQUIER ruta inventada. La app no tiene router de
   * rutas: las dos herramientas viven en la misma URL y se cambian por hash
   * (`#/explorer`, `#/video`), así que la única ruta válida es `/`. Servir
   * 200 en `/loquesea` hacía que un enlace roto pareciera una página buena,
   * tanto para quien lo abre como para un buscador.
   */
  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  /**
   * Cualquier otra ruta no-API que no haya casado con un fichero estático es
   * un 404 de verdad: estado 404 y página propia. Las peticiones bajo `/api/`
   * no entran aquí — esas las contesta `notFoundHandler` en JSON, que es lo
   * que espera quien las llama.
   */
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.status(404).set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, config, PUBLIC_DIR };
