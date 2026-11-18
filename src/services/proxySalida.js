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

/** El último estado, sin probar. */
function leer() {
  return { ...estado, configurado: configurado(), proxy: proxyVisible() };
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

module.exports = { probar, leer, asegurar, vigilar, parar, configurado, ERROR_PROXY, _reiniciar };
