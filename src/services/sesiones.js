'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('../config');
const { crearAlmacen } = require('../lib/almacen');

/**
 * Sesiones guardadas en el servidor (común a las tres apps de Clipgeist, ver docs/CREW.md).
 *
 * La cookie `clipgeist_sesion` lleva un testigo opaco `clipscout.<32 bytes base64url>`. Aquí solo
 * se guarda su sha256, con el usuario, cuándo se creó, la última vez que se usó, cuándo caduca y
 * el dispositivo (navegador resumido + IP). Caducan a los 30 días sin usarse: al usarla, si le
 * quedan menos de 15, se alarga otros 30. «Salir» la borra de verdad; cambiar la contraseña borra
 * todas menos la actual.
 *
 * Fichero propio, data/sesiones.json (600). NO entra en las copias de seguridad.
 */

const APP = 'clipscout';
const DIA = 24 * 60 * 60 * 1000;
const DURACION_MS = 30 * DIA;
const RENOVAR_SI_QUEDAN_MS = 15 * DIA;
// La «última vez» cambia en cada petición: se escribe a disco como mucho cada minuto.
const GUARDAR_USO_CADA_MS = 60 * 1000;
const MAX_SESIONES = 200;
const PREFIJOS = ['clipkeeper', 'clipscout', 'clonbuster'];
const TESTIGO = /^(clipkeeper|clipscout|clonbuster)\.([A-Za-z0-9_-]{43})$/;

const almacen = crearAlmacen(
  () => path.join(config.datos.dir, 'sesiones.json'),
  () => ({ version: 1 }),
  { copia: false }
);

let memoria = null; // copia en memoria de data/sesiones.json
let cargando = null;
let ultimoGuardado = 0;

const sha = texto => crypto.createHash('sha256').update(String(texto)).digest('hex');

async function cargar() {
  if (memoria) return memoria;
  if (!cargando) {
    cargando = almacen.cambiar(d => {
      d.version = 1;
      d.sesiones = Array.isArray(d.sesiones) ? d.sesiones : [];
      d.canjeadas = Array.isArray(d.canjeadas) ? d.canjeadas : [];
      // Primera vez con sesiones en el servidor: desde aquí cuentan las cookies antiguas.
      if (!d.desde) d.desde = new Date().toISOString();
      return d;
    });
    cargando.then(
      d => {
        memoria = d;
      },
      () => {
        cargando = null;
      }
    );
  }
  await cargando;
  return memoria;
}

/** Escribe lo que hay en memoria (en serie con el resto de escrituras). */
function guardar() {
  ultimoGuardado = Date.now();
  const copia = JSON.parse(JSON.stringify(memoria));
  return almacen.cambiar(d => {
    Object.keys(d).forEach(k => delete d[k]);
    Object.assign(d, copia);
  });
}

function podar(d) {
  const ahora = Date.now();
  d.sesiones = d.sesiones.filter(s => Date.parse(s.caduca) > ahora);
  d.canjeadas = d.canjeadas.filter(c => c.hasta > ahora);
  if (d.sesiones.length > MAX_SESIONES) {
    d.sesiones.sort((a, b) => Date.parse(b.ultima) - Date.parse(a.ultima));
    d.sesiones.length = MAX_SESIONES;
  }
}

/** «Firefox en Windows», «Chrome en Android»…: lo justo para reconocer el dispositivo. */
function resumirAgente(ua = '') {
  const texto = String(ua);
  const navegador =
    [
      ['Edge', /Edg\//],
      ['Opera', /OPR\//],
      ['Firefox', /Firefox\//],
      ['Chrome', /Chrome\//],
      ['Safari', /Safari\//],
    ].find(([, re]) => re.test(texto))?.[0] || (texto ? texto.slice(0, 40) : '?');
  const sistema =
    [
      ['Android', /Android/],
      ['iPhone', /iPhone/],
      ['iPad', /iPad/],
      ['Windows', /Windows/],
      ['macOS', /Mac OS X/],
      ['Linux', /Linux/],
    ].find(([, re]) => re.test(texto))?.[0] || '';
  return sistema ? `${navegador} · ${sistema}` : navegador;
}

/** Sesión nueva. Devuelve el testigo para la cookie (lo único que nunca se guarda). */
async function crear({ usuario, agente = '', ip = '' }) {
  const d = await cargar();
  const testigo = `${APP}.${crypto.randomBytes(32).toString('base64url')}`;
  const ahora = new Date();
  d.sesiones.push({
    id: sha(testigo),
    usuario,
    creada: ahora.toISOString(),
    ultima: ahora.toISOString(),
    caduca: new Date(ahora.getTime() + DURACION_MS).toISOString(),
    dispositivo: resumirAgente(agente),
    ip: String(ip || '').slice(0, 64),
  });
  podar(d);
  await guardar();
  return testigo;
}

/** Qué app emitió el testigo (o null si no tiene la forma de un testigo de Clipgeist). */
function appDe(testigo) {
  const m = TESTIGO.exec(String(testigo || ''));
  return m ? m[1] : null;
}

/**
 * La sesión de ese testigo propio, o null. Apunta el uso y, si le quedan menos de 15 días, la
 * alarga otros 30 (`renovada: true`: hay que volver a mandar la cookie con la nueva caducidad).
 */
async function validar(testigo, { ip } = {}) {
  if (appDe(testigo) !== APP) return null;
  const d = await cargar();
  const id = sha(testigo);
  const s = d.sesiones.find(x => x.id === id);
  if (!s) return null;
  const ahora = Date.now();
  if (Date.parse(s.caduca) <= ahora) return null;
  s.ultima = new Date(ahora).toISOString();
  if (ip) s.ip = String(ip).slice(0, 64);
  let renovada = false;
  if (Date.parse(s.caduca) - ahora < RENOVAR_SI_QUEDAN_MS) {
    s.caduca = new Date(ahora + DURACION_MS).toISOString();
    renovada = true;
  }
  if (renovada || ahora - ultimoGuardado > GUARDAR_USO_CADA_MS) await guardar();
  return { ...s, renovada };
}

const publica = (s, actual) => ({
  id: s.id.slice(0, 16),
  usuario: s.usuario,
  dispositivo: s.dispositivo,
  ip: s.ip,
  creada: s.creada,
  ultima: s.ultima,
  caduca: s.caduca,
  esta: Boolean(actual && s.id === actual),
});

/** Las abiertas, la más reciente primero. `actual`: el testigo de quien pregunta. */
async function listar(actual) {
  const d = await cargar();
  podar(d);
  const idActual = actual ? sha(actual) : null;
  return d.sesiones
    .slice()
    .sort((a, b) => Date.parse(b.ultima) - Date.parse(a.ultima))
    .map(s => publica(s, idActual));
}

/** Cierra por testigo (salir) o por el id corto que da `listar`. */
async function cerrar({ testigo, id } = {}) {
  const d = await cargar();
  const antes = d.sesiones.length;
  if (testigo) {
    const h = sha(testigo);
    d.sesiones = d.sesiones.filter(s => s.id !== h);
  } else if (id && /^[0-9a-f]{16}$/.test(String(id))) {
    d.sesiones = d.sesiones.filter(s => !s.id.startsWith(id));
  }
  if (d.sesiones.length === antes) return false;
  await guardar();
  return true;
}

/** Todas menos la de `salvo` (testigo). */
async function cerrarTodas({ salvo } = {}) {
  const d = await cargar();
  const h = salvo ? sha(salvo) : null;
  const antes = d.sesiones.length;
  d.sesiones = d.sesiones.filter(s => s.id === h);
  await guardar();
  return antes - d.sesiones.length;
}

/* ── Cookies firmadas de antes (2.17 y anteriores) ──────────────────── */

/**
 * ¿Se puede canjear esta cookie antigua? Solo una vez, y solo las emitidas antes de pasar a
 * sesiones en el servidor (caducaban a los 30 días como mucho). Para varias peticiones que llegan
 * a la vez con la misma cookie (una página carga varias cosas), hay un margen de 2 minutos en el
 * que la ya canjeada sigue valiendo sin crear otra sesión.
 * Devuelve 'canjear' | 'margen' | 'no'.
 */
async function estadoAntigua(cookie, caducaSegundos) {
  const d = await cargar();
  const desde = Date.parse(d.desde);
  if (caducaSegundos * 1000 > desde + DURACION_MS + 60 * 60 * 1000) return 'no';
  const h = sha(`antigua|${cookie}`);
  const previa = d.canjeadas.find(c => c.h === h);
  if (!previa) return 'canjear';
  return Date.now() - previa.en < 2 * 60 * 1000 ? 'margen' : 'no';
}

async function marcarCanjeada(cookie, caducaSegundos) {
  const d = await cargar();
  d.canjeadas.push({ h: sha(`antigua|${cookie}`), en: Date.now(), hasta: caducaSegundos * 1000 });
  podar(d);
  await guardar();
}

/** Solo tests: olvidar lo que hay en memoria (para simular un reinicio). */
function _reiniciar() {
  memoria = null;
  cargando = null;
}

module.exports = {
  APP,
  PREFIJOS,
  DURACION_MS,
  crear,
  validar,
  listar,
  cerrar,
  cerrarTodas,
  appDe,
  estadoAntigua,
  marcarCanjeada,
  resumirAgente,
  _reiniciar,
};
