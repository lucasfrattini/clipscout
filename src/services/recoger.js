'use strict';

const crew = require('./crew');
const fondo = require('./busquedasFondo');
const paquetesJd = require('./paquetesJd');
const estadisticas = require('./estadisticas');
const filtrosGlobales = require('./filtrosGlobales');
const { elegir, coincidencia, calidadDe } = require('../lib/recoger');

/**
 * «Recoger» (CS-N1): de lo que encontró una búsqueda de una persona o un término, los N vídeos que
 * llevan su nombre, que no tengo (preguntando a clipkeeper), sin repetidos y los más largos (o de
 * más calidad). Devuelve la PROPUESTA: la interfaz la enseña y la manda con un solo botón al
 * gestor de descargas (la ruta de envío de siempre), y puede guardarla como programada.
 *
 * clipscout nunca descarga: solo propone y envía al gestor externo.
 */

const MAX_N = 200;

/** Lo que lleva encontrado una búsqueda en segundo plano (en marcha o terminada), sin esperar. */
function instantanea(id) {
  const items = [];
  let grupos = [];
  let error = null;
  let terminada = false;
  const baja = fondo.suscribir(id, 0, e => {
    if (e.type === 'resultados') items.push(...(e.items || []));
    else if (e.type === 'duplicados') grupos = e.grupos || [];
    else if (e.type === 'duracion') {
      const porUrl = new Map(items.map(it => [it.url, it]));
      for (const d of e.items || []) {
        const it = porUrl.get(d.url);
        if (it && !Number.isFinite(it.durationSeconds)) {
          it.durationSeconds = d.durationSeconds;
          it.duration = d.duration;
        }
      }
    } else if (e.type === 'error') error = e.message;
    if (e.type === 'fin' || e.type === 'error') terminada = true;
  });
  if (baja === null) return null;
  baja();
  const info = fondo.lista().find(b => b.id === id) || {};
  return { items, grupos, error, terminada, q: info.q || '', carpeta: info.carpeta || '' };
}

/**
 * Quita de `elegidos` (ya ordenados) lo que clipkeeper tiene, hasta reunir `n` (0 = todos).
 * Primero con `POST /tengo` (lo que tengo de esa persona, de una vez; lo que está en la papelera
 * de clipkeeper tampoco se vuelve a traer). Con un clipkeeper anterior, con `/buscar` por tandas,
 * como «ya lo tengo». Sin clipkeeper, no quita nada (y lo dice).
 */
async function quitarLoQueTengo(elegidos, nombre, n = 0) {
  const quedan = [];
  let tengo = 0;
  let papelera = 0;
  const lleno = () => n > 0 && quedan.length >= n;
  // Sin nombre (una programada de las de antes sin persona) no hay «lo que tengo de…»: se
  // pregunta resultado a resultado, como siempre.
  const info = nombre
    ? await crew.tengoEnClipkeeper(nombre).catch(() => ({ conectado: false }))
    : { conectado: true, disponible: false };
  const clipkeeper = {
    conectado: Boolean(info.conectado),
    disponible: Boolean(info.disponible),
    personas: info.personas || [],
    total: info.total || 0,
  };
  if (info.disponible) {
    for (const e of elegidos) {
      if (lleno()) break;
      const v = coincidencia(e.item, info.videos);
      if (!v) quedan.push(e);
      else if (v.estado === 'papelera') papelera += 1;
      else {
        tengo += 1;
        estadisticas.sumarEnlace(e.link, { yaLoTenias: 1 });
      }
    }
    return { quedan, tengo, papelera, clipkeeper };
  }
  if (!info.conectado) {
    return { quedan: n > 0 ? elegidos.slice(0, n) : [...elegidos], tengo, papelera, clipkeeper };
  }
  for (let i = 0; i < elegidos.length && !lleno(); i += 200) {
    const tanda = elegidos.slice(i, i + 200);
    const r = await crew
      .buscarEnClipkeeper(
        tanda.map(e => e.item.title || ''),
        tanda.map(e => e.item.durationSeconds ?? null),
        nombre
      )
      .catch(() => ({ resultados: [] }));
    const res = r.resultados || [];
    for (let j = 0; j < tanda.length && !lleno(); j += 1) {
      if (res.length === tanda.length && res[j]?.coincidencias?.length) {
        tengo += 1;
        estadisticas.sumarEnlace(tanda[j].link, { yaLoTenias: 1 });
      } else quedan.push(tanda[j]);
    }
  }
  return { quedan, tengo, papelera, clipkeeper };
}

/** Opciones limpias (las comparten la propuesta y las programadas). */
function opciones(entrada = {}) {
  const n = Number(entrada.n);
  return {
    nombre: String(entrada.nombre || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200),
    n: Number.isFinite(n) ? Math.min(MAX_N, Math.max(1, Math.round(n))) : 20,
    soloConNombre: entrada.soloConNombre !== false,
    orden: entrada.orden === 'calidad' ? 'calidad' : 'largos',
    minutosMinimo: Math.min(600, Math.max(0, Number(entrada.minutosMinimo) || 0)),
    sinDuracion: entrada.sinDuracion !== false,
  };
}

/** Lo que ve la interfaz de cada propuesto. */
const publico = e => ({
  link: e.link,
  url: e.item.url,
  title: e.item.title || '',
  thumbnail: e.item.thumbnail || '',
  duration: e.item.duration || '',
  durationSeconds: Number.isFinite(e.item.durationSeconds) ? e.item.durationSeconds : null,
  sitio: e.item.sitio || e.item.site || '',
  calidad: calidadDe(e.item),
});

/**
 * POST /api/recoger/propuesta {busqueda, nombre?, n, soloConNombre, orden, minutosMinimo}.
 * Con la búsqueda aún en marcha propone con lo que hay (y dice `terminada: false`).
 */
async function proponer(entrada = {}) {
  const id = String(entrada.busqueda || '');
  const foto = id ? instantanea(id) : null;
  if (!foto) throw new crew.ErrorCrew('Esa búsqueda ya no existe: vuelve a buscar.', 404);
  const o = opciones({ ...entrada, nombre: entrada.nombre || foto.q });
  if (!o.nombre) throw new crew.ErrorCrew('Falta de quién o de qué recoger.');
  const enlaces = foto.items.map(it => it.sourceUrl || it.url).filter(Boolean);
  const enviados = Object.keys(paquetesJd.enviadosDe(await paquetesJd.listar(), enlaces));
  const { elegidos, descartes } = elegir(foto.items, {
    ...o,
    yaEnviados: enviados,
    bloqueadas: filtrosGlobales.bloqueadas(),
    grupos: foto.grupos,
  });
  const { quedan, tengo, papelera, clipkeeper } = await quitarLoQueTengo(elegidos, o.nombre, o.n);
  return {
    ...o,
    busqueda: id,
    terminada: foto.terminada,
    encontrados: foto.items.length,
    candidatos: elegidos.length,
    propuesta: quedan.map(publico),
    descartes: { ...descartes, tengo, papelera },
    clipkeeper,
  };
}

module.exports = { proponer, quitarLoQueTengo, instantanea, opciones, MAX_N };
