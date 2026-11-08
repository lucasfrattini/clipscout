'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');

/**
 * Protocolo clip crew v1: conexión con las otras apps de la familia.
 *
 * Referencia común: `docs/CREW.md` del repositorio de clipkeeper. clonbuster
 * y clipkeeper implementan lo mismo; si cambia el protocolo, cambia en las tres.
 *
 * Ojo con la protección SSRF: el scraping NO puede tocar direcciones privadas,
 * y eso no cambia. Las llamadas de este módulo van SOLO a las URLs que el
 * administrador dio de alta como apps de clip crew (normalmente en la red
 * local), y solo a sus rutas `/api/crew/v1/...`. Por eso usan su propio fetch
 * y no el cliente HTTP del scraper.
 */

const APP = 'clipscout';
const CREW = 'clip crew';
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

async function leer() {
  try {
    return JSON.parse(await fs.readFile(config.crew.path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('crew.json ilegible, se recrea', { error: error.message });
    }
    return {};
  }
}

async function escribir(datos) {
  const destino = config.crew.path;
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const temporal = `${destino}.tmp`;
  await fs.writeFile(temporal, `${JSON.stringify(datos, null, 2)}\n`, 'utf8');
  await fs.rename(temporal, destino);
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

/** Los datos, creando la clave de API la primera vez. */
async function datos() {
  const actuales = await leer();
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
    url: (d.url || urlDetectada(req)).replace(/\/+$/, ''),
  };
}

function publica(conexion) {
  const { id, app, nombre, url, activa } = conexion;
  return { id, app, nombre, url, activa };
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
      error: 'Responde, pero no es una app de clip crew (o es una versión antigua).',
    };
  }
  if (r.status !== 200) return { ok: false, error: `Respondió con un error (${r.status}).` };
  let remoto;
  try {
    remoto = await r.json();
  } catch {
    return { ok: false, error: 'Respondió algo que no es una app de clip crew.' };
  }
  if (remoto.crew !== CREW) {
    return { ok: false, error: 'Responde, pero no es una app de clip crew.' };
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
async function buscarEnClipkeeper(titulos, duraciones) {
  const { conexiones = [] } = await datos();
  const destino = conexiones.find(c => c.app === 'clipkeeper' && c.activa);
  if (!destino) return { conectado: false, resultados: [] };
  try {
    const r = await llamar(`${destino.url}/api/crew/v1/buscar`, {
      method: 'POST',
      headers: { 'X-Api-Key': destino.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulos, duraciones }),
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

module.exports = {
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
