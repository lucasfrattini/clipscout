'use strict';

const crypto = require('node:crypto');
const express = require('express');

const crew = require('../services/crew');
const config = require('../config');
const jd = require('../services/jdownloader');
const { buscarEnTodos } = require('../services/busqueda');
const proxySalida = require('../services/proxySalida');
const ajustesBusqueda = require('../services/ajustesBusqueda');
const programadas = require('../services/programadas');
const filtrosGlobales = require('../services/filtrosGlobales');
const directo = require('../services/directo');
const paquetesJd = require('../services/paquetesJd');
const estadisticas = require('../services/estadisticas');
const respaldos = require('../services/respaldos');
const { listarSitios } = require('../services/busqueda');
const { hostDe } = require('../services/web');
const sesiones = require('../services/sesiones');
const errores = require('../lib/errores');
const logger = require('../lib/logger');

/**
 * Rutas de Clipgeist.
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
    // Formato común (SU-10): `{codigo, detail, params}` (lo completa lib/errores). Lo no previsto,
    // `error_interno` con identificador en la respuesta y en el registro.
    if (error instanceof crew.ErrorCrew) return errores.responder(req, res, error, logger);
    return errores.responder(
      req,
      res,
      { status: 500, message: error?.message, stack: error?.stack },
      logger
    );
  }
};

/**
 * La clave ya la comprobó middleware/acceso.js (`req.clave`): la de administración abre todo; una
 * de conexión solo llega aquí para las rutas de su lista de permisos.
 */
function requiereClave(req, res, next) {
  if (!req.clave) {
    return res.status(401).json({
      codigo: 'clave_invalida',
      detail: 'Clave de API incorrecta o ausente (cabecera X-Api-Key).',
    });
  }
  return next();
}

function soloAdmin(req, res, next) {
  if (req.clave?.tipo !== 'admin') {
    return res.status(403).json({ detail: 'Hace falta la clave de administración.' });
  }
  return next();
}

const quien = req => ({
  admin: req.clave?.tipo === 'admin',
  conexion: req.clave?.conexion || null,
});

/* ── Protocolo (entre apps) ─────────────────────────────────────────── */

const protocolo = express.Router();
/**
 * Sin clave (público, como en las otras dos apps): solo `crew`, `protocolo`, `app` y `version`.
 * Con una clave válida, además la instancia y la URL.
 */
protocolo.get(
  '/status',
  manejar(async req => {
    const estado = await crew.estadoPropio(req);
    if (req.clave) return estado;
    const { crew: nombre, protocolo: version, app, version: v } = estado;
    return { crew: nombre, protocolo: version, app, version: v };
  })
);
protocolo.use(requiereClave);
protocolo.get(
  '/conexiones',
  soloAdmin,
  manejar(() => crew.listar())
);
/** Alta (o «vuelta») de otra app. Responde con `clave`: la de conexión para llamarnos. */
protocolo.post(
  '/conexiones',
  manejar(req => crew.registrarConexion(req.body || {}, quien(req)))
);
/** Pasar de la clave de administración a claves de conexión (migración de 2.18). */
protocolo.post(
  '/conexiones/renovar',
  manejar(req => crew.renovarConexion(req.body || {}, quien(req)))
);
protocolo.delete(
  '/conexiones/:id',
  soloAdmin,
  manejar(async req => {
    await crew.quitar(req.params.id);
    return { ok: true };
  })
);
/** ¿Vale este testigo de sesión de clipscout? Lo preguntan las otras apps (inicio único). */
protocolo.post(
  '/sesion/validar',
  manejar(async req => {
    const { testigo = '' } = req.body || {};
    const s = await sesiones.validar(String(testigo));
    if (!s) return { ok: false };
    return { ok: true, usuario: s.usuario, caduca: s.caduca };
  })
);
/** «Salir» en otra app con un testigo nuestro: se borra aquí. */
protocolo.post(
  '/sesion/cerrar',
  manejar(async req => {
    const { testigo = '' } = req.body || {};
    await sesiones.cerrar({ testigo: String(testigo) });
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
      clave_del_entorno: Boolean(d.claveDelEntorno),
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
    if (crew.claveEntorno()) {
      throw new crew.ErrorCrew(
        'La clave viene del entorno (CLIPGEIST_CLAVE): se cambia allí, en las tres apps a la vez.',
        409
      );
    }
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
    // Se guarda con la clave que ha pegado el usuario (la de administración de la otra) y, al
    // registrarnos allí, se cambia por la de conexión que nos dé: la de administración se olvida.
    const { id } = await crew.guardarConexion({
      app,
      url,
      api_key: clave,
      nombre: String(nombre).trim() || prueba.instancia || app,
    });
    const vuelta = reciproca
      ? await crew.registrarseEn(req, crew.normalizarUrl(url), String(clave).trim(), {
          conexionId: id,
        })
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

/* ── Proxy de salida: ¿responde? ─────────────────────────────────────── */

/** El último estado conocido (sin probar): lo usan Buscar y Ajustes para avisar. */
router.get(
  '/ajustes/proxy',
  manejar(() => proxySalida.leer())
);

/** CS-N11: el proxy desde Ajustes (`url: ''` sin proxy, `null` volver al del entorno). */
router.put(
  '/ajustes/proxy',
  manejar(req => proxySalida.guardar(req.body || {}))
);

/**
 * Prueba ya (Ajustes → Sistema → «Probar»): el túnel y, si responde (o sin proxy), la dirección
 * con la que se sale a internet.
 */
router.post(
  '/ajustes/proxy/probar',
  manejar(async () => {
    const r = await proxySalida.probar();
    if (r.configurado && r.ok === false) return r;
    return { ...r, salida: await proxySalida.direccionSalida() };
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
    const salud = await estadisticas.leerSalud();
    return {
      sitios: sitios.map(s => {
        const dominio = hostDe(s.perfil.config.searchUrl || '');
        return {
          id: s.id,
          nombre: s.nombre,
          dominio,
          jdDirecto: directo.esDirecto(`https://${dominio}/`, opciones),
          // FO-1: plantilla de álbumes (opcional) de su configuración.
          albumSearchUrl: s.perfil.config.albumSearchUrl || '',
          albumLinkPattern: s.perfil.config.albumLinkPattern || '',
          fueraPorDefecto: directo.fueraPorDefecto(dominio, opciones),
          fichaComoFichero:
            opciones[dominio]?.fichaComoFichero === true ||
            s.perfil.config.fichaComoFichero === true,
          personasFicha: opciones[dominio]?.personasFicha === true,
          selectorPersonas: opciones[dominio]?.selectorPersonas || '',
          estadisticas: cifras[dominio] || null,
          salud: salud[dominio] || null,
        };
      }),
    };
  })
);

router.delete(
  '/ajustes/sitios/estadisticas',
  manejar(async req => {
    const dominio =
      typeof req.query.dominio === 'string' ? req.query.dominio.trim().toLowerCase() : '';
    await estadisticas.ponerACero(dominio || null);
    return { ok: true };
  })
);

router.put(
  '/ajustes/sitios/:dominio',
  manejar(req => directo.guardarOpcionesSitio(req.params.dominio, req.body || {}))
);

/* ── JDownloader (API local) ────────────────────────────────────────── */

/** Ajustes de calidad de los plugins de JDownloader para los sitios guardados (o `?dominios=`). */
router.get(
  '/ajustes/jdownloader/calidad',
  manejar(async req => {
    const pedidos = String(req.query.dominios || '')
      .split(',')
      .map(d => d.trim())
      .filter(Boolean);
    const dominios = pedidos.length
      ? pedidos
      : [
          ...new Set((await listarSitios()).map(s => hostDe(s.perfil.config.searchUrl || ''))),
        ].filter(Boolean);
    return { sitios: await require('../services/jdownloader').ajustesCalidad(dominios) };
  })
);
/** Cambia un ajuste de calidad de un plugin de JDownloader. */
router.put(
  '/ajustes/jdownloader/calidad',
  manejar(req => require('../services/jdownloader').guardarAjusteCalidad(req.body || {}))
);

/** Asistente, paso «Úsalo desde el móvil»: direcciones de esta app en la red local. */
router.get(
  '/asistente/red',
  manejar(req => require('../services/asistente').direcciones(req))
);
/** Escritorio: «Permitir acceso desde otros dispositivos» (escuchar.txt; vale al reiniciar). */
router.put(
  '/asistente/red',
  manejar(req => require('../services/asistente').cambiarRed(Boolean(req.body?.red)))
);

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

/**
 * ¿Cuáles de estas fichas se mandaron ya a JDownloader, y cuándo? (CS-N7: Buscar las oculta por
 * defecto y las saca de «Descargar todo»). Solo lee lo apuntado en los paquetes.
 */
router.post(
  '/ajustes/jdownloader/enviados',
  manejar(async req => {
    const enlaces = Array.isArray(req.body?.enlaces) ? req.body.enlaces.slice(0, 500) : [];
    return { enviados: paquetesJd.enviadosDe(await paquetesJd.listar(), enlaces.map(String)) };
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

/* ── Copias de seguridad de data/ ───────────────────────────────────── */

router.get(
  '/ajustes/respaldos',
  manejar(async () => ({ copias: await respaldos.listar(), dias: config.respaldos.dias }))
);

/** Hacer la copia de hoy ya (rehace la de hoy si existía). */
router.post(
  '/ajustes/respaldos',
  manejar(() => respaldos.asegurarDiario({ forzar: true }))
);

/** Descargar una copia: un solo JSON con todos sus ficheros. */
router.get(
  '/ajustes/respaldos/:id/descargar',
  manejar(async (req, res) => {
    const p = await respaldos.paquete(req.params.id);
    res.set('Content-Disposition', `attachment; filename="clipscout-respaldo-${p.id}.json"`);
    res.set('Cache-Control', 'no-store');
    return p;
  })
);

router.post(
  '/ajustes/respaldos/:id/restaurar',
  manejar(req => respaldos.restaurar(req.params.id))
);

/* ── Avisos (CS-N5) ─────────────────────────────────────────────────── */

/** GET /api/avisos?desde=N — los avisos después del N (más nuevos primero) y los sin leer. */
router.get(
  '/avisos',
  manejar(req => require('../services/avisos').listar({ desde: Number(req.query.desde) || 0 }))
);
/** POST /api/avisos/leidos {hasta?} — marca como leído (todo, o hasta ese número). */
router.post(
  '/avisos/leidos',
  manejar(req => require('../services/avisos').marcarLeidos(req.body?.hasta))
);

/** DELETE /api/avisos — «Limpiar»: los borra todos. */
router.delete(
  '/avisos',
  manejar(() => require('../services/avisos').vaciar())
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

/** La otra app deja de poder llamarnos con la clave de conexión que le dimos. */
router.post(
  '/ajustes/conexiones/:id/revocar',
  manejar(req => crew.revocarEntrada(req.params.id))
);

router.delete(
  '/ajustes/conexiones/:id',
  manejar(async req => {
    await crew.quitar(req.params.id);
    return { ok: true };
  })
);

module.exports = router;
