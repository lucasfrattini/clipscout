'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const errores = require('../lib/errores');
const { buscarEnTodos, listarSitios } = require('../services/busqueda');
const fondo = require('../services/busquedasFondo');
const { firmarDatos } = require('../lib/firmaProxy');
const directo = require('../services/directo');
const { hostDe } = require('../services/web');

const router = express.Router();

/** GET /api/buscar/sitios — dónde se puede buscar (configuraciones guardadas con {q}). */
/**
 * POST /api/recoger/propuesta {busqueda, nombre?, n, soloConNombre, orden, minutosMinimo} —
 * «Recoger» (CS-N1): de lo que encontró esa búsqueda, los N que llevan el nombre, que no tengo,
 * sin repetidos y los más largos. Solo PROPONE: se manda con la ruta de envío de siempre.
 */
router.post('/recoger/propuesta', async (req, res) => {
  try {
    res.json(firmarDatos(await require('../services/recoger').proponer(req.body || {})));
  } catch (error) {
    errores.responder(req, res, error, logger);
  }
});

router.get('/buscar/sitios', async (req, res, next) => {
  try {
    const sitios = await listarSitios();
    const opciones = await directo.opcionesSitios().catch(() => ({}));
    res.json({
      sitios: sitios.map(s => ({
        id: s.id,
        nombre: s.nombre,
        // false: sale apagado de entrada en la pantalla (Ajustes → Sitios)
        porDefecto: !directo.fueraPorDefecto(hostDe(s.perfil.config.searchUrl || ''), opciones),
      })),
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
  // Direcciones de imagen y vídeo firmadas para el intermediario (CS-S8). Se firma al mandar,
  // no al guardar: lo retomado tras un reinicio también sale firmado.
  const send = payload => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(firmarDatos(payload))}\n\n`);
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
  // Uno o varios enlaces (lo que antes iba a Vídeos o al Explorador), separados por espacios.
  const texto = typeof fuente.url === 'string' ? fuente.url.trim() : '';
  if (texto) {
    const urls = texto.split(/\s+/).map(x => {
      try {
        const u = new URL(/^https?:\/\//i.test(x) ? x : `https://${x}`);
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch {
        return null;
      }
    });
    if (urls.some(u => u === null)) {
      const error = new Error('Algún enlace no es válido.');
      error.status = 400;
      throw error;
    }
    return {
      url: urls[0],
      urls,
      paginas: fuente.paginas,
      listado: fuente.listado === true || fuente.listado === '1',
    };
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

/** Carpeta propuesta para lo que encuentre una búsqueda (texto corto; la valida JD al enviar). */
const carpetaDe = v =>
  String(v || '')
    .trim()
    .slice(0, 200);

/**
 * POST /api/buscar/iniciar — lanza la búsqueda en segundo plano (o la encola si ya hay el máximo
 * en marcha); devuelve `{ id }`.
 */
router.post('/buscar/iniciar', (req, res) => {
  try {
    const cuerpo = req.body || {};
    const id = fondo.iniciar(entradaDe(cuerpo), { carpeta: carpetaDe(cuerpo.carpeta) });
    // CS-N9: lo buscado a mano entra en el historial (un nombre o un enlace pegado).
    require('../services/historial').apuntar(cuerpo.q || cuerpo.url);
    res.json({ id });
  } catch (error) {
    errores.responder(req, res, error, logger);
  }
});

/** GET /api/buscar/historial — lo último buscado (CS-N9). */
router.get('/buscar/historial', async (req, res) => {
  try {
    res.json(await require('../services/historial').listar());
  } catch (error) {
    errores.responder(req, res, error, logger);
  }
});

/** DELETE /api/buscar/historial[?q=…] — borra una búsqueda del historial, o todo. */
router.delete('/buscar/historial', async (req, res) => {
  try {
    res.json(await require('../services/historial').borrar(String(req.query.q || '')));
  } catch (error) {
    errores.responder(req, res, error, logger);
  }
});

/**
 * POST /api/buscar/varias { busquedas: [{ q | url, carpeta }], sitios, paginas, web, abierta } —
 * varias búsquedas de golpe (pegadas una por línea), todas a la cola. Una sola petición: una por
 * línea chocaría con el límite de peticiones caras al pegar una lista larga.
 */
router.post('/buscar/varias', (req, res) => {
  const cuerpo = req.body || {};
  const lista = Array.isArray(cuerpo.busquedas) ? cuerpo.busquedas : [];
  if (lista.length === 0) return res.status(400).json({ error: 'No hay búsquedas.' });
  const ids = [];
  const fallidas = [];
  for (const b of lista.slice(0, config.busqueda.fondoMaxEnCola)) {
    try {
      const entrada = entradaDe({
        ...cuerpo,
        q: typeof b?.q === 'string' ? b.q : '',
        url: typeof b?.url === 'string' ? b.url : '',
      });
      ids.push(fondo.iniciar(entrada, { carpeta: carpetaDe(b?.carpeta) }));
    } catch (error) {
      fallidas.push({ q: String(b?.q || b?.url || ''), error: error.message });
    }
  }
  if (ids.length) return res.json({ ids, errores: fallidas });
  // Ninguna entró (cola llena, o todas sin nada que buscar): 409 con el motivo de la primera.
  return res.status(409).json({
    codigo: 'ocupado',
    detail: fallidas[0]?.error || 'No se pudo encolar ninguna búsqueda.',
    ids,
    errores: fallidas,
  });
});

/** GET /api/buscar/cola — en marcha, esperando y terminadas recientes. */
router.get('/buscar/cola', (req, res) => {
  res.json({ busquedas: fondo.lista(), maxActivas: config.busqueda.fondoMaxActivas });
});

/** DELETE /api/buscar/cola/:id — saca una de la cola (o la para si ya estaba en marcha). */
router.delete('/buscar/cola/:id', (req, res) => {
  res.json({ ok: fondo.parar(req.params.id) });
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
 * Con `resumen=1` y desde 0, lo ya ocurrido llega resumido (CS-12; la interfaz lo pide así) y
 * después sigue en directo. Sin él, como siempre: todos los eventos.
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
  // Direcciones de imagen y vídeo firmadas para el intermediario (CS-S8). Se firma al mandar,
  // no al guardar: lo retomado tras un reinicio también sale firmado.
  const send = payload => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(firmarDatos(payload))}\n\n`);
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
  const resumen = req.query.resumen === '1';
  baja = fondo.suscribir(
    req.params.id,
    desde,
    evento => {
      send(evento);
      if (evento.type === 'fin' || evento.type === 'error') setImmediate(cerrar);
    },
    { resumen }
  );
  if (baja === null) {
    send({ type: 'no_existe' });
    cerrar();
  }
});

module.exports = router;
