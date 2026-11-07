'use strict';

const crypto = require('node:crypto');
const express = require('express');

const crew = require('../services/crew');

/**
 * Rutas de clip crew.
 *
 * - `/api/crew/v1/...`: protocolo entre apps, con la clave de ESTA app en
 *   `X-Api-Key`. Lo usan clonbuster y clipkeeper.
 * - `/api/ajustes/...`: la pestaña Ajustes de la interfaz (identidad, clave
 *   de API y conexiones).
 *
 * Los errores se devuelven como `{detail: "mensaje"}`, el formato común del
 * protocolo, para que las otras apps puedan mostrar el motivo.
 */

const router = express.Router();

/** Envuelve un manejador async y traduce los errores al formato del protocolo. */
const manejar = fn => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (error) {
    if (error instanceof crew.ErrorCrew) {
      return res.status(error.status).json({ detail: error.message });
    }
    res.status(500).json({ detail: 'Error interno.' });
  }
};

async function requiereClave(req, res, next) {
  const { api_key: propia } = await crew.datos();
  if (!crew.claveValida(req.get('X-Api-Key'), propia)) {
    return res
      .status(401)
      .json({ detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).' });
  }
  return next();
}

/* ── Protocolo (entre apps) ─────────────────────────────────────────── */

const protocolo = express.Router();
protocolo.use(requiereClave);
protocolo.get(
  '/status',
  manejar(req => crew.estadoPropio(req))
);
protocolo.get(
  '/conexiones',
  manejar(() => crew.listar())
);
protocolo.post(
  '/conexiones',
  manejar(req => crew.guardarConexion(req.body || {}))
);
protocolo.delete(
  '/conexiones/:id',
  manejar(async req => {
    await crew.quitar(req.params.id);
    return { ok: true };
  })
);
router.use('/crew/v1', protocolo);

/* ── Administración (pestaña Ajustes) ───────────────────────────────── */

router.get(
  '/ajustes/general',
  manejar(async req => {
    const d = await crew.datos();
    return {
      app: crew.APP,
      version: require('../../package.json').version,
      instancia: d.instancia || '',
      url: d.url || '',
      url_detectada: crew.urlDetectada(req),
      api_key: d.api_key,
    };
  })
);

router.put(
  '/ajustes/general',
  manejar(async req => {
    const { instancia = '', url = '' } = req.body || {};
    const limpia = String(url).trim() ? crew.normalizarUrl(url) : '';
    await crew.cambiar(d => {
      d.instancia = String(instancia).trim().slice(0, 120);
      d.url = limpia;
    });
    return { ok: true };
  })
);

router.post(
  '/ajustes/api-key',
  manejar(async () => {
    const clave = crypto.randomBytes(16).toString('hex');
    await crew.cambiar(d => {
      d.api_key = clave;
    });
    return { api_key: clave };
  })
);

router.get(
  '/ajustes/conexiones',
  manejar(() => crew.listar())
);

router.post(
  '/ajustes/conexiones/probar',
  manejar(req => {
    const { app, url, api_key: clave } = req.body || {};
    crew.validarApp(app);
    return crew.probar(app, url, clave);
  })
);

router.post(
  '/ajustes/conexiones',
  manejar(async req => {
    const { app, url, api_key: clave, nombre = '', reciproca = true } = req.body || {};
    crew.validarApp(app);
    const prueba = await crew.probar(app, url, clave);
    if (!prueba.ok) throw new crew.ErrorCrew(prueba.error);
    const { id } = await crew.guardarConexion({
      app,
      url,
      api_key: clave,
      nombre: String(nombre).trim() || prueba.instancia || app,
    });
    const vuelta = reciproca
      ? await crew.registrarseEn(req, crew.normalizarUrl(url), String(clave).trim())
      : null;
    return { id, prueba, reciproca: vuelta };
  })
);

router.post(
  '/ajustes/ya-lo-tengo',
  manejar(req => {
    const { titulos = [], duraciones = [] } = req.body || {};
    if (!Array.isArray(titulos) || titulos.length > 200) {
      throw new crew.ErrorCrew('Se esperaba una lista de hasta 200 títulos.');
    }
    return crew.buscarEnClipkeeper(
      titulos.map(x => String(x).slice(0, 300)),
      Array.isArray(duraciones) ? duraciones.slice(0, 200) : []
    );
  })
);

router.get(
  '/ajustes/conexiones/:id/estado',
  manejar(async req => {
    const { conexiones = [] } = await crew.datos();
    const c = conexiones.find(x => x.id === Number(req.params.id));
    if (!c) throw new crew.ErrorCrew('No existe esa conexión.', 404);
    return crew.probar(c.app, c.url, c.api_key);
  })
);

router.delete(
  '/ajustes/conexiones/:id',
  manejar(async req => {
    await crew.quitar(req.params.id);
    return { ok: true };
  })
);

module.exports = router;
