'use strict';

const express = require('express');

const logger = require('../lib/logger');
const errores = require('../lib/errores');
const registro = require('../lib/registro');
const diagnostico = require('../services/diagnostico');
const copia = require('../services/copia');
const actualizaciones = require('../services/actualizaciones');

/**
 * Rutas de la fase 5 (un solo producto; contratos comunes en docs/CREW.md):
 *
 * - `GET /api/salud` (sin sesión): ¿puede trabajar? `{ok, app, version}`.
 * - `GET /api/diagnostico`, `/registro?lineas=N`, `/informe` (sesión o clave de administración).
 * - `GET /api/crew/v1/copia` y `POST /api/crew/v1/copia/restaurar` (sesión o clave de
 *   administración; nunca con una clave de conexión).
 * - `GET|PUT /api/actualizaciones` y `POST /api/actualizaciones/comprobar`.
 * - `GET /api/privacidad`: las conexiones salientes de la app (SU-22).
 *
 * Se monta ANTES que las rutas del protocolo: allí todo exige clave y la copia vale con sesión.
 */

const router = express.Router();

const manejar = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (r !== undefined && !res.headersSent) res.json(r);
  } catch (error) {
    errores.responder(req, res, error, logger);
  }
};

/** La sesión ya la comprobó la guardia; una clave que no sea la de administración, no. */
function adminOSesion(req, res, next) {
  if (req.clave && req.clave.tipo !== 'admin') {
    return res.status(403).json({ detail: 'Hace falta la clave de administración.' });
  }
  return next();
}

router.get(
  '/salud',
  manejar(async (req, res) => {
    const r = await diagnostico.salud();
    res.set('Cache-Control', 'no-store');
    // 503 si no puede trabajar: el lanzador y el healthcheck de Docker lo ven sin leer el cuerpo.
    res.status(r.ok ? 200 : 503).json(r);
  })
);

router.get(
  '/diagnostico',
  manejar(req => diagnostico.diagnostico({ idioma: errores.idiomaDe(req) }))
);

router.get(
  '/diagnostico/registro',
  manejar(req => {
    const lineas = Math.max(1, Math.min(Number.parseInt(req.query.lineas, 10) || 200, 2000));
    return { lineas: registro.ultimas(lineas) };
  })
);

router.get(
  '/diagnostico/informe',
  manejar(async (req, res) => {
    const buf = await diagnostico.informe({ idioma: errores.idiomaDe(req) });
    const fecha = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="clipscout-informe-${fecha}.zip"`);
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  })
);

/* ── Copia de la suite (SU-20) ──────────────────────────────────────── */

router.get(
  '/crew/v1/copia',
  adminOSesion,
  manejar(async (req, res) => {
    const { zip } = await copia.crear({ miniaturas: req.query.miniaturas === '1' });
    const fecha = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="clipscout-copia-${fecha}.zip"`);
    res.set('Cache-Control', 'no-store');
    res.send(zip);
  })
);

router.post(
  '/crew/v1/copia/restaurar',
  adminOSesion,
  express.raw({ type: () => true, limit: '100mb' }),
  manejar(req => copia.restaurar(req.body))
);

/* ── Actualizaciones (SU-13) ────────────────────────────────────────── */

router.get(
  '/actualizaciones',
  manejar(() => actualizaciones.estado())
);

router.put(
  '/actualizaciones',
  manejar(req => actualizaciones.cambiarActivo(req.body?.activo !== false))
);

/** Ajustes → Sistema → Acerca de → «Qué sale de este equipo» (SU-22). */
router.get(
  '/privacidad',
  manejar(() => actualizaciones.salientes())
);

router.post(
  '/actualizaciones/comprobar',
  manejar(() => actualizaciones.comprobar({ forzar: true }))
);

module.exports = router;
