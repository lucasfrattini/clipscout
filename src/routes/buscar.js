'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { buscarEnTodos, listarSitios } = require('../services/busqueda');
const fondo = require('../services/busquedasFondo');

const router = express.Router();

/** GET /api/buscar/sitios — dónde se puede buscar (configuraciones guardadas con {q}). */
router.get('/buscar/sitios', async (req, res, next) => {
  try {
    const sitios = await listarSitios();
    res.json({
      sitios: sitios.map(s => ({ id: s.id, nombre: s.nombre })),
      web: Boolean(config.busqueda.searxngUrl),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/buscar/stream?q=nombre[&sitios=0,3] — busca en todos (o en los elegidos) con progreso
 * por SSE. Igual que /scrape/stream: si el cliente se va, se aborta todo.
 */
router.get('/buscar/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  const send = payload => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const latido = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, config.sse.heartbeatMs);
  latido.unref?.();
  req.on('close', () => {
    controller.abort();
    clearInterval(latido);
  });

  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw new Error('Escribe qué buscar');
    const sitios =
      typeof req.query.sitios === 'string' && req.query.sitios.trim() !== ''
        ? req.query.sitios
            .split(',')
            .map(x => Number.parseInt(x, 10))
            .filter(Number.isInteger)
        : null;
    const r = await buscarEnTodos(
      {
        q,
        sitios,
        paginas: req.query.paginas,
        web: req.query.web === '1',
        abierta: req.query.abierta === '1',
      },
      { signal: controller.signal, emit: send }
    );
    send({ type: 'fin', ...r });
  } catch (error) {
    logger.warn(`Error en la búsqueda: ${error.message}`);
    send({ type: 'error', message: error.message });
  } finally {
    clearInterval(latido);
    if (!res.writableEnded) res.end();
  }
});

/** Lo que llega para buscar, igual en el stream clásico y en la búsqueda en segundo plano. */
function entradaDe(fuente) {
  // Un enlace (lo que antes iba al Explorador o a Vídeos): se analiza él solo.
  const url = typeof fuente.url === 'string' ? fuente.url.trim() : '';
  if (url) {
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    } catch {
      u = null;
    }
    if (!u || !/^https?:$/.test(u.protocol)) {
      const error = new Error('Ese enlace no es válido.');
      error.status = 400;
      throw error;
    }
    return { url: u.href, paginas: fuente.paginas };
  }
  const q = typeof fuente.q === 'string' ? fuente.q.trim() : '';
  if (!q) {
    const error = new Error('Escribe qué buscar');
    error.status = 400;
    throw error;
  }
  const lista = Array.isArray(fuente.sitios)
    ? fuente.sitios
    : typeof fuente.sitios === 'string' && fuente.sitios.trim() !== ''
      ? fuente.sitios.split(',')
      : null;
  return {
    q,
    sitios: lista ? lista.map(x => Number.parseInt(x, 10)).filter(Number.isInteger) : null,
    paginas: fuente.paginas,
    web: fuente.web === true || fuente.web === '1',
    abierta: fuente.abierta === true || fuente.abierta === '1',
  };
}

/** POST /api/buscar/iniciar — lanza la búsqueda en segundo plano; devuelve `{ id }`. */
router.post('/buscar/iniciar', (req, res) => {
  try {
    res.json({ id: fondo.iniciar(entradaDe(req.body || {})) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/** GET /api/buscar/actual — la última búsqueda (para reengancharse al volver). */
router.get('/buscar/actual', (req, res) => {
  res.json({ busqueda: fondo.actual() });
});

/** POST /api/buscar/trabajos/:id/parar */
router.post('/buscar/trabajos/:id/parar', (req, res) => {
  res.json({ ok: fondo.parar(req.params.id) });
});

/**
 * GET /api/buscar/trabajos/:id/stream?desde=N — los eventos de esa búsqueda desde el N (por SSE).
 * Cerrar esta conexión NO para la búsqueda: solo deja de mirarla.
 */
router.get('/buscar/trabajos/:id/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = payload => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const latido = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, config.sse.heartbeatMs);
  latido.unref?.();
  let baja = null;
  const cerrar = () => {
    clearInterval(latido);
    baja?.();
    if (!res.writableEnded) res.end();
  };
  req.on('close', cerrar);
  const desde = Number.parseInt(req.query.desde, 10) || 0;
  baja = fondo.suscribir(req.params.id, desde, evento => {
    send(evento);
    if (evento.type === 'fin' || evento.type === 'error') setImmediate(cerrar);
  });
  if (baja === null) {
    send({ type: 'no_existe' });
    cerrar();
  }
});

module.exports = router;
