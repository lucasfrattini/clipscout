'use strict';

const crypto = require('node:crypto');
const express = require('express');

const crew = require('../services/crew');
const config = require('../config');
const jd = require('../services/jdownloader');
const { buscarEnTodos } = require('../services/busqueda');
const ajustesBusqueda = require('../services/ajustesBusqueda');
const programadas = require('../services/programadas');
const filtrosGlobales = require('../services/filtrosGlobales');
const directo = require('../services/directo');
const paquetesJd = require('../services/paquetesJd');
const estadisticas = require('../services/estadisticas');
const { listarSitios } = require('../services/busqueda');
const { hostDe } = require('../services/web');

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

/** Búsquedas cuyo «ya lo tenías» ya se contó (volver a mirarlas no suma otra vez). */
const contadas = new Set();

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
/**
 * Imágenes para clipkeeper (fotos de personas, portadas de categorías): una búsqueda rápida en los
 * sitios guardados (1 página, pocas fichas por sitio) y se devuelven las miniaturas de los vídeos.
 * Es el contenido real de esos sitios: sin el filtro que aplican los buscadores generales.
 */
protocolo.get(
  '/imagenes',
  manejar(async req => {
    const q = String(req.query.q || '').trim();
    if (!q) throw new crew.ErrorCrew('Falta qué buscar.');
    const controller = new AbortController();
    const tope = setTimeout(() => controller.abort(), config.busqueda.imagenesMs);
    tope.unref?.();
    const fotos = new Map();
    try {
      await buscarEnTodos(
        { q, paginas: 1, web: false, enlaces: config.busqueda.imagenesPorSitio },
        {
          // Una búsqueda de fotos para clipkeeper no cuenta en el rendimiento de los sitios.
          contar: false,
          signal: controller.signal,
          emit: ev => {
            if (ev.type !== 'resultados') return;
            for (const it of ev.items) {
              if (it.thumbnail && !fotos.has(it.thumbnail)) {
                fotos.set(it.thumbnail, {
                  imagen: it.thumbnail,
                  pagina: it.sourceUrl || it.url,
                  titulo: it.title || '',
                });
              }
            }
          },
        }
      );
    } finally {
      clearTimeout(tope);
    }
    return { fotos: [...fotos.values()] };
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
  manejar(async req => {
    const {
      titulos = [],
      duraciones = [],
      persona = '',
      enlaces = [],
      contar = false,
    } = req.body || {};
    if (!Array.isArray(titulos) || titulos.length > 200) {
      throw new crew.ErrorCrew('Se esperaba una lista de hasta 200 títulos.');
    }
    const r = await crew.buscarEnClipkeeper(
      titulos.map(x => String(x).slice(0, 300)),
      Array.isArray(duraciones) ? duraciones.slice(0, 200) : [],
      String(persona || '').slice(0, 200)
    );
    // «Ya lo tenías», por sitio. Solo cuando la pantalla lo pide con el id de la búsqueda, y una
    // vez por búsqueda: si no, cada pulsación del botón o cada vez que se vuelve a mirar sumaría.
    if (typeof contar === 'string' && contar && !contadas.has(contar) && Array.isArray(enlaces)) {
      contadas.add(contar);
      if (contadas.size > 500) contadas.delete(contadas.values().next().value);
      (r.resultados || []).forEach((res, i) => {
        if (res?.coincidencias?.length && typeof enlaces[i] === 'string') {
          estadisticas.sumarEnlace(enlaces[i], { yaLoTenias: 1 });
        }
      });
    }
    return r;
  })
);

/* ── Búsqueda web y red (SearXNG, buscadores, sitios sin VPN) ─────────── */

router.get(
  '/ajustes/busqueda',
  manejar(() => ajustesBusqueda.leer())
);

router.put(
  '/ajustes/busqueda',
  manejar(req => ajustesBusqueda.guardar(req.body || {}))
);

router.post(
  '/ajustes/busqueda/probar',
  manejar(async req => {
    const b = req.body || {};
    const actual = await ajustesBusqueda.leer();
    return ajustesBusqueda.probar(b.searxngUrl || actual.searxngUrl, b.motores ?? actual.motores);
  })
);

/* ── Filtros globales (palabras siempre bloqueadas) ─────────────────── */

router.get(
  '/ajustes/filtros',
  manejar(async () => {
    await filtrosGlobales.cargar();
    return filtrosGlobales.leer();
  })
);

router.put(
  '/ajustes/filtros',
  manejar(req => filtrosGlobales.guardar(req.body || {}))
);

/* ── Sitios: opciones por dominio ───────────────────────────────────── */

/** Los sitios guardados con sus opciones (p. ej. «mandar el fichero directo» a JDownloader). */
router.get(
  '/ajustes/sitios',
  manejar(async () => {
    const opciones = await directo.opcionesSitios();
    const sitios = await listarSitios();
    const cifras = await estadisticas.leer();
    return {
      sitios: sitios.map(s => {
        const dominio = hostDe(s.perfil.config.searchUrl || '');
        return {
          id: s.id,
          nombre: s.nombre,
          dominio,
          jdDirecto: directo.esDirecto(`https://${dominio}/`, opciones),
          estadisticas: cifras[dominio] || null,
        };
      }),
    };
  })
);

router.delete(
  '/ajustes/sitios/estadisticas',
  manejar(async () => {
    await estadisticas.ponerACero();
    return { ok: true };
  })
);

router.put(
  '/ajustes/sitios/:dominio',
  manejar(req => directo.guardarOpcionesSitio(req.params.dominio, req.body || {}))
);

/* ── JDownloader (API local) ────────────────────────────────────────── */

router.get(
  '/ajustes/jdownloader',
  manejar(() => jd.ajustes())
);

router.put(
  '/ajustes/jdownloader',
  manejar(async req => {
    const { url = '', autostart = true, biblioteca = null } = req.body || {};
    if (String(url).trim()) {
      const prueba = await jd.probar(url);
      if (!prueba.ok) throw new crew.ErrorCrew(prueba.error);
    }
    return jd.guardar({ url, autostart, biblioteca });
  })
);

router.post(
  '/ajustes/jdownloader/probar',
  manejar(async req => jd.probar((req.body || {}).url || (await jd.ajustes()).url))
);

/** Los paquetes que mandó clipscout y su estado. `?revisar=1` pregunta antes a JDownloader. */
router.get(
  '/ajustes/jdownloader/paquetes',
  manejar(async req => {
    let error = null;
    if (req.query.revisar === '1') {
      await paquetesJd.revisar().catch(e => {
        error = e.message;
      });
    }
    const paquetes = (await paquetesJd.listar()).map(p => ({
      id: p.id,
      nombre: p.nombre,
      carpeta: p.carpeta,
      estado: p.estado,
      contadores: p.contadores,
      creado: p.creado,
      terminadoEn: p.terminadoEn || null,
      fichas: p.fichas.length,
      directos: p.sustituidas.filter(f => !p.sinDirecto.includes(f)).length,
      sinDirecto: p.sinDirecto.length,
      escaneado: p.escaneado || null,
    }));
    return { paquetes, error };
  })
);

/** Reintentar lo caído de un paquete: fichero directo fresco, aunque ya se hubiera intentado. */
router.post(
  '/ajustes/jdownloader/paquetes/:id/reintentar',
  manejar(async req => {
    const r = await paquetesJd.revisar({ soloId: req.params.id, forzar: true });
    if (r.revisados === 0) throw new crew.ErrorCrew('No existe ese paquete.', 404);
    paquetesJd.arrancar();
    return r;
  })
);

router.post(
  '/ajustes/jdownloader/vaciar-capturador',
  manejar(() => jd.vaciarCapturador())
);

router.get(
  '/ajustes/destinos',
  manejar(() => crew.destinosClipkeeper())
);

router.post(
  '/ajustes/jdownloader/enviar',
  manejar(req => jd.enviar(req.body || {}))
);

/* ── Búsquedas programadas ─────────────────────────────────────────── */

router.get(
  '/ajustes/programadas',
  manejar(() => programadas.listar())
);

router.post(
  '/ajustes/programadas',
  manejar(req => programadas.guardar(req.body || {}))
);

router.delete(
  '/ajustes/programadas/:id',
  manejar(req => programadas.quitar(req.params.id))
);

/** La lanza ya; la respuesta no espera a que acabe (se ve en Buscar como cualquier búsqueda). */
router.post(
  '/ajustes/programadas/:id/ahora',
  manejar(async req => {
    const { terminada } = await programadas.lanzar(req.params.id);
    terminada.catch(() => {});
    return { ok: true };
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
