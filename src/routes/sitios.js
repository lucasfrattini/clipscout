'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { configurarSitio, portadaDe } = require('../services/autoSitio');
const { readProfiles, writeProfiles } = require('../services/profiles');
const { hostDe } = require('../services/web');
const directo = require('../services/directo');

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
    await marcarFichaComoFichero(nuevos);
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

const FORMATO_EXPORTADO = 'clipscout-sitios';

/** La opción «pasar la página a JDownloader» va por dominio (el Explorador reescribe el perfil). */
async function marcarFichaComoFichero(sitios) {
  for (const s of sitios) {
    const host = hostDe(s?.config?.searchUrl || '');
    if (host && s.config.fichaComoFichero === true) {
      await directo.guardarOpcionesSitio(host, { fichaComoFichero: true });
    }
  }
}

/**
 * GET /api/sitios/exportar — la configuración de TODOS los sitios en un fichero, para pasársela a
 * otra persona o a otro equipo: cada sitio con su configuración y sus opciones (JDownloader
 * directo, fuera por defecto). Sin claves, sin estadísticas, sin búsquedas.
 */
router.get('/sitios/exportar', async (req, res, next) => {
  try {
    const perfiles = await readProfiles();
    const opciones = await directo.opcionesSitios();
    const sitios = perfiles.map(p => {
      const host = hostDe(p.config.searchUrl || '');
      const o = opciones[host] || {};
      return {
        nombre: p.name,
        ...(p.note ? { nota: p.note } : {}),
        config: p.config,
        opciones: {
          jdDirecto: o.jdDirecto === true,
          fueraPorDefecto: o.fueraPorDefecto === true,
          fichaComoFichero: o.fichaComoFichero === true || p.config.fichaComoFichero === true,
        },
      };
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="clipscout-sitios-${fecha}.json"`);
    res.json({
      formato: FORMATO_EXPORTADO,
      version: 1,
      exportado: new Date().toISOString(),
      sitios,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sitios/importar { formato, sitios: [{ nombre, config, opciones }] } — suma los sitios de
 * un fichero exportado. Los de un dominio que ya está se saltan (no se pisa lo propio), salvo con
 * `?reemplazar=1`, que cambia su configuración conservando nombre y posición.
 */
router.post('/sitios/importar', async (req, res, next) => {
  try {
    const cuerpo = req.body || {};
    if (cuerpo.formato !== FORMATO_EXPORTADO || !Array.isArray(cuerpo.sitios)) {
      throw new AppError(
        'Ese fichero no es una configuración de sitios de clipscout.',
        400,
        'FORMATO_SITIOS'
      );
    }
    const reemplazar = req.query.reemplazar === '1';
    const perfiles = await readProfiles();
    const porHost = new Map(perfiles.map((p, i) => [hostDe(p.config.searchUrl || ''), i]));
    let anadidos = 0;
    let actualizados = 0;
    let saltados = 0;
    const opcionesNuevas = [];
    for (const s of cuerpo.sitios.slice(0, 500)) {
      const host = hostDe(s?.config?.searchUrl || '');
      if (!host) {
        saltados += 1;
        continue;
      }
      const perfil = {
        name: String(s.nombre || host),
        ...(s.nota ? { note: String(s.nota) } : {}),
        config: s.config,
      };
      if (porHost.has(host)) {
        if (!reemplazar) {
          saltados += 1;
          continue;
        }
        const i = porHost.get(host);
        perfiles[i] = { ...perfiles[i], config: s.config };
        actualizados += 1;
      } else {
        porHost.set(host, perfiles.length);
        perfiles.push(perfil);
        anadidos += 1;
      }
      if (s.opciones && typeof s.opciones === 'object') opcionesNuevas.push([host, s.opciones]);
    }
    const guardados = await writeProfiles(perfiles);
    for (const [host, o] of opcionesNuevas) {
      await directo.guardarOpcionesSitio(host, {
        jdDirecto: o.jdDirecto === true,
        fueraPorDefecto: o.fueraPorDefecto === true,
        fichaComoFichero: o.fichaComoFichero === true,
      });
    }
    logger.info('Sitios importados', { anadidos, actualizados, saltados });
    res.json({ success: true, anadidos, actualizados, saltados, total: guardados.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sitios/reconfigurar { sitios: [{ config }] } — «Reconfigurar» (Ajustes → Sitios → ⋯):
 * cambia la configuración del sitio guardado de ese mismo dominio por la nueva (la que acaba de
 * dar el alta automática, ya probada). Conserva el nombre y la POSICIÓN en la lista: las búsquedas
 * guardadas y la cola apuntan a los sitios por su posición. Un dominio sin sitio guardado se cuenta
 * en `sinSitio` y no se añade (para eso está el alta).
 */
router.post('/sitios/reconfigurar', async (req, res, next) => {
  try {
    const nuevos = Array.isArray(req.body?.sitios) ? req.body.sitios : [];
    if (nuevos.length === 0) throw new AppError('No hay sitios para guardar.', 400, 'SIN_SITIOS');
    const perfiles = await readProfiles();
    let cambiados = 0;
    let sinSitio = 0;
    for (const s of nuevos) {
      const host = hostDe(s?.config?.searchUrl || '');
      const i = host ? perfiles.findIndex(p => hostDe(p.config.searchUrl || '') === host) : -1;
      if (i < 0 || !s.config || typeof s.config !== 'object') {
        sinSitio += 1;
        continue;
      }
      perfiles[i] = { ...perfiles[i], config: s.config };
      cambiados += 1;
    }
    if (cambiados > 0) await writeProfiles(perfiles);
    await marcarFichaComoFichero(nuevos);
    logger.info('Sitios reconfigurados', { cambiados, sinSitio });
    res.json({ success: true, cambiados, sinSitio });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
