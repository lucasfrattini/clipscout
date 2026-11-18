'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { crearAlmacen } = require('../lib/almacen');
const { claveEnlace } = require('../lib/url');
const crew = require('./crew');
const fondo = require('./busquedasFondo');
const jd = require('./jdownloader');
const filtrosGlobales = require('./filtrosGlobales');
const estadisticas = require('./estadisticas');
const { palabras, textoDe, contieneAlguna, bloqueadaPor } = require('../lib/filtros');

/**
 * Búsquedas programadas: una búsqueda guardada que se repite sola cada N días y manda a
 * JDownloader SOLO lo nuevo — lo que no se mandó ya en una vuelta anterior y lo que clipkeeper
 * no tiene.
 *
 * Se guardan en data/crew.json (`programadas`). Lo ya enviado va en su PROPIO fichero
 * (data/programadas-enviados.json: por búsqueda, con tope), no junto a la contraseña y las
 * claves: es estado de trabajo que crece, y crew.json se lee varias veces por petición. Se guarda
 * la identidad del enlace (`claveEnlace`), no el texto: la misma ficha escrita de otra forma no
 * se vuelve a mandar. Empieza vacío: el usuario las da de alta en Ajustes.
 *
 * Cada vuelta es una búsqueda normal en segundo plano (busquedasFondo): se ve en la cola de Buscar
 * como cualquier otra y respeta el mismo tope de búsquedas a la vez: si no hay hueco, espera en
 * la cola.
 */

const CADA_MS = 5 * 60 * 1000; // cada cuánto se mira si toca alguna
const MAX_ENVIADOS = 5000; // enlaces recordados por búsqueda
const MAX_PROGRAMADAS = 100;

let enCurso = null; // id de la programada que se está ejecutando (una a la vez)

const almacenEnviados = crearAlmacen(
  () => path.join(config.datos.dir, 'programadas-enviados.json'),
  () => ({ version: 1, porBusqueda: {} })
);

/**
 * Hasta 2.16 lo enviado vivía en crew.json (`programadasEnviados`): se pasa a su fichero y se
 * quita de crew.json. Idempotente (une lo que haya), y en este orden — primero se escribe el
 * fichero nuevo, luego se borra lo viejo —, así que un corte a medias no pierde nada. Vuelve a
 * servir si se restaura una copia de seguridad antigua.
 */
async function migrarEnviados() {
  const viejos = (await crew.datos()).programadasEnviados;
  if (!viejos || typeof viejos !== 'object') return 0;
  await almacenEnviados.cambiar(e => {
    e.porBusqueda = e.porBusqueda || {};
    for (const [id, lista] of Object.entries(viejos)) {
      if (!Array.isArray(lista)) continue;
      const union = new Set([...lista.map(claveEnlace), ...(e.porBusqueda[id] || [])]);
      e.porBusqueda[id] = [...union].slice(-MAX_ENVIADOS);
    }
  });
  await crew.cambiar(d => {
    delete d.programadasEnviados;
  });
  logger.info(`Programadas: lo ya enviado pasa a programadas-enviados.json`);
  return Object.keys(viejos).length;
}

async function enviadosDe(id) {
  await migrarEnviados();
  const { porBusqueda = {} } = await almacenEnviados.leer();
  return new Set(porBusqueda[id] || []);
}

function limpiar(entrada = {}, anterior = {}) {
  const texto = (v, max = 200) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const termino = texto(entrada.termino ?? anterior.termino);
  if (!termino) throw new crew.ErrorCrew('Escribe qué buscar.');
  const numero = (v, def, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  return {
    id: anterior.id || crypto.randomUUID(),
    termino,
    carpeta: texto(entrada.carpeta ?? anterior.carpeta),
    persona: texto(entrada.persona ?? anterior.persona),
    etiqueta: texto(entrada.etiqueta ?? anterior.etiqueta),
    minutosMinimo: numero(entrada.minutosMinimo ?? anterior.minutosMinimo, 0, 0, 600),
    sinDuracion: Boolean(entrada.sinDuracion ?? anterior.sinDuracion ?? false),
    contener: texto(entrada.contener ?? anterior.contener, 500),
    excluir: texto(entrada.excluir ?? anterior.excluir, 500),
    cadaDias: numero(entrada.cadaDias ?? anterior.cadaDias, 7, 1, 90),
    // «También en toda la web»: desactivada salvo que se marque (las guardadas antes, igual).
    abierta: Boolean(entrada.abierta ?? anterior.abierta ?? false),
    activa: Boolean(entrada.activa ?? anterior.activa ?? true),
    ultimaVez: anterior.ultimaVez || null,
    ultimo: anterior.ultimo || null,
  };
}

async function listar() {
  const d = await crew.datos();
  return { programadas: d.programadas || [], enCurso };
}

async function guardar(entrada) {
  return crew.cambiar(d => {
    d.programadas = d.programadas || [];
    const i = entrada.id ? d.programadas.findIndex(p => p.id === entrada.id) : -1;
    if (i < 0 && d.programadas.length >= MAX_PROGRAMADAS) {
      throw new crew.ErrorCrew(`Como mucho ${MAX_PROGRAMADAS} búsquedas programadas.`);
    }
    const p = limpiar(entrada, i >= 0 ? d.programadas[i] : {});
    if (i >= 0) d.programadas[i] = p;
    else d.programadas.push(p);
    return p;
  });
}

async function quitar(id) {
  return crew
    .cambiar(d => {
      d.programadas = (d.programadas || []).filter(p => p.id !== id);
      if (d.programadasEnviados) delete d.programadasEnviados[id];
      return { ok: true };
    })
    .then(async r => {
      await almacenEnviados.cambiar(e => {
        if (e.porBusqueda) delete e.porBusqueda[id];
      });
      return r;
    });
}

/**
 * Qué resultados se mandan. Pura, para poder probarla: no sabe nada de red.
 *
 * Un VÍDEO se manda una vez: se comparan enlaces por su identidad (`claveEnlace`: misma ficha
 * con o sin «www.», barra final, parámetros de seguimiento…) y, con `grupos` (los repetidos que
 * la búsqueda detectó: el mismo vídeo en varios sitios o fichas), de cada grupo sale solo el
 * primero que pasa los filtros. Si cualquier miembro del grupo se mandó en una vuelta anterior
 * (`yaEnviados`, claves), no se manda ninguno.
 *
 * Devuelve los elegidos (con `claves`: todo lo que hay que recordar como enviado al mandarlo) y
 * cuántos se descartaron y por qué.
 */
function filtrar(
  items,
  prog,
  yaEnviados = new Set(),
  bloqueadas = filtrosGlobales.bloqueadas(),
  grupos = []
) {
  const contener = palabras(prog.contener);
  const excluir = palabras(prog.excluir);
  const minimo = (prog.minutosMinimo || 0) * 60;
  const enviados = new Set([...yaEnviados].map(claveEnlace));
  // Grupo de cada enlace (por la url del resultado), y todas las claves de cada grupo (también
  // las de las fichas, que es lo que se manda).
  const grupoDe = new Map();
  (Array.isArray(grupos) ? grupos : []).forEach((g, i) => {
    for (const u of g?.miembros || []) grupoDe.set(claveEnlace(u), i);
  });
  const enlaceDe = it => it?.sourceUrl || it?.url;
  const grupoDeItem = it =>
    grupoDe.get(claveEnlace(it?.url)) ?? grupoDe.get(claveEnlace(enlaceDe(it)));
  const clavesGrupo = new Map();
  for (const it of items) {
    const g = grupoDeItem(it);
    if (g === undefined || !enlaceDe(it)) continue;
    if (!clavesGrupo.has(g)) clavesGrupo.set(g, new Set());
    clavesGrupo.get(g).add(claveEnlace(enlaceDe(it)));
    if (it.url) clavesGrupo.get(g).add(claveEnlace(it.url));
  }
  const vistos = new Set();
  const gruposElegidos = new Set();
  const elegidos = [];
  const descartes = {
    repetido: 0,
    enviado: 0,
    duracion: 0,
    contener: 0,
    excluir: 0,
    bloqueada: 0,
  };
  for (const it of items) {
    const link = enlaceDe(it);
    const clave = link ? claveEnlace(link) : '';
    const g = link ? grupoDeItem(it) : undefined;
    if (!link || vistos.has(clave) || (g !== undefined && gruposElegidos.has(g))) {
      descartes.repetido += 1;
      continue;
    }
    vistos.add(clave);
    const claves = g === undefined ? [clave] : [...clavesGrupo.get(g)];
    if (claves.some(k => enviados.has(k))) {
      descartes.enviado += 1;
      continue;
    }
    const d = it.durationSeconds;
    if (Number.isFinite(d) ? d < minimo : !prog.sinDuracion && minimo > 0) {
      descartes.duracion += 1;
      continue;
    }
    // Las palabras bloqueadas de Ajustes mandan sobre todo lo demás: se cuentan aparte para que
    // el resumen diga por qué no se mandó.
    if (bloqueadaPor(it, bloqueadas)) {
      descartes.bloqueada += 1;
      continue;
    }
    const texto = textoDe({ ...it, sourceUrl: link });
    if (contieneAlguna(texto, excluir)) {
      descartes.excluir += 1;
      continue;
    }
    if (contener.length && !contieneAlguna(texto, contener)) {
      descartes.contener += 1;
      continue;
    }
    if (g !== undefined) gruposElegidos.add(g);
    elegidos.push({ link, item: it, claves });
  }
  return { elegidos, descartes };
}

/** Lanza la búsqueda en segundo plano y espera a que acabe. Devuelve sus resultados. */
function buscar(termino, carpeta = '', abierta = false) {
  // Pasa por la misma cola que las búsquedas a mano: si hay otras en marcha, espera su turno.
  const id = fondo.iniciar(
    { q: termino, web: true, abierta: abierta === true },
    { carpeta, origen: 'programada' }
  );
  return new Promise(resolver => {
    const items = [];
    let grupos = [];
    let error = null;
    let baja = null;
    let terminado = false;
    const acabar = () => {
      if (terminado) return;
      terminado = true;
      baja?.();
      resolver({ items, grupos, error });
    };
    baja = fondo.suscribir(id, 0, e => {
      if (e.type === 'resultados') items.push(...(e.items || []));
      // Los repetidos (mismo vídeo en varios sitios) llegan al final, antes del `fin`.
      else if (e.type === 'duplicados') grupos = e.grupos || [];
      // La duración que llega después cuenta para la duración mínima.
      else if (e.type === 'duracion') {
        for (const d of e.items || []) {
          for (const it of items) {
            if (it.url === d.url && !Number.isFinite(it.durationSeconds)) {
              it.durationSeconds = d.durationSeconds;
              it.duration = d.duration;
            }
          }
        }
      } else if (e.type === 'error') error = e.message;
      if (e.type === 'fin' || e.type === 'error') acabar();
    });
    if (terminado) baja?.();
  });
}

/** Quita lo que clipkeeper ya tiene. Si no está conectado o falla, no quita nada. */
async function quitarLoQueTengo(elegidos, persona) {
  const quedan = [];
  let tengo = 0;
  for (let i = 0; i < elegidos.length; i += 200) {
    const tanda = elegidos.slice(i, i + 200);
    const r = await crew
      .buscarEnClipkeeper(
        tanda.map(e => e.item.title || ''),
        tanda.map(e => e.item.durationSeconds ?? null),
        persona
      )
      .catch(() => ({ resultados: [] }));
    const res = r.resultados || [];
    tanda.forEach((e, j) => {
      if (res.length === tanda.length && res[j]?.coincidencias?.length) {
        tengo += 1;
        estadisticas.sumarEnlace(e.link, { yaLoTenias: 1 });
      } else quedan.push(e);
    });
  }
  return { quedan, tengo };
}

/**
 * Lanza una programada. Resuelve en cuanto la búsqueda ha ARRANCADO (o lanza el error: 404, o 409
 * si ya hay demasiadas en marcha), y devuelve `{ terminada }`, la promesa del resumen final.
 */
async function lanzar(id) {
  if (enCurso) throw new crew.ErrorCrew('Ya hay una búsqueda programada en marcha.', 409);
  const d = await crew.datos();
  const prog = (d.programadas || []).find(p => p.id === id);
  if (!prog) throw new crew.ErrorCrew('No existe esa búsqueda programada.', 404);
  if (enCurso) throw new crew.ErrorCrew('Ya hay una búsqueda programada en marcha.', 409);
  let busqueda;
  try {
    busqueda = buscar(prog.termino, prog.carpeta, prog.abierta);
  } catch (error) {
    throw new crew.ErrorCrew(error.message, error.status || 500);
  }
  enCurso = id;
  return { terminada: terminar(id, prog, busqueda) };
}

/** Filtra lo encontrado, lo manda y guarda el resumen en `ultimo`. */
async function terminar(id, prog, busqueda) {
  const fecha = new Date().toISOString();
  let ultimo;
  try {
    const { items, grupos, error } = await busqueda;
    const enviados = await enviadosDe(id);
    const { elegidos, descartes } = filtrar(
      items,
      prog,
      enviados,
      filtrosGlobales.bloqueadas(),
      grupos
    );
    const { quedan, tengo } = await quitarLoQueTengo(elegidos, prog.persona);
    descartes.tengo = tengo;
    let mandados = 0;
    let fallo = error || null;
    if (quedan.length) {
      try {
        const regla =
          prog.persona || prog.etiqueta
            ? {
                personas: prog.persona ? [{ nombre: prog.persona }] : [],
                etiquetas: prog.etiqueta ? [{ nombre: prog.etiqueta, grupo: 'Tipo' }] : [],
              }
            : null;
        for (let i = 0; i < quedan.length; i += 500) {
          const tanda = quedan.slice(i, i + 500);
          await jd.enviar({
            links: tanda.map(e => e.link),
            carpeta: prog.carpeta,
            paquete: prog.termino,
            regla,
          });
          mandados += tanda.length;
          // Todo el grupo cuenta como enviado: en la próxima vuelta no sale por otro sitio.
          tanda.forEach(e => e.claves.forEach(k => enviados.add(k)));
        }
      } catch (e) {
        fallo = e.message;
      }
    }
    ultimo = { fecha, encontrados: items.length, enviados: mandados, descartes, error: fallo };
    await crew.cambiar(datos => {
      const p = (datos.programadas || []).find(x => x.id === id);
      if (p) {
        p.ultimaVez = fecha;
        p.ultimo = ultimo;
      }
    });
    await almacenEnviados.cambiar(e => {
      e.porBusqueda = e.porBusqueda || {};
      e.porBusqueda[id] = [...enviados].slice(-MAX_ENVIADOS);
    });
    logger.info(`Programada «${prog.termino}»: ${items.length} resultados, ${mandados} enviados`);
  } finally {
    enCurso = null;
  }
  return ultimo;
}

function toca(p, ahora = Date.now()) {
  if (!p.activa) return false;
  if (!p.ultimaVez) return true;
  return ahora - Date.parse(p.ultimaVez) >= p.cadaDias * 86400000;
}

/** Mira si toca alguna y ejecuta la más atrasada. Una por vuelta. */
async function comprobar() {
  if (enCurso) return;
  const { programadas = [] } = await crew.datos();
  const pendiente = programadas
    .filter(p => toca(p))
    .sort((a, b) => (a.ultimaVez || '').localeCompare(b.ultimaVez || ''))[0];
  if (!pendiente) return;
  try {
    await (
      await lanzar(pendiente.id)
    ).terminada;
  } catch (error) {
    // 409: la cola está llena (o ya hay otra programada). Se reintenta en la próxima vuelta.
    if (error.status !== 409) logger.warn(`Programada «${pendiente.termino}»: ${error.message}`);
  }
}

let reloj = null;
function arrancar() {
  if (reloj) return;
  migrarEnviados().catch(error => logger.warn(`Programadas: ${error.message}`));
  reloj = setInterval(() => {
    comprobar().catch(error => logger.warn(`Búsquedas programadas: ${error.message}`));
  }, CADA_MS);
  reloj.unref?.();
}

module.exports = {
  listar,
  guardar,
  quitar,
  lanzar,
  filtrar,
  toca,
  comprobar,
  arrancar,
  migrarEnviados,
  enviadosDe,
};
