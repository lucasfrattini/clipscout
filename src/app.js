'use strict';

const path = require('node:path');
const express = require('express');

const config = require('./config');
const apiRoutes = require('./routes');
const thumbnailRoutes = require('./routes/thumbnail');
const mediaRoutes = require('./routes/media');
const { createRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const errores = require('./lib/errores');
const logger = require('./lib/logger');

const { crearAcceso } = require('./middleware/acceso');
const credenciales = require('./services/acceso');
const sesiones = require('./services/sesiones');
const apagado = require('./services/apagado');
const asistente = require('./services/asistente');
const { estaticosComprimidos } = require('./lib/estaticosComprimidos');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

  // Errores con código (SU-10): envuelve `res.json` antes que nada, así también salen con
  // `{codigo, detail, params}` los rechazos de la guardia de acceso.
  app.use(errores.formatoErrores);

  // Acceso (sesiones, claves, host y origen: middleware/acceso.js). Va lo primero para que nada se
  // sirva sin él.
  const acceso = crearAcceso({ retrasoFalloMs: config.security.loginRetrasoFalloMs });
  app.use(acceso.guardia);

  // Tope de body: nada legítimo se acerca a esto
  app.use(express.json({ limit: '64kb' }));

  // Apagado ordenado (CS-20): cuenta lo que hay en vuelo y, apagando, no acepta nada nuevo. La
  // autorización ya la ha puesto la guardia (sesión, clave de administración, o el propio equipo
  // con `X-Clipgeist: 1`, que es lo que manda el lanzador).
  app.use(apagado.middleware);
  app.get('/api/estado-trabajos', (req, res) => res.json(apagado.estadoTrabajos()));
  app.post('/api/apagar', (req, res) => {
    const { que } = apagado.estadoTrabajos();
    res.on('finish', () => setImmediate(() => apagado.apagar({ motivo: 'POST /api/apagar' })));
    res.set('Connection', 'close').json({ ok: true, esperando: que });
  });

  // `protegido` le dice a la interfaz si tiene sentido ofrecer «Salir»; `primerArranque`, que hay
  // que crear el usuario (y `pideCodigo`, si desde aquí hace falta el código del registro);
  // `avisoCifrado`, que se está entrando desde internet sin HTTPS.
  app.get('/api/auth/estado', async (req, res) => {
    await credenciales.cargar().catch(() => {});
    const e = credenciales.estado();
    res.json({
      ...e,
      // CS-S12: el nombre de usuario solo a quien ya ha entrado (o desde el propio equipo); sin
      // sesión, desde otro, ayudaría a adivinar la contraseña.
      usuario: req.sesion || acceso.esLocal(req) ? e.usuario : '',
      primerArranque: !e.protegido,
      pideCodigo: !e.protegido && !acceso.esLocal(req),
      // Asistente de primer arranque: solo en una instalación nueva (sin usuario ni datos).
      asistente: !e.protegido && (await asistente.esNueva().catch(() => false)),
      local: acceso.esLocal(req),
      sesion: Boolean(req.sesion),
      avisoCifrado: acceso.avisoSinCifrar(req),
    });
  });
  // Las otras apps de Clipgeist detectadas (asistente, paso 1 y 3). Sin usuario creado, a
  // cualquiera (sin direcciones si no es este equipo); con usuario, solo con sesión.
  app.get('/api/auth/apps', async (req, res, next) => {
    try {
      const sinUsuario = !credenciales.activo();
      if (!sinUsuario && !req.sesion) {
        return res.status(401).json({ detail: 'Hace falta usuario y contraseña.' });
      }
      const conUrl = Boolean(req.sesion) || acceso.esLocal(req);
      return res.json({ apps: await asistente.detectar({ conUrl }) });
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/auth/login', acceso.login);
  app.post('/api/auth/logout', acceso.logout);
  app.post('/api/auth/primer-usuario', acceso.primerUsuario);
  // El mismo nombre que en clipkeeper y clonbuster (contrato de la suite): alias, sin cambiar nada.
  app.post('/api/auth/configurar', acceso.primerUsuario);

  // Ajustes → Seguridad: poner, cambiar o quitar la contraseña (pide la actual si ya había). Tras
  // cambiarla, las demás sesiones quedan cerradas y esta sigue dentro.
  const cambiarAcceso = fn => async (req, res) => {
    try {
      const r = await fn(req);
      await acceso.trasCambiarContrasena(req, res);
      res.json(r);
    } catch (error) {
      errores.responder(req, res, error, logger);
    }
  };
  app.put(
    '/api/ajustes/acceso',
    cambiarAcceso(req =>
      credenciales.configurar(req.body || {}, {
        local: acceso.esLocal(req) || req.clave?.tipo === 'admin',
      })
    )
  );
  app.post(
    '/api/ajustes/acceso/quitar',
    cambiarAcceso(req => credenciales.quitar(req.body || {}))
  );

  // Sesiones abiertas (Ajustes → Seguridad): las de esta app.
  const sesionActual = req => (req.sesion?.propia ? req.sesion.testigo : null);
  app.get('/api/ajustes/sesiones', async (req, res, next) => {
    try {
      res.json({ sesiones: await sesiones.listar(sesionActual(req)) });
    } catch (error) {
      next(error);
    }
  });
  app.delete('/api/ajustes/sesiones/:id', async (req, res, next) => {
    try {
      const ok = await sesiones.cerrar({ id: req.params.id });
      if (!ok) return res.status(404).json({ detail: 'No existe esa sesión.' });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/ajustes/sesiones/cerrar-demas', async (req, res, next) => {
    try {
      res.json({ cerradas: await sesiones.cerrarTodas({ salvo: sesionActual(req) }) });
    } catch (error) {
      next(error);
    }
  });

  // Cabeceras de seguridad. La CSP es estricta porque el front no carga
  // recursos externos ni usa scripts inline.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    // CS-S12: aislamiento entre orígenes. Otra ventana abierta desde una web no puede tocar esta;
    // las respuestas de la API no se pueden incrustar desde otra web (las miniaturas, el vídeo y
    // los iconos sí: los usan las otras apps de Clipgeist).
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (
      req.path.startsWith('/api/') &&
      !req.path.startsWith('/api/thumbnail') &&
      !req.path.startsWith('/api/media')
    ) {
      res.set('Cross-Origin-Resource-Policy', 'same-origin');
    }
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
  // CS-S12: el límite de miniaturas, solo en /api/thumbnail (montado en /api contaba también las
  // demás peticiones de la API).
  app.use('/api/thumbnail', createRateLimiter(config.thumbnails.rateLimit));
  app.use('/api', thumbnailRoutes);
  // Reproducir: cada salto del reproductor es una petición (Range), con su propio límite.
  app.use('/api/media', createRateLimiter(config.media.rateLimit));
  app.use('/api', mediaRoutes);

  // Lo caro tiene su propio límite, más estricto; el resto de /api va con el general.
  app.use(
    [
      '/api/scrape',
      '/api/video',
      '/api/buscar/stream',
      '/api/buscar/iniciar',
      '/api/buscar/varias',
      '/api/sitios/auto',
    ],
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

  // Antes que express.static: lo mismo, pero con gzip (por una VPN, ~4 veces menos que bajar).
  app.use(estaticosComprimidos(PUBLIC_DIR));
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

/**
 * Tiempos de las conexiones del servidor HTTP. Node cierra una conexión en reposo a los 5 s, y
 * Safari (y algunos proxys) la reutilizan justo después: la petición sale por una conexión ya
 * cerrada y falla con «Load failed». Con 65 s (más que los 60 de los proxys habituales) es el
 * cliente quien la cierra primero. `headersTimeout` tiene que ser algo mayor que `keepAliveTimeout`.
 */
const KEEP_ALIVE_MS = 65000;
function ajustarConexiones(server) {
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1000;
  return server;
}

module.exports = { createApp, ajustarConexiones, KEEP_ALIVE_MS, config, PUBLIC_DIR };
