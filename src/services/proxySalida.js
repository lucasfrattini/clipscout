'use strict';

const net = require('node:net');
const tls = require('node:tls');

const config = require('../config');
const logger = require('../lib/logger');

/**
 * ¿Responde el proxy de salida (OUTBOUND_PROXY)?
 *
 * Si la VPN que hay detrás se cae, cada sitio tardaba en fallar lo que su tiempo máximo (unos
 * 30 s) y la pantalla solo decía «error» sitio a sitio. Aquí se prueba el proxy de verdad: se le
 * pide un túnel (CONNECT) hacia `config.proxySalida.destinoPrueba` con un tiempo máximo corto.
 * Un proxy vivo con la VPN caída suele aceptar la conexión pero no abrir el túnel (502, 504 o
 * silencio): por eso no basta con ver que el puerto acepta.
 *
 * El estado se guarda en memoria y se renueva solo cada `cadaMs` mientras haya proxy. Antes de
 * cada búsqueda se usa `asegurar()`, que reutiliza la última prueba si es reciente.
 */

let estado = {
  configurado: false,
  ok: null, // null = aún sin probar
  comprobado: null,
  ms: null,
  error: '',
  codigo: '',
};
let enCurso = null;
let reloj = null;

/** La dirección del proxy sin usuario ni contraseña (para enseñarla). */
function proxyVisible() {
  return config.outboundProxy ? config.outboundProxy.replace(/\/\/[^@]*@/, '//***@') : '';
}

function configurado() {
  return Boolean(config.outboundProxy);
}

/** Pide el túnel y espera la línea de estado. Resuelve { ok, ms, error, codigo }; nunca lanza. */
function probarUnaVez(timeoutMs) {
  return new Promise(resolve => {
    const inicio = Date.now();
    let url;
    try {
      url = new URL(config.outboundProxy);
    } catch {
      resolve({ ok: false, ms: 0, codigo: 'mal_configurado', error: 'Dirección no válida' });
      return;
    }
    const seguro = url.protocol === 'https:';
    const puerto = Number(url.port) || (seguro ? 443 : 80);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const destino = config.proxySalida.destinoPrueba;
    let terminado = false;
    const fin = r => {
      if (terminado) return;
      terminado = true;
      clearTimeout(tope);
      socket?.destroy();
      resolve({ ms: Date.now() - inicio, error: '', codigo: '', ...r });
    };
    const tope = setTimeout(
      () => fin({ ok: false, codigo: 'tiempo', error: `Sin respuesta en ${timeoutMs / 1000} s` }),
      timeoutMs
    );
    const alConectar = () => {
      const cabeceras = [`CONNECT ${destino} HTTP/1.1`, `Host: ${destino}`];
      if (url.username) {
        const credencial = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
        cabeceras.push(`Proxy-Authorization: Basic ${Buffer.from(credencial).toString('base64')}`);
      }
      socket.write(`${cabeceras.join('\r\n')}\r\n\r\n`);
    };
    const socket = seguro
      ? tls.connect({ host, port: puerto, servername: host }, alConectar)
      : net.connect({ host, port: puerto }, alConectar);
    let recibido = '';
    socket.setEncoding('latin1');
    socket.on('data', trozo => {
      recibido += trozo;
      const linea = recibido.split('\r\n')[0];
      if (!recibido.includes('\r\n') && recibido.length < 512) return;
      const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(linea);
      if (m && m[1].startsWith('2')) {
        fin({ ok: true });
        return;
      }
      fin({
        ok: false,
        codigo: 'tunel',
        error: m ? `El proxy contesta ${m[1]}: no llega a internet` : 'Respuesta no válida',
      });
    });
    socket.on('error', error =>
      fin({
        ok: false,
        codigo: error.code === 'ECONNREFUSED' ? 'rechaza' : 'red',
        error: error.code === 'ECONNREFUSED' ? 'Conexión rechazada' : error.code || error.message,
      })
    );
    socket.on('close', () =>
      fin({ ok: false, codigo: 'cerrado', error: 'El proxy cerró la conexión' })
    );
  });
}

/** Prueba ya (una sola a la vez: si hay una en marcha, se espera a esa). */
async function probar({ timeoutMs = config.proxySalida.timeoutMs } = {}) {
  if (!configurado()) {
    estado = { ...estado, configurado: false, ok: null, error: '', codigo: '' };
    return leer();
  }
  if (!enCurso) {
    enCurso = probarUnaVez(timeoutMs)
      .then(r => {
        const antes = estado.ok;
        estado = { configurado: true, comprobado: new Date().toISOString(), ...r };
        if (antes !== r.ok && (antes !== null || !r.ok)) {
          const log = r.ok ? logger.info : logger.warn;
          log.call(
            logger,
            r.ok ? 'El proxy de salida vuelve a responder' : 'El proxy de salida no responde',
            {
              proxy: proxyVisible(),
              error: r.error,
            }
          );
        }
      })
      .finally(() => {
        enCurso = null;
      });
  }
  await enCurso;
  return leer();
}

/** El último estado, sin probar. `origen`: de dónde sale la dirección (Ajustes o el entorno). */
function leer() {
  return { ...estado, configurado: configurado(), proxy: proxyVisible(), origen };
}

/* ── CS-N11: el proxy desde Ajustes, y la dirección de salida ─────────── */

const ENTORNO = (process.env.NODE_TEST_CONTEXT ? '' : process.env.OUTBOUND_PROXY || '').trim();
let origen = ENTORNO ? 'entorno' : '';

/** Una dirección de proxy válida (http o https, con host), o lanza 400. */
function validarUrl(url) {
  const crew = require('./crew');
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new crew.ErrorCrew('La dirección del proxy no es válida (http://equipo:puerto).');
  }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) {
    throw new crew.ErrorCrew('El proxy tiene que ser http:// o https:// con equipo y puerto.');
  }
  return u.href.replace(/\/$/, '');
}

/** Pone en marcha un proxy (o ninguno) en caliente: agentes, vigilancia y navegador. */
function aplicar(url, nuevoOrigen) {
  require('../lib/http').usarProxy(url);
  origen = url ? nuevoOrigen : '';
  parar();
  estado = {
    configurado: Boolean(url),
    ok: null,
    comprobado: null,
    ms: null,
    error: '',
    codigo: '',
  };
  vigilar();
  // El navegador interno lee el proxy al arrancar: se cierra cuando no haya búsquedas.
  require('./ajustesBusqueda').cerrarNavegadorCuandoLibre();
}

/** Al arrancar: lo guardado en Ajustes manda sobre OUTBOUND_PROXY. */
async function cargarGuardado() {
  const d = await require('./crew').datos();
  const guardado = d.proxySalida;
  if (guardado && typeof guardado.url === 'string') aplicar(guardado.url, 'ajustes');
}

/**
 * PUT /api/ajustes/proxy {url}: guarda y aplica. `url: ''` = sin proxy (aunque el entorno tenga
 * uno); `url: null` = olvidar lo de Ajustes y volver a lo del entorno.
 */
async function guardar({ url } = {}) {
  const crew = require('./crew');
  if (url === null) {
    await crew.cambiar(d => {
      delete d.proxySalida;
    });
    aplicar(ENTORNO, 'entorno');
    return leer();
  }
  const limpia = String(url || '').trim() ? validarUrl(url) : '';
  await crew.cambiar(d => {
    d.proxySalida = { url: limpia, fecha: new Date().toISOString() };
  });
  aplicar(limpia, 'ajustes');
  return leer();
}

/**
 * La dirección con la que se sale a internet AHORA (por el proxy si lo hay): se pregunta a
 * `config.proxySalida.urlIp`. Nunca lanza: `{ip}` o `{error}`.
 */
async function direccionSalida() {
  const url = config.proxySalida.urlIp;
  if (!url) return { ip: '', error: 'sin_servicio' };
  try {
    const { peticionSegura } = require('../lib/http');
    const r = await peticionSegura(url, {
      timeout: config.proxySalida.timeoutMs * 2,
      responseType: 'text',
      maxContentLength: 64 * 1024,
    });
    const texto = String(r.data || '');
    let ip = /(?:^|\n)ip=([0-9a-f.:]+)/i.exec(texto)?.[1] || '';
    if (!ip) {
      try {
        ip = String(JSON.parse(texto).ip || '');
      } catch {
        ip = '';
      }
    }
    return ip ? { ip } : { ip: '', error: 'sin_respuesta' };
  } catch (error) {
    return { ip: '', error: error.message || 'sin_respuesta' };
  }
}

/**
 * Antes de una búsqueda: el estado reciente o una prueba nueva. Sin proxy configurado, `ok`.
 * Con proxy, devuelve `ok: false` solo si la prueba falló (nunca por no haber podido probar).
 */
async function asegurar() {
  if (!configurado()) return { ...leer(), ok: true };
  const edad = estado.comprobado ? Date.now() - Date.parse(estado.comprobado) : Infinity;
  if (estado.ok === null || edad > config.proxySalida.vigenciaMs) await probar();
  return leer();
}

/** Comprueba cada `cadaMs` mientras la app esté en marcha (si hay proxy). */
function vigilar() {
  if (!configurado() || reloj) return;
  probar().catch(() => {});
  reloj = setInterval(() => probar().catch(() => {}), config.proxySalida.cadaMs);
  reloj.unref?.();
}

function parar() {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

/** Para las pruebas: vuelve al estado inicial. */
function _reiniciar() {
  parar();
  estado = { configurado: false, ok: null, comprobado: null, ms: null, error: '', codigo: '' };
}

/** El mensaje que llega a cada sitio que se salta por el proxy caído. */
const ERROR_PROXY = 'proxy_caido';

module.exports = {
  probar,
  leer,
  asegurar,
  vigilar,
  parar,
  configurado,
  guardar,
  cargarGuardado,
  direccionSalida,
  validarUrl,
  ERROR_PROXY,
  _reiniciar,
};
