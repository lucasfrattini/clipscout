'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { configurarSitio, portadaDe } = require('../services/autoSitio');
const { readProfiles, writeProfiles } = require('../services/profiles');
const { hostDe } = require('../services/web');

const router = express.Router();

/** Los dominios que ya tienen una configuración guardada (para no darlos de alta dos veces). */
async function dominiosGuardados() {
  const perfiles = await readProfiles();
  return new Set(perfiles.map(p => hostDe(p.config.searchUrl || '')).filter(Boolean));
}

/**
 * POST /api/sitios/auto { url, termino } — configura y PRUEBA un sitio a partir de su dirección.
 * No guarda nada: devuelve la configuración y el resultado de la búsqueda de prueba.
 */
router.post('/sitios/auto', async (req, res, next) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const tope = setTimeout(() => controller.abort(), config.autoSitio.maxMs);
  try {
    const { url, termino } = req.body || {};
    const host = new URL(portadaDe(url)).hostname.replace(/^www\./, '');
    const yaGuardado = (await dominiosGuardados()).has(host);
    const r = await configurarSitio({ url, termino }, { signal: controller.signal });
    if (controller.signal.aborted && !r.ok) r.motivo = 'tiempo';
    res.json({ ...r, yaGuardado });
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof AppError)) {
      res.json({ ok: false, motivo: 'tiempo', nombre: String(req.body?.url || '') });
      return;
    }
    next(error);
  } finally {
    clearTimeout(tope);
  }
});

/**
 * POST /api/sitios { sitios: [{ nombre, config }] } — suma configuraciones a las guardadas. Las de
 * un dominio que ya estaba no se duplican: se saltan y se cuentan.
 */
router.post('/sitios', async (req, res, next) => {
  try {
    const nuevos = Array.isArray(req.body?.sitios) ? req.body.sitios : [];
    if (nuevos.length === 0) throw new AppError('No hay sitios para guardar.', 400, 'SIN_SITIOS');
    const perfiles = await readProfiles();
    const ya = await dominiosGuardados();
    let saltados = 0;
    for (const s of nuevos) {
      const host = hostDe(s?.config?.searchUrl || '');
      if (!host || ya.has(host)) {
        saltados += 1;
        continue;
      }
      ya.add(host);
      perfiles.push({ name: String(s.nombre || host), config: s.config });
    }
    const guardados = await writeProfiles(perfiles);
    logger.info('Sitios dados de alta', { nuevos: nuevos.length - saltados, saltados });
    res.json({
      success: true,
      guardados: nuevos.length - saltados,
      saltados,
      total: guardados.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
