'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { escribirJson, leerJson, ErrorIlegible } = require('../lib/ficheroJson');

/**
 * Protocolo Clipgeist v1: conexión con las otras apps de la familia.
 *
 * Referencia común: `docs/CREW.md` del repositorio de clipkeeper. clonbuster
 * y clipkeeper implementan lo mismo; si cambia el protocolo, cambia en las tres.
 *
 * Ojo con la protección SSRF: el scraping NO puede tocar direcciones privadas,
 * y eso no cambia. Las llamadas de este módulo van SOLO a las URLs que el
 * administrador dio de alta como apps de Clipgeist (normalmente en la red
 * local), y solo a sus rutas `/api/crew/v1/...`. Por eso usan su propio fetch
 * y no el cliente HTTP del scraper.
 */

const APP = 'clipscout';
const CREW = 'Clipgeist';
// Antes de llamarse Clipgeist la familia era «clip crew»: se siguen aceptando las variables
// CLIPCREW_* (si no está la CLIPGEIST_* equivalente) y el nombre antiguo en el protocolo.
const CREW_ANTIGUO = 'clip crew';
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('CLIPCREW_')) {
    const nueva = `CLIPGEIST_${k.slice('CLIPCREW_'.length)}`;
    if (process.env[nueva] === undefined) process.env[nueva] = v;
  }
}
const PROTOCOLO = 1;
const APPS = ['clipscout', 'clonbuster', 'clipkeeper'];
const { version } = require('../../package.json');

class ErrorCrew extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ── Almacén (data/crew.json) ─────────────────────────────────────────── */

let cola = Promise.resolve();

/**
 * Lee data/crew.json. Si no existe, `{}` (instalación nueva). Si está dañado, se recupera la
 * última versión buena (`crew.json.bak`, que se guarda en cada escritura) y el dañado queda
 * apartado como `crew.json.corrupto-<fecha>`. Sin copia buena LANZA (503) y no toca nada: antes
 * se asumía «vacío», la app quedaba sin contraseña y la siguiente escritura borraba contraseña,
 * conexiones, programadas y ajustes.
 */
async function leer() {
  try {
    const r = await leerJson(config.crew.path);
    if (r.recuperado) {
      logger.warn(
        `crew.json estaba dañado (${r.causa.message}): se recuperó la copia anterior ` +
          `(crew.json.bak); el dañado quedó en ${path.basename(r.apartado)}`
      );
    }
    return r.datos || {};
  } catch (error) {
    if (!(error instanceof ErrorIlegible)) throw error;
    logger.error(`crew.json ilegible y sin copia buena: la app queda cerrada (${error.message})`);
    throw new ErrorCrew(
      'No se pueden leer los ajustes (data/crew.json está dañado y no hay copia buena en ' +
        'crew.json.bak). Por seguridad la app queda cerrada: arregla el fichero o copia encima ' +
        'uno de data/respaldos/<fecha>/crew.json.',
      503
    );
  }
}

async function escribir(datos) {
  await escribirJson(config.crew.path, datos, { copia: true });
}

/** Lee, aplica `fn` y escribe, en serie: dos peticiones a la vez no se pisan. */
function cambiar(fn) {
  const paso = cola.then(async () => {
    const datos = await leer();
    const resultado = await fn(datos);
    await escribir(datos);
    return resultado;
  });
  cola = paso.catch(() => {});
  return paso;
}

/**
 * Instalación conjunta de Clipgeist (igual en las tres apps): con `CLIPGEIST_CLAVE` en el entorno,
 * ESA es la clave de API de esta app (manda sobre la guardada, que no se toca), y las
 * `CLIPGEIST_<APP>_URL` dicen dónde está cada una. Sin las variables, nada cambia.
 */
const claveEntorno = () => String(process.env.CLIPGEIST_CLAVE || '').trim();
const VARIABLES_URL = {
  clipscout: 'CLIPGEIST_CLIPSCOUT_URL',
  clipkeeper: 'CLIPGEIST_CLIPKEEPER_URL',
  clonbuster: 'CLIPGEIST_CLONBUSTER_URL',
};
const urlEntorno = app => String(process.env[VARIABLES_URL[app]] || '').trim();

/** Los datos, creando la clave de API la primera vez. */
async function datos() {
  const actuales = await leer();
  if (claveEntorno()) return { ...actuales, api_key: claveEntorno(), claveDelEntorno: true };
  if (actuales.api_key) return actuales;
  return cambiar(d => {
    if (!d.api_key) d.api_key = crypto.randomBytes(16).toString('hex');
    return d;
  });
}

/* ── Utilidades ───────────────────────────────────────────────────────── */

function normalizarUrl(url) {
  const limpia = String(url || '')
    .trim()
    .replace(/\/+$/, '');
  let partes;
  try {
    partes = new URL(limpia);
  } catch {
    throw new ErrorCrew('La URL tiene que empezar por http:// o https:// e incluir el servidor.');
  }
  if (!['http:', 'https:'].includes(partes.protocol) || !partes.host) {
    throw new ErrorCrew('La URL tiene que empezar por http:// o https:// e incluir el servidor.');
  }
  return limpia;
}

function validarApp(app) {
  if (!APPS.includes(app)) {
    throw new ErrorCrew(`Tipo de app desconocido. Opciones: ${APPS.join(', ')}.`);
  }
  return app;
}

function claveValida(recibida, propia) {
  if (typeof recibida !== 'string' || !propia) return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(propia);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function urlDetectada(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function estadoPropio(req) {
  const d = await datos();
  return {
    crew: CREW,
    protocolo: PROTOCOLO,
    app: APP,
    version,
    instancia: d.instancia || APP,
    url: (d.url || urlEntorno(APP) || urlDetectada(req)).replace(/\/+$/, ''),
  };
}

function publica(conexion) {
  const { id, app, nombre, url, activa, auto = false } = conexion;
  return { id, app, nombre, url, activa, auto };
}

async function listar() {
  return ((await datos()).conexiones || []).map(publica);
}

async function guardarConexion({ app, nombre, url, api_key: clave }) {
  const limpia = normalizarUrl(url);
  validarApp(app);
  if (typeof clave !== 'string' || !clave.trim()) throw new ErrorCrew('Falta la clave de API.');
  const nombreFinal = (typeof nombre === 'string' && nombre.trim()) || app;
  return cambiar(d => {
    d.conexiones = d.conexiones || [];
    const existente = d.conexiones.find(c => c.url === limpia);
    if (existente) {
      Object.assign(existente, { app, nombre: nombreFinal, api_key: clave.trim(), activa: true });
      return { id: existente.id, creada: false };
    }
    const id = d.conexiones.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    d.conexiones.push({
      id,
      app,
      nombre: nombreFinal,
      url: limpia,
      api_key: clave.trim(),
      activa: true,
      creada: new Date().toISOString(),
    });
    return { id, creada: true };
  });
}

function quitar(id) {
  return cambiar(d => {
    d.conexiones = (d.conexiones || []).filter(c => c.id !== Number(id));
  });
}

/* ── Cliente: hablar con otra app ─────────────────────────────────────── */

async function llamar(url, opciones) {
  return fetch(url, {
    ...opciones,
    redirect: 'manual',
    signal: AbortSignal.timeout(config.crew.timeoutMs),
  });
}

/** GET /status de la otra app. Nunca lanza: devuelve {ok, ...} o {ok: false, error}. */
async function probar(app, url, clave) {
  let base;
  try {
    base = normalizarUrl(url);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  let r;
  try {
    r = await llamar(`${base}/api/crew/v1/status`, {
      headers: { 'X-Api-Key': String(clave || '').trim() },
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return {
        ok: false,
        error: 'No responde (tiempo agotado). ¿La URL y el puerto son correctos?',
      };
    }
    return { ok: false, error: 'No se pudo conectar. ¿Está encendida?' };
  }
  if (r.status === 401) return { ok: false, error: 'La clave de API no es correcta.' };
  if (r.status === 404) {
    return {
      ok: false,
      error: 'Responde, pero no es una app de Clipgeist (o es una versión antigua).',
    };
  }
  if (r.status !== 200) return { ok: false, error: `Respondió con un error (${r.status}).` };
  let remoto;
  try {
    remoto = await r.json();
  } catch {
    return { ok: false, error: 'Respondió algo que no es una app de Clipgeist.' };
  }
  if (remoto.crew !== CREW && remoto.crew !== CREW_ANTIGUO) {
    return { ok: false, error: 'Responde, pero no es una app de Clipgeist.' };
  }
  if (remoto.app !== app) {
    return { ok: false, error: `En esa URL hay un ${remoto.app}, no un ${app}.` };
  }
  const { version: v, instancia, protocolo } = remoto;
  return { ok: true, app: remoto.app, version: v, instancia, protocolo };
}

/** Ida y vuelta: darse de alta en la otra app con la URL y la clave propias. */
async function registrarseEn(req, url, claveRemota) {
  const propio = await estadoPropio(req);
  const { api_key: clavePropia } = await datos();
  try {
    const r = await llamar(`${url}/api/crew/v1/conexiones`, {
      method: 'POST',
      headers: { 'X-Api-Key': claveRemota, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: APP,
        nombre: propio.instancia,
        url: propio.url,
        api_key: clavePropia,
      }),
    });
    if (r.status !== 200) {
      return { ok: false, error: `La otra app rechazó el registro (${r.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo registrar en la otra app.' };
  }
}

/**
 * «¿Ya lo tengo?»: pregunta a clipkeeper si estos títulos están en la biblioteca.
 * Devuelve {conectado: false} si no hay ningún clipkeeper conectado.
 */
async function buscarEnClipkeeper(titulos, duraciones, persona = '') {
  const { conexiones = [] } = await datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, resultados: [] };
  try {
    const r = await llamar(`${destino.url}/api/crew/v1/buscar`, {
      method: 'POST',
      headers: { 'X-Api-Key': destino.api_key, 'Content-Type': 'application/json' },
      // `persona`: lo que se buscó. Con ficheros ya renombrados, el título del sitio no aparece
      // en clipkeeper y lo reconoce por duración + persona.
      body: JSON.stringify({ titulos, duraciones, persona }),
    });
    if (r.status !== 200) {
      return { conectado: true, error: `clipkeeper respondió ${r.status}`, resultados: [] };
    }
    return { conectado: true, clipkeeper: destino.nombre, ...(await r.json()) };
  } catch {
    return { conectado: true, error: 'clipkeeper no responde.', resultados: [] };
  }
}

/**
 * Destinos para descargar: carpetas de las bibliotecas de clipkeeper con lo que heredará lo que
 * llegue a cada una (personas y etiquetas comunes). {conectado: false} sin clipkeeper.
 */
async function destinosClipkeeper() {
  const { conexiones = [] } = await datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, bibliotecas: [] };
  try {
    const r = await llamar(`${destino.url}/api/crew/v1/destinos`, {
      headers: { 'X-Api-Key': destino.api_key },
    });
    if (r.status !== 200) {
      return { conectado: true, error: `clipkeeper respondió ${r.status}`, bibliotecas: [] };
    }
    return { conectado: true, ...(await r.json()) };
  } catch {
    return { conectado: true, error: 'clipkeeper no responde.', bibliotecas: [] };
  }
}

/**
 * Regla de carpeta en clipkeeper: lo que llegue a `carpeta` (relativa a la biblioteca) entra con
 * esas personas y etiquetas. Se usa al mandar una descarga a una carpeta NUEVA.
 */
async function reglaClipkeeper({ bibliotecaId, carpeta, personas = [], etiquetas = [] }) {
  const { conexiones = [] } = await datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { ok: false, error: 'clipkeeper no está conectado.' };
  try {
    const r = await llamar(`${destino.url}/api/crew/v1/reglas`, {
      method: 'POST',
      headers: { 'X-Api-Key': destino.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ biblioteca_id: bibliotecaId, carpeta, personas, etiquetas }),
    });
    if (r.status !== 200) return { ok: false, error: `clipkeeper respondió ${r.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'clipkeeper no responde.' };
  }
}

/**
 * «Ya llegó»: pide a clipkeeper que escanee SOLO esa carpeta (y sus subcarpetas) de esa
 * biblioteca, para que lo recién descargado entre al momento con sus reglas, sin esperar al
 * escaneo periódico. Contrato: POST /api/crew/v1/escanear {biblioteca_id, carpeta} → 202.
 * `{conectado: false}` si no hay clipkeeper: entonces no se hace nada.
 */
async function escanearClipkeeper({ bibliotecaId, carpeta = '' }) {
  const { conexiones = [] } = await datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, ok: false };
  try {
    const r = await llamar(`${destino.url}/api/crew/v1/escanear`, {
      method: 'POST',
      headers: { 'X-Api-Key': destino.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ biblioteca_id: bibliotecaId, carpeta }),
    });
    if (r.status !== 202 && r.status !== 200) {
      return { conectado: true, ok: false, error: `clipkeeper respondió ${r.status}` };
    }
    return { conectado: true, ok: true };
  } catch {
    return { conectado: true, ok: false, error: 'clipkeeper no responde.' };
  }
}

/* ── Autoconexión por entorno ─────────────────────────────────────────── */

/**
 * Asegura UNA conexión con `app` en `url` y la clave común. Idempotente: si ya existe la creada
 * por el entorno, solo se le pone la clave al día; si hay una creada A MANO con esa URL, no se
 * toca. Devuelve 'creada' | 'actualizada' | 'igual' | 'manual' | 'no_responde'.
 */
async function asegurarConexion(app, url, clave) {
  const limpia = normalizarUrl(url);
  const { conexiones = [] } = await leer();
  const existente = conexiones.find(c => c.url === limpia);
  if (existente && !existente.auto) return 'manual';
  if (existente && existente.api_key === clave && existente.activa && existente.app === app) {
    return 'igual';
  }
  const prueba = await probar(app, limpia, clave);
  if (!prueba.ok) return 'no_responde';
  await cambiar(d => {
    d.conexiones = d.conexiones || [];
    const c = d.conexiones.find(x => x.url === limpia);
    if (c) {
      Object.assign(c, { app, api_key: clave, activa: true, auto: true });
      return;
    }
    const id = d.conexiones.reduce((max, x) => Math.max(max, x.id), 0) + 1;
    d.conexiones.push({
      id,
      app,
      nombre: prueba.instancia || app,
      url: limpia,
      api_key: clave,
      activa: true,
      auto: true,
      creada: new Date().toISOString(),
    });
  });
  return existente ? 'actualizada' : 'creada';
}

/**
 * Al arrancar: una conexión con cada app de `CLIPGEIST_*_URL` que no sea esta. Si alguna aún no
 * responde (arrancan a la vez y cada una tarda lo suyo), se reintenta en segundo plano cada
 * `cadaMs` durante `maxMs`. Sin `CLIPGEIST_CLAVE` no hace nada.
 */
function autoconectar({ cadaMs = 15000, maxMs = 10 * 60 * 1000 } = {}) {
  const clave = claveEntorno();
  if (!clave) return Promise.resolve({});
  const pendientes = Object.keys(VARIABLES_URL).filter(a => a !== APP && urlEntorno(a));
  const resultado = {};
  const hasta = Date.now() + maxMs;
  const intentar = async () => {
    for (const app of [...pendientes]) {
      try {
        const r = await asegurarConexion(app, urlEntorno(app), clave);
        resultado[app] = r;
        if (r !== 'no_responde') pendientes.splice(pendientes.indexOf(app), 1);
        if (r === 'creada' || r === 'actualizada') {
          logger.info(`Clipgeist: conexión con ${app} (${urlEntorno(app)}) ${r} desde el entorno`);
        }
      } catch (error) {
        // URL mal escrita en el entorno: no tiene arreglo reintentando.
        resultado[app] = `error: ${error.message}`;
        pendientes.splice(pendientes.indexOf(app), 1);
        logger.warn(`Clipgeist: ${VARIABLES_URL[app]} no vale: ${error.message}`);
      }
    }
  };
  return intentar().then(() => {
    if (pendientes.length > 0) {
      const reloj = setInterval(async () => {
        await intentar();
        if (pendientes.length === 0 || Date.now() > hasta) {
          clearInterval(reloj);
          if (pendientes.length) {
            logger.warn(
              `Clipgeist: ${pendientes.join(', ')} no respondió; conéctala desde Ajustes`
            );
          }
        }
      }, cadaMs);
      reloj.unref?.();
    }
    return resultado;
  });
}

module.exports = {
  autoconectar,
  asegurarConexion,
  claveEntorno,
  escanearClipkeeper,
  reglaClipkeeper,
  buscarEnClipkeeper,
  destinosClipkeeper,
  APP,
  APPS,
  ErrorCrew,
  datos,
  cambiar,
  normalizarUrl,
  validarApp,
  claveValida,
  urlDetectada,
  estadoPropio,
  listar,
  guardarConexion,
  quitar,
  probar,
  registrarseEn,
};
