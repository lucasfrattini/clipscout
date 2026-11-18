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
  return {
    id,
    app,
    nombre,
    url,
    activa,
    auto,
    // ¿Ya hablamos con claves de conexión? (si no, aún se usa la clave de administración de la otra)
    clave_conexion: esClaveConexion(conexion.api_key),
    // ¿Puede la otra llamarnos? (tiene una clave de conexión emitida por esta app, sin revocar)
    entrada: (conexion.entradas || []).length > 0,
  };
}

/* ── Claves de conexión (SU-03) ───────────────────────────────────────── */

/**
 * Dos tipos de clave en `X-Api-Key`:
 * - la de administración (`api_key` de crew.json, sin prefijo): abre toda la API, como siempre;
 * - las de conexión (`cgc_…`): una por app remota y sentido. La emite la app que RECIBE las
 *   llamadas; aquí se guarda solo su sha256 (`entradas` de la conexión) y solo vale para las
 *   rutas del protocolo de la lista de permisos (middleware/acceso.js).
 * La clave con la que llamamos nosotros a la otra (`api_key` de la conexión) va en claro: hace falta.
 */
const PREFIJO_CLAVE = 'cgc_';
const MAX_ENTRADAS = 3;
const esClaveConexion = clave => typeof clave === 'string' && clave.startsWith(PREFIJO_CLAVE);
const nuevaClaveConexion = () => PREFIJO_CLAVE + crypto.randomBytes(32).toString('base64url');
const hashClave = clave => crypto.createHash('sha256').update(String(clave)).digest('hex');

/**
 * Añade una clave de entrada (la que usará la otra app para llamarnos). Se guardan las últimas
 * tres y no solo una: si las dos apps renuevan a la vez, cada una se queda con la que le llegó
 * última y las dos siguen valiendo.
 */
function anadirEntrada(conexion, clave) {
  conexion.entradas = [
    ...(conexion.entradas || []),
    { h: hashClave(clave), creada: new Date().toISOString() },
  ].slice(-MAX_ENTRADAS);
}

/** La conexión activa a la que pertenece esta clave de conexión, o null. */
async function conexionPorClave(recibida) {
  if (!esClaveConexion(recibida)) return null;
  const h = Buffer.from(hashClave(recibida));
  const { conexiones = [] } = await datos();
  return (
    conexiones.find(
      c =>
        c.activa !== false &&
        (c.entradas || []).some(e => {
          const b = Buffer.from(String(e.h));
          return b.length === h.length && crypto.timingSafeEqual(b, h);
        })
    ) || null
  );
}

/** ¿Es la clave de administración de esta app? */
async function esClaveAdmin(recibida) {
  if (!recibida || esClaveConexion(recibida)) return false;
  const { api_key: propia } = await datos();
  return claveValida(recibida, propia);
}

/** Revocar: la otra app deja de poder llamarnos con lo que le dimos. */
function revocarEntrada(id) {
  return cambiar(d => {
    const c = (d.conexiones || []).find(x => x.id === Number(id));
    if (!c) throw new ErrorCrew('No existe esa conexión.', 404);
    c.entradas = [];
    c.renovada = Date.now();
    return publica(c);
  });
}

/** La URL con la que nos conocen las otras apps (la de Ajustes, o la del entorno). */
async function urlPropia() {
  const d = await datos();
  return String(d.url || urlEntorno(APP) || '').replace(/\/+$/, '');
}

async function listar() {
  return ((await datos()).conexiones || []).map(publica);
}

/**
 * Alta o cambio de una conexión. `clave` (o `api_key`, el nombre de antes de 2.18): con la que
 * llamaremos a la otra app. `entrada`: clave de conexión que le damos para que nos llame (se
 * guarda su resumen). Devuelve {id, creada}.
 */
async function guardarConexion({
  app,
  nombre,
  url,
  api_key: claveAntigua,
  clave: claveNueva,
  entrada,
}) {
  const limpia = normalizarUrl(url);
  validarApp(app);
  const clave = typeof claveNueva === 'string' && claveNueva.trim() ? claveNueva : claveAntigua;
  if (typeof clave !== 'string' || !clave.trim()) throw new ErrorCrew('Falta la clave de API.');
  const nombreFinal = (typeof nombre === 'string' && nombre.trim()) || app;
  return cambiar(d => {
    d.conexiones = d.conexiones || [];
    let c = d.conexiones.find(x => x.url === limpia);
    const creada = !c;
    if (c) {
      Object.assign(c, { app, nombre: nombreFinal, api_key: clave.trim(), activa: true });
    } else {
      const id = d.conexiones.reduce((max, x) => Math.max(max, x.id), 0) + 1;
      c = {
        id,
        app,
        nombre: nombreFinal,
        url: limpia,
        api_key: clave.trim(),
        activa: true,
        creada: new Date().toISOString(),
      };
      d.conexiones.push(c);
    }
    if (entrada) anadirEntrada(c, entrada);
    c.renovada = Date.now();
    return { id: c.id, creada };
  });
}

/**
 * POST /api/crew/v1/conexiones (otra app se da de alta aquí: la «ida» suya o nuestra «vuelta»).
 *
 * - Con la clave de administración: alta o cambio, como siempre. Si manda `clave` (o `api_key`),
 *   es con la que la llamaremos. Respondemos con `clave`: la de conexión para que nos llame ella.
 * - Con una clave de conexión: solo si ya existe una conexión con esa app y esa misma URL (es la
 *   suya); nunca crear ni cambiar la URL. Sirve para que nos pase una clave nueva.
 */
async function registrarConexion(cuerpo = {}, { admin = false, conexion = null } = {}) {
  const { app, url } = cuerpo;
  validarApp(app);
  const limpia = normalizarUrl(url);
  if (!admin) {
    if (!conexion || conexion.app !== app || conexion.url !== limpia) {
      throw new ErrorCrew(
        'Con una clave de conexión no se pueden crear conexiones ni cambiar su dirección: ' +
          'hace falta la clave de administración.',
        403
      );
    }
  }
  const entrada = nuevaClaveConexion();
  const r = await guardarConexion({ ...cuerpo, url: limpia, entrada });
  return { ...r, clave: entrada };
}

/**
 * POST /api/crew/v1/conexiones/renovar {app, url, clave}: la otra app deja de usar la clave de
 * administración (o una de conexión vieja) y pasa a claves de conexión. Guardamos `clave` para
 * llamarla y respondemos con la nuestra para que nos llame.
 * - Con la clave de administración: se busca la conexión por app y URL (o, si no coincide la URL,
 *   la única que haya de esa app); si no hay ninguna se crea, como haría un alta.
 * - Con una clave de conexión: la de esa conexión, sin cambiar su URL.
 */
async function renovarConexion(cuerpo = {}, { admin = false, conexion = null } = {}) {
  const { app, clave } = cuerpo;
  validarApp(app);
  if (!esClaveConexion(clave)) throw new ErrorCrew('Falta la clave de conexión (cgc_…).');
  if (!admin && (!conexion || conexion.app !== app)) {
    throw new ErrorCrew('Esa clave de conexión no es de esa app.', 403);
  }
  let limpia = '';
  if (cuerpo.url) limpia = normalizarUrl(cuerpo.url);
  const entrada = nuevaClaveConexion();
  return cambiar(d => {
    d.conexiones = d.conexiones || [];
    let c = null;
    if (admin) {
      c =
        d.conexiones.find(x => x.app === app && x.url === limpia) ||
        (d.conexiones.filter(x => x.app === app).length === 1
          ? d.conexiones.find(x => x.app === app)
          : null);
      if (!c) {
        if (!limpia) throw new ErrorCrew('Falta la URL de la app.');
        c = {
          id: d.conexiones.reduce((max, x) => Math.max(max, x.id), 0) + 1,
          app,
          nombre: (typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim()) || app,
          url: limpia,
          activa: true,
          creada: new Date().toISOString(),
        };
        d.conexiones.push(c);
      }
    } else {
      c = d.conexiones.find(x => x.id === conexion.id);
      if (!c) throw new ErrorCrew('No existe esa conexión.', 404);
    }
    c.api_key = clave;
    c.activa = true;
    anadirEntrada(c, entrada);
    c.renovada = Date.now();
    return { clave: entrada };
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

/**
 * Ida y vuelta: darse de alta en la otra app (con SU clave de administración, que ha pegado el
 * usuario) dándole una clave de conexión nuestra (`clave`; también como `api_key`, que es lo que
 * leen las versiones de antes de 2.18). Si responde con `clave` (cgc_…), la guardamos para
 * llamarla y olvidamos su clave de administración. Una versión vieja no la manda: entonces se
 * sigue con la de administración y la migración lo reintenta cada hora.
 */
async function registrarseEn(req, url, claveRemota, { conexionId } = {}) {
  const propio = await estadoPropio(req);
  const entrada = nuevaClaveConexion();
  const limpia = normalizarUrl(url);
  // La clave que le damos ya vale antes de mandarla: puede llamarnos en cuanto la reciba.
  const previa = await cambiar(d => {
    const c = (d.conexiones || []).find(x => (conexionId ? x.id === conexionId : x.url === limpia));
    if (!c) return null;
    anadirEntrada(c, entrada);
    c.renovada = Date.now();
    return c.renovada;
  });
  let r;
  try {
    r = await llamar(`${limpia}/api/crew/v1/conexiones`, {
      method: 'POST',
      headers: { 'X-Api-Key': claveRemota, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: APP,
        nombre: propio.instancia,
        url: propio.url,
        clave: entrada,
        api_key: entrada,
      }),
    });
  } catch {
    return { ok: false, error: 'No se pudo registrar en la otra app.' };
  }
  if (r.status !== 200) {
    return { ok: false, error: `La otra app rechazó el registro (${r.status}).` };
  }
  const respuesta = await r.json().catch(() => ({}));
  if (esClaveConexion(respuesta?.clave) && previa !== null) {
    await cambiar(d => {
      const c = (d.conexiones || []).find(x =>
        conexionId ? x.id === conexionId : x.url === limpia
      );
      // Si mientras tanto la otra app nos renovó a nosotros, manda lo suyo (es lo más nuevo).
      if (c && c.renovada === previa) {
        c.api_key = respuesta.clave;
        c.renovada = Date.now();
      }
    });
  }
  return { ok: true };
}

/* ── Migración a claves de conexión ───────────────────────────────────── */

/**
 * Las conexiones de antes de 2.18 guardan la clave de ADMINISTRACIÓN de la otra app. Para cada
 * una: POST otra/api/crew/v1/conexiones/renovar con esa clave y una clave de conexión nuestra;
 * la otra responde con la suya y deja de guardar la nuestra de administración. Si la otra es
 * vieja (404) o no responde, se deja como está y se reintenta (cada hora, ver `arrancarMigracion`).
 * Devuelve {migradas, pendientes}.
 */
async function migrarConexiones() {
  const { conexiones = [] } = await datos();
  const miUrl = await urlPropia();
  let migradas = 0;
  let pendientes = 0;
  for (const c of conexiones) {
    if (c.activa === false || esClaveConexion(c.api_key)) continue;
    const entrada = nuevaClaveConexion();
    const previa = await cambiar(d => {
      const x = (d.conexiones || []).find(y => y.id === c.id);
      if (!x || esClaveConexion(x.api_key)) return null;
      anadirEntrada(x, entrada);
      x.renovada = Date.now();
      return x.renovada;
    });
    if (previa === null) continue;
    let r = null;
    try {
      r = await llamar(`${c.url}/api/crew/v1/conexiones/renovar`, {
        method: 'POST',
        headers: { 'X-Api-Key': c.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: APP, url: miUrl, clave: entrada }),
      });
    } catch {
      r = null;
    }
    const respuesta = r && r.status === 200 ? await r.json().catch(() => ({})) : {};
    if (!esClaveConexion(respuesta.clave)) {
      pendientes += 1;
      if (r && r.status !== 404) {
        logger.warn(`Clipgeist: ${c.app} (${c.url}) no renovó la clave (${r.status})`);
      }
      continue;
    }
    await cambiar(d => {
      const x = (d.conexiones || []).find(y => y.id === c.id);
      if (x && x.renovada === previa) {
        x.api_key = respuesta.clave;
        x.renovada = Date.now();
      }
    });
    migradas += 1;
    logger.info(`Clipgeist: conexión con ${c.app} (${c.url}) pasada a claves de conexión`);
  }
  return { migradas, pendientes };
}

let relojMigracion = null;
/** Al arrancar y luego cada hora, hasta que no quede ninguna conexión con clave antigua. */
function arrancarMigracion({ cadaMs = 60 * 60 * 1000, esperaMs = 20000 } = {}) {
  if (relojMigracion) return;
  const intentar = async () => {
    try {
      const { pendientes } = await migrarConexiones();
      if (pendientes === 0 && relojMigracion) {
        clearInterval(relojMigracion);
        relojMigracion = 'hecho';
      }
    } catch (error) {
      logger.warn(`Clipgeist: migración de claves: ${error.message}`);
    }
  };
  // Un poco después de arrancar: las otras apps suelen arrancar a la vez y tardan lo suyo.
  const primero = setTimeout(intentar, esperaMs);
  primero.unref?.();
  relojMigracion = setInterval(intentar, cadaMs);
  relojMigracion.unref?.();
}

/* ── Sesiones de otras apps (inicio de sesión único) ──────────────────── */

const validadas = new Map(); // sha256(testigo) → {ok, usuario, en}
const FRESCA_MS = 60 * 1000;
const RESERVA_MS = 5 * 60 * 1000;

/**
 * ¿Vale este testigo de OTRA app? Se le pregunta a ella (POST /sesion/validar con la clave de
 * conexión). Solo se fía de apps conectadas. El resultado se recuerda 60 s; si la otra no
 * responde, el último «sí» vale hasta 5 minutos. Devuelve {ok, usuario?}.
 */
async function validarSesionAjena(testigo, appOrigen) {
  const h = hashClave(testigo);
  const previa = validadas.get(h);
  if (previa && Date.now() - previa.en < FRESCA_MS) return previa;
  const { conexiones = [] } = await datos();
  const destinos = conexiones.filter(c => c.app === appOrigen && c.activa !== false);
  if (destinos.length === 0) return { ok: false };
  for (const c of destinos) {
    let r;
    try {
      r = await llamar(`${c.url}/api/crew/v1/sesion/validar`, {
        method: 'POST',
        headers: { 'X-Api-Key': c.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ testigo }),
      });
    } catch {
      continue; // no responde: se prueba la siguiente, y si no, la caché
    }
    if (r.status !== 200) continue;
    const cuerpo = await r.json().catch(() => ({}));
    const resultado = { ok: cuerpo.ok === true, usuario: cuerpo.usuario || '', en: Date.now() };
    if (validadas.size > 1000) validadas.clear();
    validadas.set(h, resultado);
    return resultado;
  }
  if (previa && previa.ok && Date.now() - previa.en < RESERVA_MS) return previa;
  return { ok: false };
}

/** «Salir» con un testigo de otra app: se le pide a ella que lo borre. Nunca lanza. */
async function cerrarSesionAjena(testigo, appOrigen) {
  validadas.delete(hashClave(testigo));
  const { conexiones = [] } = await datos().catch(() => ({}));
  for (const c of (conexiones || []).filter(x => x.app === appOrigen && x.activa !== false)) {
    try {
      const r = await llamar(`${c.url}/api/crew/v1/sesion/cerrar`, {
        method: 'POST',
        headers: { 'X-Api-Key': c.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ testigo }),
      });
      if (r.status === 200) return true;
    } catch {
      // siguiente
    }
  }
  return false;
}

/** Hosts de las URLs de las conexiones y de la propia (para la lista de nombres permitidos). */
async function hostsConocidos() {
  const { conexiones = [], url } = await datos();
  const urls = [url, urlEntorno(APP), ...Object.keys(VARIABLES_URL).map(urlEntorno)];
  for (const c of conexiones) urls.push(c.url);
  const hosts = new Set();
  for (const u of urls.filter(Boolean)) {
    try {
      hosts.add(new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ''));
    } catch {
      // URL rara: no añade nada
    }
  }
  return hosts;
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
 * Asegura UNA conexión con `app` en `url` usando la clave común SOLO para el primer registro: nos
 * damos de alta en la otra con ella (como clave de administración) y, si nos da una clave de
 * conexión, esa es la que se guarda. Idempotente: una conexión automática que ya habla con claves
 * de conexión no se toca; una creada A MANO con esa URL, tampoco.
 * Devuelve 'creada' | 'actualizada' | 'igual' | 'manual' | 'no_responde'.
 */
async function asegurarConexion(app, url, clave) {
  const limpia = normalizarUrl(url);
  const { conexiones = [] } = await leer();
  const existente = conexiones.find(c => c.url === limpia);
  if (existente && !existente.auto) return 'manual';
  if (
    existente &&
    existente.activa &&
    existente.app === app &&
    (esClaveConexion(existente.api_key) || existente.api_key === clave)
  ) {
    return 'igual';
  }
  const prueba = await probar(app, limpia, clave);
  if (!prueba.ok) return 'no_responde';
  const id = await cambiar(d => {
    d.conexiones = d.conexiones || [];
    const c = d.conexiones.find(x => x.url === limpia);
    if (c) {
      Object.assign(c, { app, api_key: clave, activa: true, auto: true });
      return c.id;
    }
    const nuevo = d.conexiones.reduce((max, x) => Math.max(max, x.id), 0) + 1;
    d.conexiones.push({
      id: nuevo,
      app,
      nombre: prueba.instancia || app,
      url: limpia,
      api_key: clave,
      activa: true,
      auto: true,
      creada: new Date().toISOString(),
    });
    return nuevo;
  });
  // Ida y vuelta con la clave común; si la otra ya sabe de claves de conexión, se cambia a ellas.
  const reqFalsa = { protocol: 'http', get: () => '' };
  if (await urlPropia()) await registrarseEn(reqFalsa, limpia, clave, { conexionId: id });
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
  registrarConexion,
  renovarConexion,
  revocarEntrada,
  conexionPorClave,
  esClaveAdmin,
  esClaveConexion,
  nuevaClaveConexion,
  hashClave,
  migrarConexiones,
  arrancarMigracion,
  validarSesionAjena,
  cerrarSesionAjena,
  hostsConocidos,
  urlPropia,
  PREFIJO_CLAVE,
};
