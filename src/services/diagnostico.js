'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const errores = require('../lib/errores');
const registro = require('../lib/registro');
const zip = require('../lib/zip');
const { version } = require('../../package.json');

/**
 * Diagnóstico (SU-11): qué funciona y qué no, para Ajustes → Sistema → Diagnóstico y para el
 * soporte. Cada comprobación tiene su tiempo máximo: un disco o una app que no contestan dan
 * «no responde», nunca dejan la petición colgada.
 *
 * Comprobaciones: ajustes (crew.json, lo que en las otras apps es la base de datos), carpeta de
 * datos escribible, navegador interno, proxy de salida, gestor de descargas y cada conexión con
 * las otras apps. clipscout no tiene bibliotecas ni ffmpeg.
 */

const ARRANQUE = new Date().toISOString();

const TEXTOS = {
  es: {
    ajustesOk: 'crew.json se lee bien.',
    datosOk: 'Se puede escribir.',
    sinRespuesta: 'No responde (tiempo agotado).',
    navApagado: 'Desactivado (BROWSER_ENABLED=false): los sitios que lo necesitan no funcionarán.',
    navAbierto: 'En marcha.',
    navOk: 'Arranca bien.',
    sinProxy: 'Sin proxy de salida: se sale directamente.',
    proxyOk: 'Responde ({ms} ms).',
    proxyMal:
      'El proxy de salida NO responde ({error}): las búsquedas en los sitios que salen por él fallarán hasta que vuelva.',
    jdSin: 'Sin configurar (Ajustes → Descargas).',
    jdOk: 'Responde.',
    conOk: 'Responde ({version}).',
    conInactiva: 'Desactivada.',
  },
  en: {
    ajustesOk: 'crew.json reads fine.',
    datosOk: 'Writable.',
    sinRespuesta: 'Not responding (timed out).',
    navApagado: 'Disabled (BROWSER_ENABLED=false): sites that need it will not work.',
    navAbierto: 'Running.',
    navOk: 'Starts fine.',
    sinProxy: 'No outbound proxy: connecting directly.',
    proxyOk: 'Responding ({ms} ms).',
    proxyMal:
      'The outbound proxy is NOT responding ({error}): searches on the sites that go through it will fail until it is back.',
    jdSin: 'Not configured (Settings → Downloads).',
    jdOk: 'Responding.',
    conOk: 'Responding ({version}).',
    conInactiva: 'Disabled.',
  },
};

const texto = (idioma, clave, params = {}) =>
  (TEXTOS[idioma] || TEXTOS.es)[clave].replace(/\{(\w+)\}/g, (c, k) => String(params[k] ?? c));

class TiempoAgotado extends Error {}

/** `promesa` con tiempo máximo: si no llega, TiempoAgotado (la promesa sigue, pero no se espera). */
function conTiempo(promesa, ms) {
  let reloj;
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new TiempoAgotado()), ms);
      reloj.unref?.();
    }),
  ]).finally(() => clearTimeout(reloj));
}

/* ── Comprobaciones sueltas (cada una devuelve {ok, detalle}) ───────── */

async function carpetaEscribible() {
  const prueba = path.join(config.datos.dir, `.diagnostico-${process.pid}-${Date.now()}`);
  await fs.mkdir(config.datos.dir, { recursive: true });
  await fs.writeFile(prueba, 'ok', { mode: 0o600 });
  await fs.rm(prueba, { force: true });
}

async function ajustesLegibles() {
  const crew = require('./crew');
  await crew.leerSinCache();
}

let ultimaNavegador = null; // {ok, detalle, cuando}
async function probarNavegadorReal() {
  const { pool } = require('../lib/browser');
  if (pool.browser?.connected) return 'abierto';
  await pool.getBrowser();
  // Que se cierre solo si nadie lo usa (lo mismo que tras una búsqueda).
  pool.scheduleIdleShutdown();
  return 'arranca';
}

/** Lo que se puede sustituir en las pruebas (sin lanzar un navegador ni llamar a nadie). */
const probadores = {
  navegador: probarNavegadorReal,
  proxy: () => require('./proxySalida').probar(),
};

function errorTexto(error, idioma) {
  if (error instanceof TiempoAgotado) return texto(idioma, 'sinRespuesta');
  return String(error?.message || error).slice(0, 300);
}

async function comprobar(nombre, fn, idioma, ms = config.diagnostico.timeoutMs) {
  try {
    const r = await conTiempo(fn(), ms);
    return { nombre, ok: r?.ok !== false, detalle: r?.detalle || '' };
  } catch (error) {
    return {
      nombre,
      ok: false,
      detalle: errorTexto(error, idioma),
      ...(error instanceof TiempoAgotado ? { codigo: 'disco_no_responde' } : {}),
    };
  }
}

async function comprobaciones(idioma = 'es') {
  const crew = require('./crew');
  const jd = require('./jdownloader');
  const lista = [
    comprobar(
      'ajustes',
      async () => {
        await ajustesLegibles();
        return { detalle: texto(idioma, 'ajustesOk') };
      },
      idioma
    ),
    comprobar(
      'carpeta_datos',
      async () => {
        await carpetaEscribible();
        return { detalle: texto(idioma, 'datosOk') };
      },
      idioma
    ),
    comprobar(
      'navegador',
      async () => {
        if (!config.browser.enabled) return { ok: false, detalle: texto(idioma, 'navApagado') };
        const vigente =
          ultimaNavegador?.ok &&
          Date.now() - ultimaNavegador.cuando < config.diagnostico.navegadorVigenciaMs;
        if (vigente) return { detalle: texto(idioma, 'navOk') };
        const r = await probadores.navegador();
        ultimaNavegador = { ok: true, cuando: Date.now() };
        return { detalle: texto(idioma, r === 'abierto' ? 'navAbierto' : 'navOk') };
      },
      idioma,
      // Lanzar Chromium la primera vez tarda más que lo demás.
      Math.max(config.diagnostico.timeoutMs, 20000)
    ),
    comprobar(
      'proxy_salida',
      async () => {
        if (!config.outboundProxy) return { detalle: texto(idioma, 'sinProxy') };
        const r = await probadores.proxy();
        if (r.ok) return { detalle: texto(idioma, 'proxyOk', { ms: r.ms ?? '—' }) };
        return { ok: false, detalle: texto(idioma, 'proxyMal', { error: r.error || '—' }) };
      },
      idioma
    ),
    comprobar(
      'gestor_descargas',
      async () => {
        const { url } = await jd.ajustes();
        if (!url) return { detalle: texto(idioma, 'jdSin') };
        const r = await jd.probar(url);
        return r.ok ? { detalle: texto(idioma, 'jdOk') } : { ok: false, detalle: r.error };
      },
      idioma
    ),
  ];
  const { conexiones = [] } = await crew.datos().catch(() => ({}));
  for (const c of conexiones) {
    lista.push(
      comprobar(
        `conexion:${c.app}`,
        async () => {
          if (c.activa === false) return { detalle: texto(idioma, 'conInactiva') };
          const r = await crew.probar(c.app, c.url, c.api_key);
          return r.ok
            ? { detalle: texto(idioma, 'conOk', { version: `${c.app} ${r.version || '?'}` }) }
            : { ok: false, detalle: r.error };
        },
        idioma
      )
    );
  }
  return Promise.all(lista);
}

/** GET /api/diagnostico */
async function diagnostico({ idioma = 'es' } = {}) {
  const lista = await comprobaciones(idioma);
  // Si se navegador falló, que la próxima vez se pruebe de nuevo.
  if (!lista.find(c => c.nombre === 'navegador')?.ok) ultimaNavegador = null;
  return {
    app: 'clipscout',
    version,
    arranque: ARRANQUE,
    estado: lista.every(c => c.ok) ? 'ok' : 'degradado',
    comprobaciones: lista,
    ultimos_errores: errores.ultimos(),
  };
}

/* ── Salud (sin sesión) ──────────────────────────────────────────────── */

let saludCache = null; // {r, hasta}
/** GET /api/salud: {ok, app, version}; ok:false si los ajustes o la carpeta de datos fallan. */
async function salud() {
  if (saludCache && Date.now() < saludCache.hasta) return saludCache.r;
  let ok = true;
  try {
    await conTiempo(Promise.all([ajustesLegibles(), carpetaEscribible()]), 5000);
  } catch {
    ok = false;
  }
  const r = { ok, app: 'clipscout', version };
  saludCache = { r, hasta: Date.now() + 10 * 1000 };
  return r;
}

/* ── Informe para el soporte ─────────────────────────────────────────── */

const EXTENSIONES =
  'mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|mpg|mpeg|jpg|jpeg|png|gif|webp|json|jsonl|log|txt|zip|crawljob|html|part';
const RE_FICHERO_ENTRE = new RegExp(`([«"'“])[^«»"'“”\\n]*\\.(?:${EXTENSIONES})([»"'”])`, 'gi');
const RE_FICHERO = new RegExp(
  `(^|[\\s"'(=])(?![a-z]+:\\/\\/)[^\\s"'<>|()]*\\.(?:${EXTENSIONES})(?=$|[\\s"',)])`,
  'gim'
);

/**
 * Quita lo que no debe salir del equipo (SU-11): rutas absolutas → `<ruta>`, nombres de fichero
 * → `<fichero>`, claves y testigos → `<clave>`, usuario y contraseña de una URL → `<clave>`.
 * Pura, para probarla.
 */
function anonimizar(textoOriginal) {
  return (
    String(textoOriginal)
      // Usuario:contraseña dentro de una URL (el proxy de salida, por ejemplo).
      .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1<clave>@')
      // Claves de conexión, de administración (hex largo) y testigos de sesión.
      .replace(/cgc_[A-Za-z0-9_-]+/g, '<clave>')
      .replace(/\b[a-f0-9]{32,}\b/gi, '<clave>')
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<clave>')
      .replace(
        /((?:api[_-]?key|clave|token|testigo|password|contrase(?:ñ|n)a)["'=:\s]+)[^\s"',}]+/gi,
        '$1<clave>'
      )
      // De una URL se queda el sitio; el camino puede llevar nombres de fichero o lo buscado.
      .replace(/\b(https?:\/\/[^/\s"'<>]+)\/[^\s"'<>)]*/gi, '$1/<ruta>')
      // Nombres de fichero entre comillas (pueden llevar espacios) y sueltos.
      .replace(RE_FICHERO_ENTRE, '$1<fichero>$2')
      .replace(RE_FICHERO, '$1<fichero>')
      // Rutas absolutas de Linux/macOS (no las de la API) y de Windows.
      .replace(/(^|[\s"'(=])\/(?!api\/|<)[^\s"')]+/g, '$1<ruta>')
      .replace(/\b[A-Za-z]:\\[^\s"']*/g, '<ruta>')
  );
}

/** Zip con `diagnostico.json` y `registro.txt` (las últimas 2.000 líneas), todo anonimizado. */
async function informe({ idioma = 'es' } = {}) {
  const diag = await diagnostico({ idioma });
  const lineas = registro.ultimas(2000).map(anonimizar);
  const json = anonimizar(JSON.stringify(diag, null, 2));
  return zip.crear([
    { nombre: 'diagnostico.json', datos: Buffer.from(json) },
    { nombre: 'registro.txt', datos: Buffer.from(`${lineas.join('\n')}\n`) },
  ]);
}

function _reiniciar() {
  ultimaNavegador = null;
  saludCache = null;
}

module.exports = {
  diagnostico,
  salud,
  informe,
  anonimizar,
  probadores,
  conTiempo,
  TiempoAgotado,
  _reiniciar,
};
