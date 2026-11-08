'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { buscarEnTodos, listarSitios } = require('../services/busqueda');

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
      { q, sitios, paginas: req.query.paginas, web: req.query.web === '1' },
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

module.exports = router;
