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
const { elegir } = require('../lib/recoger');

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
const MAX_MANDADOS = 20; // lo mandado en la última vuelta que se recuerda (títulos y enlaces)

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

const MAX_ALIAS = 5;

/** Alias distintos del término (sin repetir por mayúsculas o tildes), como mucho `MAX_ALIAS`. */
function limpiarAlias(lista, termino = '') {
  const clave = s =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const vistos = new Set([clave(termino)]);
  const fuera = [];
  for (const a of Array.isArray(lista) ? lista : []) {
    const texto = String(a || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const k = clave(texto);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    fuera.push(texto);
  }
  return fuera.slice(0, MAX_ALIAS);
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
    // «Recoger» (CS-N1): como mucho N por vuelta (0 = todo lo nuevo, como antes), solo lo que
    // lleva el nombre y en qué orden se eligen. Las de antes no los tienen y no cambian.
    n: numero(entrada.n ?? anterior.n, 0, 0, 200),
    soloConNombre: Boolean(entrada.soloConNombre ?? anterior.soloConNombre ?? false),
    orden: ['largos', 'calidad'].includes(entrada.orden ?? anterior.orden)
      ? (entrada.orden ?? anterior.orden)
      : null,
    // «También en toda la web»: desactivada salvo que se marque (las guardadas antes, igual).
    abierta: Boolean(entrada.abierta ?? anterior.abierta ?? false),
    // Fase 7: alias de la persona (NU-4: se buscan también y valen para «lleva el nombre»), la
    // biblioteca de clipkeeper de la carpeta (para lo esperado, C2) y si la creó «Seguir» (C4).
    alias: limpiarAlias(entrada.alias ?? anterior.alias, termino),
    bibliotecaId: Number.isInteger(Number(entrada.bibliotecaId ?? anterior.bibliotecaId))
      ? Number(entrada.bibliotecaId ?? anterior.bibliotecaId)
      : null,
    seguida: Boolean(entrada.seguida ?? anterior.seguida ?? false),
    activa: Boolean(entrada.activa ?? anterior.activa ?? true),
    ultimaVez: anterior.ultimaVez || null,
    ultimo: anterior.ultimo || null,
    ...(anterior.enCurso ? { enCurso: anterior.enCurso } : {}),
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
 * Qué resultados se mandan: la misma función de elección que «Recoger» (CS-04, `lib/recoger.js`).
 * Pura, para poder probarla: no sabe nada de red.
 *
 * Un VÍDEO se manda una vez (misma ficha escrita de otra forma, o el mismo vídeo en varios sitios:
 * de cada grupo sale uno) y nada de lo enviado en una vuelta anterior (`yaEnviados`, claves). Las
 * programadas de «Recoger» (`n`) además: solo lo que lleva el nombre, las más largas (o de más
 * calidad) primero y como mucho `n` (el corte lo hace `terminar`, tras quitar lo que ya tengo).
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
  return elegir(items, {
    nombre: prog.persona || prog.termino,
    alias: prog.alias || [],
    soloConNombre: Boolean(prog.soloConNombre),
    // Sin `orden` (las de antes), el de la búsqueda.
    orden: prog.orden || null,
    minutosMinimo: prog.minutosMinimo,
    sinDuracion: prog.sinDuracion,
    contener: prog.contener,
    excluir: prog.excluir,
    bloqueadas,
    yaEnviados,
    grupos,
  });
}

/** Pone la búsqueda en la cola de fondo (la misma que las búsquedas a mano). Devuelve su id. */
function iniciarBusqueda(termino, carpeta = '', abierta = false, alias = []) {
  return fondo.iniciar(
    {
      q: termino,
      web: true,
      abierta: abierta === true,
      ...(alias.length ? { alias } : {}),
    },
    { carpeta, origen: 'programada' }
  );
}

/**
 * Espera a que acabe la búsqueda `id` y devuelve sus resultados. Se suscribe desde el primer
 * evento: una búsqueda retomada tras un reinicio trae también lo que encontró antes del corte.
 */
function esperarBusqueda(id) {
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
    // La búsqueda ya no existe (caducó): termina sin resultados.
    if (baja === null) acabar();
    if (terminado) baja?.();
  });
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
  let idBusqueda;
  try {
    // Pasa por la misma cola que las búsquedas a mano: si hay otras en marcha, espera su turno.
    idBusqueda = iniciarBusqueda(prog.termino, prog.carpeta, prog.abierta, prog.alias || []);
  } catch (error) {
    throw new crew.ErrorCrew(error.message, error.status || 500);
  }
  enCurso = id;
  // CS-03: se anota qué búsqueda es, para recoger su resultado aunque la app se reinicie a medias
  // (antes se retomaba la búsqueda pero nadie la recogía, y a los 5 minutos se lanzaba otra).
  await crew
    .cambiar(d => {
      const p = (d.programadas || []).find(x => x.id === id);
      if (p) p.enCurso = { busqueda: idBusqueda, desde: new Date().toISOString() };
    })
    .catch(error => logger.warn(`Programada «${prog.termino}»: ${error.message}`));
  return { terminada: terminar(id, prog, esperarBusqueda(idBusqueda)) };
}

/**
 * CS-03: al arrancar, las programadas que estaban en marcha. Si su búsqueda sigue (se retomó del
 * disco, o terminó justo antes del corte), se vuelve a esperar y se trata su resultado como
 * siempre; si ya no existe, se olvida la marca y se lanzará cuando le toque.
 */
async function reenganchar() {
  await fondo.restaurado();
  const { programadas = [] } = await crew.datos();
  const existe = new Set(fondo.lista().map(b => b.id));
  for (const prog of programadas.filter(p => p.enCurso)) {
    if (!enCurso && existe.has(prog.enCurso.busqueda)) {
      enCurso = prog.id;
      logger.info(`Programada «${prog.termino}»: se recoge la búsqueda retomada tras el reinicio`);
      terminar(prog.id, prog, esperarBusqueda(prog.enCurso.busqueda)).catch(error =>
        logger.warn(`Programada «${prog.termino}»: ${error.message}`)
      );
    } else {
      await crew.cambiar(d => {
        const p = (d.programadas || []).find(x => x.id === prog.id);
        if (p && (!enCurso || enCurso !== p.id)) delete p.enCurso;
      });
    }
  }
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
    // `n` (las de «Recoger»): como mucho N, contados después de quitar lo que ya tengo.
    const { quedan, tengo, papelera } = await require('./recoger').quitarLoQueTengo(
      elegidos,
      prog.persona || (prog.n ? prog.termino : ''),
      prog.n || 0
    );
    descartes.tengo = tengo;
    if (papelera) descartes.papelera = papelera;
    let mandados = 0;
    const lista = []; // lo mandado en esta vuelta (para el aviso y «Seguidas»)
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
            titulos: tanda.map(e => e.item.title || ''),
            duraciones: tanda.map(e => e.item.durationSeconds ?? null),
            // NU-1: lo esperado lleva la persona de la programada (y la que nombre cada título).
            items: tanda.map(() => (prog.persona ? { personas: [prog.persona] } : {})),
            termino: prog.termino,
            carpeta: prog.carpeta,
            paquete: prog.termino,
            regla,
            bibliotecaId: prog.bibliotecaId ?? null,
          });
          mandados += tanda.length;
          for (const e of tanda) lista.push({ titulo: e.item.title || '', url: e.link });
          // Todo el grupo cuenta como enviado: en la próxima vuelta no sale por otro sitio.
          tanda.forEach(e => e.claves.forEach(k => enviados.add(k)));
        }
      } catch (e) {
        fallo = e.message;
      }
    }
    ultimo = {
      fecha,
      encontrados: items.length,
      enviados: mandados,
      descartes,
      error: fallo,
      mandados: lista.slice(0, MAX_MANDADOS),
    };
    // CS-N5: aviso si mandó algo o si falló (una vuelta sin nada nuevo no molesta). Con lo que se
    // mandó (los primeros títulos), para «Seguir a una persona» (C4).
    if (fallo) {
      require('./avisos').anotar('programada_error', { termino: prog.termino, error: fallo });
    } else if (mandados > 0) {
      require('./avisos').anotar('programada', {
        termino: prog.termino,
        n: mandados,
        titulos: lista
          .slice(0, 5)
          .map(x => x.titulo)
          .filter(Boolean),
        ...(prog.seguida ? { seguida: true } : {}),
      });
    }
    await crew.cambiar(datos => {
      const p = (datos.programadas || []).find(x => x.id === id);
      if (p) {
        p.ultimaVez = fecha;
        p.ultimo = ultimo;
        delete p.enCurso;
      }
    });
    await almacenEnviados.cambiar(e => {
      e.porBusqueda = e.porBusqueda || {};
      e.porBusqueda[id] = [...enviados].slice(-MAX_ENVIADOS);
    });
    logger.info(`Programada «${prog.termino}»: ${items.length} resultados, ${mandados} enviados`);
  } finally {
    enCurso = null;
    // Si algo falló antes de guardar el resumen, que la marca no deje la programada parada.
    if (!ultimo) {
      await crew
        .cambiar(datos => {
          const p = (datos.programadas || []).find(x => x.id === id);
          if (p) delete p.enCurso;
        })
        .catch(() => {});
    }
  }
  return ultimo;
}

function toca(p, ahora = Date.now()) {
  if (!p.activa) return false;
  // En marcha (también si se retomó tras un reinicio): no se lanza otra encima.
  if (p.enCurso) return false;
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
  reenganchar().catch(error => logger.warn(`Programadas: ${error.message}`));
  reloj = setInterval(() => {
    comprobar().catch(error => logger.warn(`Búsquedas programadas: ${error.message}`));
  }, CADA_MS);
  reloj.unref?.();
}

/** Apagado ordenado: no se lanza ninguna más. */
function detener() {
  clearInterval(reloj);
  reloj = null;
}

module.exports = {
  limpiarAlias,
  detener,
  enMarcha: () => enCurso !== null,
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
  reenganchar,
};
