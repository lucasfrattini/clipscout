'use strict';

const express = require('express');

const errores = require('../lib/errores');
const logger = require('../lib/logger');
const { firmarDatos } = require('../lib/firmaProxy');
const { readProfiles, writeProfiles } = require('../services/profiles');
const fotos = require('../services/fotos');
const personas = require('../services/personas');
const seguir = require('../services/seguir');
const mejorar = require('../services/mejorar');
const { reenviar } = require('../services/reenviar');
const { recuento } = require('../services/recuento');

/**
 * Fase 7: fotos por persona y completar por persona.
 *
 * - Protocolo (`/api/crew/v1/…`, con la clave de clipscout; clipkeeper con su clave de conexión):
 *   seguir (C4), mejorar calidad (C5), volver a descargar (C6) y recuento (C7). Ver docs/CREW.md.
 * - Interfaz (sesión): personas de clipkeeper, la pestaña Fotos de Buscar y la pantalla «Seguidas».
 */

const router = express.Router();

/** Un manejador async: lo que lanza con `status` < 500 se responde con su frase (SU-10). */
const manejar =
  (fn, codigo = 200) =>
  async (req, res) => {
    try {
      const r = await fn(req, res);
      if (!res.headersSent) res.status(codigo).json(r);
    } catch (error) {
      errores.responder(req, res, error, logger);
    }
  };

function requiereClave(req, res, next) {
  if (!req.clave) {
    return res.status(401).json({
      codigo: 'clave_invalida',
      detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).',
    });
  }
  return next();
}

/* ── Protocolo (C4–C7) ──────────────────────────────────────────────── */

const protocolo = express.Router();
protocolo.use(requiereClave);

// C4 · Seguir a una persona
protocolo.post(
  '/seguir',
  manejar(async req => ({ id: (await seguir.seguir(req.body || {})).id }), 201)
);
protocolo.get(
  '/seguir',
  manejar(() => seguir.listar())
);
protocolo.delete(
  '/seguir/:id',
  manejar(req => seguir.quitar(req.params.id))
);

// C5 · Mejorar calidad
protocolo.post(
  '/mejorar',
  manejar(req => mejorar.iniciar(req.body || {}), 202)
);
protocolo.get(
  '/mejorar/:trabajo',
  manejar(req => mejorar.estado(req.params.trabajo))
);
protocolo.post(
  '/mejorar/:trabajo/enviar',
  manejar(req => mejorar.enviar(req.params.trabajo, req.body || {}))
);

// C6 · Volver a descargar
protocolo.post(
  '/reenviar',
  manejar(req => reenviar(req.body || {}))
);

// C7 · Recuento por término
protocolo.get(
  '/recuento',
  manejar(req => recuento(req.query.termino))
);

router.use('/crew/v1', protocolo);

/* ── Interfaz ───────────────────────────────────────────────────────── */

/** Personas de clipkeeper (C1) para «Mandar a una persona» y la carpeta propuesta. */
router.get(
  '/ajustes/personas',
  manejar(req => personas.listar({ q: req.query.q, fresca: req.query.fresca === '1' }))
);

/** FO-1/FO-4: ¿hay dónde buscar fotos? (sitios con plantilla de álbumes o búsqueda web). */
router.get(
  '/fotos/disponible',
  manejar(async () => ({
    sitios: (await fotos.sitiosConAlbumes()).map(s => ({ id: s.id, nombre: s.nombre })),
    web: Boolean(require('../config').busqueda.searxngUrl),
  }))
);

/** FO-1: álbumes de lo buscado, con «¿ya lo tengo?» (FO-5). Portadas firmadas. */
router.get(
  '/fotos/buscar',
  manejar(async req => {
    const q = String(req.query.q || '').trim();
    const { alias } = await personas.aliasDe(q).catch(() => ({ alias: [] }));
    const r = await fotos.buscarAlbumes(q, { web: req.query.web !== '0', alias });
    const tengo = await fotos.yaLoTengo(r.albumes).catch(() => []);
    r.albumes = r.albumes.map((a, i) => ({ ...a, tengo: tengo[i] || null }));
    return firmarDatos(r);
  })
);

/** FO-5 a mano: `{albumes: [{url, n_fotos}]}` → estado de cada uno. */
router.post(
  '/fotos/tengo',
  manejar(async req => ({
    albumes: await fotos.yaLoTengo(
      Array.isArray(req.body?.albumes) ? req.body.albumes.slice(0, 200) : []
    ),
  }))
);

/** FO-2: las fotos de un álbum (para verlas antes de mandar). */
router.get(
  '/fotos/album',
  manejar(async req => {
    const url = String(req.query.url || '');
    if (!/^https?:\/\//i.test(url)) {
      const error = new Error('Falta la dirección del álbum.');
      error.status = 400;
      throw error;
    }
    const r = await fotos.extraerAlbum(url);
    return firmarDatos({ ...r, fotos: r.fotos.map(f => ({ thumbnail: f })) });
  })
);

/** FO-3: «Mandar a una persona» → `{trabajo}`; el progreso en GET …/:id. */
router.post(
  '/fotos/mandar',
  manejar(req => fotos.mandar(req.body || {}), 202)
);
router.get(
  '/fotos/mandar/:id',
  manejar(req => fotos.estado(req.params.id))
);

/** «Seguidas» (C4 desde la interfaz). */
router.get(
  '/seguidas',
  manejar(() => seguir.listar())
);
router.post(
  '/seguidas',
  manejar(req => seguir.seguir(req.body || {}), 201)
);
router.delete(
  '/seguidas/:id',
  manejar(req => seguir.quitar(req.params.id))
);

/**
 * FO-1: plantilla de álbumes de un sitio (Ajustes → Sitios → «⋯»). `id` es su posición (CS-07):
 * se comprueba que sigue siendo el mismo dominio antes de tocarlo.
 */
router.put(
  '/ajustes/sitios-albumes/:id',
  manejar(async req => {
    const id = Number(req.params.id);
    const { dominio = '', albumSearchUrl = '', albumLinkPattern = '' } = req.body || {};
    const perfiles = await readProfiles();
    const perfil = perfiles[id];
    if (!perfil || (dominio && !String(perfil.config.searchUrl || '').includes(dominio))) {
      const error = new Error('Ese sitio ya no existe o cambió: vuelve a abrir Ajustes.');
      error.status = 409;
      throw error;
    }
    const plantilla = String(albumSearchUrl).trim();
    if (plantilla && !/^https?:\/\/.+\{(?:q|query|termino|término)(?::slug)?\}/i.test(plantilla)) {
      const error = new Error('La plantilla de álbumes tiene que ser una dirección con {q}.');
      error.status = 400;
      throw error;
    }
    if (String(albumLinkPattern).trim()) {
      require('../lib/pattern').createLinkMatcher(String(albumLinkPattern)); // lanza si no vale
    }
    const config = { ...perfil.config };
    if (plantilla) config.albumSearchUrl = plantilla;
    else delete config.albumSearchUrl;
    if (String(albumLinkPattern).trim()) config.albumLinkPattern = String(albumLinkPattern).trim();
    else delete config.albumLinkPattern;
    perfiles[id] = { ...perfil, config };
    await writeProfiles(perfiles);
    return {
      ok: true,
      albumSearchUrl: config.albumSearchUrl || '',
      albumLinkPattern: config.albumLinkPattern || '',
    };
  })
);

module.exports = router;
