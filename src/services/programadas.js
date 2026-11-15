'use strict';

const crypto = require('node:crypto');

const logger = require('../lib/logger');
const crew = require('./crew');
const fondo = require('./busquedasFondo');
const jd = require('./jdownloader');
const filtrosGlobales = require('./filtrosGlobales');
const { palabras, textoDe, contieneAlguna, bloqueadaPor } = require('../lib/filtros');

/**
 * Búsquedas programadas: una búsqueda guardada que se repite sola cada N días y manda a
 * JDownloader SOLO lo nuevo — lo que no se mandó ya en una vuelta anterior y lo que clipkeeper
 * no tiene.
 *
 * Se guardan en data/crew.json (`programadas`), con los enlaces ya enviados aparte
 * (`programadasEnviados`, por búsqueda y con tope) para no repetirlos. Empieza vacío: el
 * usuario las da de alta en Ajustes.
 *
 * Cada vuelta es una búsqueda normal en segundo plano (busquedasFondo): se ve en la cola de Buscar
 * como cualquier otra y respeta el mismo tope de búsquedas a la vez: si no hay hueco, espera en
 * la cola.
 */

const CADA_MS = 5 * 60 * 1000; // cada cuánto se mira si toca alguna
const MAX_ENVIADOS = 5000; // enlaces recordados por búsqueda
const MAX_PROGRAMADAS = 100;

let enCurso = null; // id de la programada que se está ejecutando (una a la vez)

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
  return crew.cambiar(d => {
    d.programadas = (d.programadas || []).filter(p => p.id !== id);
    if (d.programadasEnviados) delete d.programadasEnviados[id];
    return { ok: true };
  });
}

/**
 * Qué resultados se mandan. Pura, para poder probarla: no sabe nada de red.
 * Devuelve los elegidos (un elemento por ficha) y cuántos se descartaron y por qué.
 */
function filtrar(items, prog, yaEnviados = new Set(), bloqueadas = filtrosGlobales.bloqueadas()) {
  const contener = palabras(prog.contener);
  const excluir = palabras(prog.excluir);
  const minimo = (prog.minutosMinimo || 0) * 60;
  const vistos = new Set();
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
    const link = it?.sourceUrl || it?.url;
    if (!link || vistos.has(link)) {
      descartes.repetido += 1;
      continue;
    }
    vistos.add(link);
    if (yaEnviados.has(link)) {
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
    elegidos.push({ link, item: it });
  }
  return { elegidos, descartes };
}

/** Lanza la búsqueda en segundo plano y espera a que acabe. Devuelve sus resultados. */
function buscar(termino, carpeta = '') {
  // Pasa por la misma cola que las búsquedas a mano: si hay otras en marcha, espera su turno.
  const id = fondo.iniciar(
    { q: termino, web: true, abierta: true },
    { carpeta, origen: 'programada' }
  );
  return new Promise(resolver => {
    const items = [];
    let error = null;
    let baja = null;
    let terminado = false;
    const acabar = () => {
      if (terminado) return;
      terminado = true;
      baja?.();
      resolver({ items, error });
    };
    baja = fondo.suscribir(id, 0, e => {
      if (e.type === 'resultados') items.push(...(e.items || []));
      else if (e.type === 'error') error = e.message;
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
      if (res.length === tanda.length && res[j]?.coincidencias?.length) tengo += 1;
      else quedan.push(e);
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
    busqueda = buscar(prog.termino, prog.carpeta);
  } catch (error) {
    throw new crew.ErrorCrew(error.message, error.status || 500);
  }
  enCurso = id;
  return { terminada: terminar(id, prog, d, busqueda) };
}

/** Filtra lo encontrado, lo manda y guarda el resumen en `ultimo`. */
async function terminar(id, prog, d, busqueda) {
  const fecha = new Date().toISOString();
  let ultimo;
  try {
    const { items, error } = await busqueda;
    const enviados = new Set((d.programadasEnviados || {})[id] || []);
    const { elegidos, descartes } = filtrar(items, prog, enviados);
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
          const tanda = quedan.slice(i, i + 500).map(e => e.link);
          await jd.enviar({ links: tanda, carpeta: prog.carpeta, paquete: prog.termino, regla });
          mandados += tanda.length;
          tanda.forEach(l => enviados.add(l));
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
      datos.programadasEnviados = datos.programadasEnviados || {};
      datos.programadasEnviados[id] = [...enviados].slice(-MAX_ENVIADOS);
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
  reloj = setInterval(() => {
    comprobar().catch(error => logger.warn(`Búsquedas programadas: ${error.message}`));
  }, CADA_MS);
  reloj.unref?.();
}

module.exports = { listar, guardar, quitar, lanzar, filtrar, toca, comprobar, arrancar };
