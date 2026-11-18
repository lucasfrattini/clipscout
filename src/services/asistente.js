'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const config = require('../config');
const acceso = require('./acceso');
const crew = require('./crew');
const { readProfiles } = require('./profiles');
const { isPrivateAddress } = require('../lib/ssrf');
const { escribirTexto } = require('../lib/ficheroJson');

/**
 * Asistente de primer arranque (§2.6, CS-N3; común a las tres apps de Clipgeist).
 *
 * Se muestra SOLO en una instalación nueva: sin usuario, sin sitios guardados y sin conexiones.
 * Una instalación existente (con usuario, o sin él pero ya usada) no lo ve nunca.
 *
 * Detecta las otras apps (variables `CLIPGEIST_<APP>_URL`, conexiones ya hechas, o sus puertos de
 * fábrica en este mismo equipo) para ofrecer «Usar la misma cuenta que…» y conectarlas.
 */

const PUERTOS = { clipscout: 3001, clonbuster: 8095, clipkeeper: 8096 };
const VARIABLES = {
  clipscout: 'CLIPGEIST_CLIPSCOUT_URL',
  clonbuster: 'CLIPGEIST_CLONBUSTER_URL',
  clipkeeper: 'CLIPGEIST_CLIPKEEPER_URL',
};
const ESPERA_MS = 1500;

/** ¿Instalación nueva? Sin usuario, sin sitios y sin conexiones. */
async function esNueva() {
  if (acceso.activo()) return false;
  const [perfiles, datos] = await Promise.all([
    readProfiles().catch(() => [{}]),
    crew.datos().catch(() => ({ conexiones: [{}] })),
  ]);
  return perfiles.length === 0 && (datos.conexiones || []).length === 0;
}

/** Dónde puede estar cada una de las otras apps (sin repetir). */
async function candidatas() {
  const { conexiones = [] } = await crew.datos().catch(() => ({}));
  const sinBuscar = process.env.CLIPGEIST_DETECTAR === 'no';
  return crew.APPS.filter(app => app !== crew.APP).map(app => {
    const conectada = conexiones.find(c => c.app === app && c.activa !== false);
    let url = conectada?.url || String(process.env[VARIABLES[app]] || '').trim();
    if (!url && !sinBuscar) url = `http://127.0.0.1:${PUERTOS[app]}`;
    return { app, url, conectada: Boolean(conectada) };
  });
}

async function pedirJson(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    redirect: 'manual',
    headers: { 'X-Clipgeist': '1', 'Content-Type': 'application/json', ...opciones.headers },
    signal: AbortSignal.timeout(ESPERA_MS * 2),
  });
  return r;
}

/** ¿Responde como app de Clipgeist y tiene usuario? Nunca lanza. */
async function estadoDe(url) {
  try {
    const r = await pedirJson(`${url.replace(/\/+$/, '')}/api/auth/estado`, {
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) return { responde: false };
    const e = await r.json();
    // clipscout dice `protegido`; clonbuster y clipkeeper, `configurado`.
    if (!('protegido' in e) && !('configurado' in e)) return { responde: false };
    return { responde: true, tieneUsuario: e.protegido === true || e.configurado === true };
  } catch {
    return { responde: false };
  }
}

/**
 * Las otras apps que responden. `conUrl`: solo con sesión (o sin usuario desde este equipo); a un
 * desconocido no se le dice dónde están.
 */
async function detectar({ conUrl = false } = {}) {
  const lista = await candidatas();
  const estados = await Promise.all(
    lista.map(c => (c.url ? estadoDe(c.url) : { responde: false }))
  );
  return lista
    .map((c, i) => ({ ...c, ...estados[i] }))
    .filter(c => c.responde)
    .map(c => ({
      app: c.app,
      tieneUsuario: Boolean(c.tieneUsuario),
      conectada: c.conectada,
      // Con CLIPGEIST_CLAVE (instalación conjunta) se conectan solas, sin pedir nada.
      automatica: Boolean(crew.claveEntorno()),
      ...(conUrl ? { url: c.url } : {}),
    }));
}

/**
 * «Usar la misma cuenta que <app>»: se entra en la otra app con lo que ha tecleado el usuario
 * (su login normal) y, si vale, se cierra esa sesión enseguida. Nunca se copian resúmenes de
 * contraseñas: aquí se crea el mismo usuario con la contraseña tecleada.
 */
async function validarCuentaEn(app, usuario, contrasena) {
  const destino = (await candidatas()).find(c => c.app === app);
  if (!destino?.url) throw new crew.ErrorCrew(`No se encuentra ${app} en este equipo.`, 404);
  const base = destino.url.replace(/\/+$/, '');
  let r;
  try {
    r = await pedirJson(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ usuario, contrasena }),
    });
  } catch {
    throw new crew.ErrorCrew(`${app} no responde.`, 502);
  }
  if (r.status === 429) throw new crew.ErrorCrew(`${app}: demasiados intentos.`, 429);
  if (!r.ok) return false;
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (cookie) {
    await pedirJson(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
      .then(x => x.body?.cancel?.())
      .catch(() => {});
  }
  return true;
}

const enDocker = () => fs.existsSync('/.dockerenv');

/**
 * «Úsalo desde el móvil»: direcciones de esta app en la red local. El puerto es el de la
 * petición (en Docker, el publicado, no el 3000 de dentro). Dentro de Docker las IP de las
 * interfaces son las del contenedor y no sirven: solo vale la que ya se está usando.
 */
function direcciones(req) {
  const host = String(req.get('host') || '');
  const puerto = (host.match(/:(\d+)$/) || [])[1] || String(config.port);
  const nombre = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const ips = new Set();
  if (net.isIP(nombre) && isPrivateAddress(nombre) && !/^127\.|^::1$/.test(nombre)) {
    ips.add(nombre);
  }
  if (!enDocker()) {
    // Sin las interfaces virtuales (Docker, puentes, VPN de contenedores): no las ve el móvil.
    for (const [nombreIf, lista] of Object.entries(os.networkInterfaces())) {
      if (/^(docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|tun|tap)/i.test(nombreIf)) {
        continue;
      }
      for (const i of lista || []) {
        if (i.family === 'IPv4' && !i.internal && isPrivateAddress(i.address)) ips.add(i.address);
      }
    }
  }
  // Las de casa primero (192.168, 10.), y como mucho tres.
  const orden = ip => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : 2);
  const elegidas = [...ips].sort((a, b) => orden(a) - orden(b)).slice(0, 3);
  const soloLocal = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  return {
    direcciones: elegidas.map(ip => `http://${net.isIPv6(ip) ? `[${ip}]` : ip}:${puerto}/`),
    soloLocal,
    docker: enDocker(),
    // Escritorio: el interruptor «Permitir acceso desde otros dispositivos» (vale al reiniciar).
    escritorio: process.env.CLIPGEIST_LANZADOR === '1',
    red: leerRed(),
  };
}

/* ── «Permitir acceso desde otros dispositivos» (escritorio) ──────────── */

/**
 * El lanzador de escritorio lee `escuchar.txt` («red» o «local») de la carpeta de datos al
 * arrancar. Con la suite instalada (carpeta `suite/` junto a la de datos, o `CLIPGEIST_SUITE=1`)
 * manda el lanzador común, que lee el SUYO: se escribe también allí si existe, o la portada y las
 * demás apps seguirían solo en este equipo.
 */
const ARCHIVO_RED = 'escuchar.txt';
const carpetaSuite = () => path.join(config.datos.dir, '..', 'suite');

function leerRed() {
  try {
    return fs.readFileSync(path.join(config.datos.dir, ARCHIVO_RED), 'utf8').trim() === 'red';
  } catch {
    return !['127.0.0.1', 'localhost', '::1'].includes(config.host);
  }
}

async function cambiarRed(red) {
  if (process.env.CLIPGEIST_LANZADOR !== '1') {
    throw new crew.ErrorCrew('Esto solo se puede cambiar en la versión de escritorio.', 409);
  }
  // Abrir a la red sin usuario dejaría la app abierta a cualquiera de la red (CS-S1).
  if (red && !acceso.activo()) {
    const e = new crew.ErrorCrew(
      'Crea antes un usuario: sin él, cualquiera de la red podría entrar.',
      409
    );
    e.codigo = 'sin_usuario';
    throw e;
  }
  const texto = red ? 'red\n' : 'local\n';
  await escribirTexto(path.join(config.datos.dir, ARCHIVO_RED), texto);
  const suite = carpetaSuite();
  let enSuite = false;
  if (fs.existsSync(suite)) {
    await escribirTexto(path.join(suite, ARCHIVO_RED), texto);
    enSuite = true;
  }
  return { ok: true, red: Boolean(red), suite: enSuite, reiniciar: true };
}

module.exports = {
  esNueva,
  detectar,
  validarCuentaEn,
  direcciones,
  cambiarRed,
  leerRed,
  carpetaSuite,
  PUERTOS,
};
