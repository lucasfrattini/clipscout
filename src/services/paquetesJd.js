'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('../config');
const logger = require('../lib/logger');
const { crearAlmacen } = require('../lib/almacen');
const directo = require('./directo');

/**
 * Lo que clipscout mandó a JDownloader, y qué fue de ello.
 *
 * Cada envío queda apuntado como un paquete (data/jd-paquetes.json, fuera de git): nombre,
 * carpeta, fichas mandadas y los trabajos del capturador. Mientras quede alguno sin terminar se
 * mira su estado cada `JD_VIGILAR_CADA_MS` (solo consultas), con tope de `JD_VIGILAR_MAX_MS`.
 *
 * Si JDownloader marca un enlace como caído (su plugin da «Server error 404», el capturador lo da
 * por OFFLINE…) en varias revisiones SEGUIDAS (CS-10: menos si es claro, más si puede ser pasajero,
 * como «reintentando»), la ficha se vuelve a resolver FRESCA y se le manda el fichero directo, con
 * la ficha como origen, al mismo paquete y carpeta; el enlace caído se DESACTIVA (no se borra: si
 * se recupera, se puede volver a activar en JDownloader). Una vez por ficha (a mano,
 * «Reintentar», se puede repetir y no espera).
 *
 * JDownloader no devuelve el id del paquete al añadir: se reconoce por nombre y carpeta de
 * destino, que es justo lo que clipscout fija en cada envío.
 */

const almacen = crearAlmacen(
  () => path.join(config.datos.dir, 'jd-paquetes.json'),
  () => ({ paquetes: [] })
);

// Lo que JDownloader escribe en `status` cuando un enlace no va a bajar.
const ESTADO_FALLIDO =
  /error|offline|not found|404|403|410|fail|unavailable|temporarily|skipped|plugin|retry|reintent/i;

// De esos, los que dicen claramente que el fichero no está (no se va a arreglar esperando).
const ESTADO_CLARO = /offline|not found|404|410/i;

/** ¿Este enlace de JDownloader está caído? (sin terminar, sin bajar y con estado de error). */
function fallido(l) {
  if (!l || l.finished || l.running || l.enabled === false) return false;
  return l.availability === 'OFFLINE' || ESTADO_FALLIDO.test(String(l.status || ''));
}

/** ¿Caído sin duda (404, OFFLINE…) o puede ser pasajero? Para saber cuánto esperar. */
function caidoClaro(l) {
  return l.availability === 'OFFLINE' || ESTADO_CLARO.test(String(l.status || ''));
}

/**
 * CS-10: cuenta las revisiones seguidas que lleva caído cada enlace (`p.caidas`, por uuid) y
 * devuelve los que ya toca sustituir. Un enlace que deja de estar caído vuelve a cero. Pura.
 */
function caidosParaSustituir(p, caidos, { forzar = false } = {}) {
  const antes = p.caidas || {};
  const ahora = {};
  const listos = [];
  for (const l of caidos) {
    const n = (antes[l.uuid] || 0) + 1;
    ahora[l.uuid] = n;
    const espera = caidoClaro(l) ? config.jd.revisionesCaidoClaro : config.jd.revisionesCaidoDudoso;
    if (forzar || n >= espera) listos.push(l);
  }
  p.caidas = ahora;
  return listos;
}

/** Estado resumido de un paquete a partir de sus enlaces. Pura, para poder probarla. */
function resumir(enlacesDescarga, enlacesCapturador) {
  const total = enlacesDescarga.length + enlacesCapturador.length;
  const terminados = enlacesDescarga.filter(l => l.finished).length;
  const bajando = enlacesDescarga.filter(l => l.running).length;
  const caidos =
    enlacesDescarga.filter(fallido).length +
    enlacesCapturador.filter(l => l.availability === 'OFFLINE' && l.enabled !== false).length;
  let estado;
  if (total === 0) estado = 'enviado';
  else if (terminados === total) estado = 'terminado';
  else if (bajando > 0) estado = 'bajando';
  else if (caidos > 0 && terminados + caidos === total) estado = 'error';
  else estado = 'cola';
  return {
    estado,
    total,
    terminados,
    bajando,
    fallidos: caidos,
    enCapturador: enlacesCapturador.length,
  };
}

// «incompleto»: terminó, pero alguna ficha nunca entró en JDownloader (ni con el rescate).
const FINALES = new Set(['terminado', 'incompleto']);

/** Terminado y aún sin avisar a clipkeeper (que tenga a quién avisar y queden intentos). */
function faltaAviso(p) {
  return (
    FINALES.has(p.estado) &&
    p.biblioteca !== null &&
    p.biblioteca !== undefined &&
    !p.escaneado &&
    !p.sinClipkeeper &&
    (p.avisos || 0) < config.jd.avisosClipkeeper
  );
}

function vigilable(p, ahora = Date.now()) {
  return (!FINALES.has(p.estado) && ahora - p.creado < config.jd.vigilarMaxMs) || faltaAviso(p);
}

/**
 * Un paquete terminado → clipkeeper escanea su carpeta (una vez por paquete). La carpeta es la
 * subcarpeta relativa a la de descargas de JDownloader, que es la raíz de la biblioteca elegida
 * en Ajustes → JDownloader. Sin clipkeeper conectado no se hace nada (ni se reintenta).
 */
async function avisarClipkeeper(p) {
  const crew = require('./crew');
  const r = await crew.escanearClipkeeper({ bibliotecaId: p.biblioteca, carpeta: p.carpeta || '' });
  if (!r.conectado) p.sinClipkeeper = true;
  else if (r.ok) p.escaneado = Date.now();
  else {
    p.avisos = (p.avisos || 0) + 1;
    logger.warn(`clipkeeper no pudo escanear «${p.carpeta}»: ${r.error}`);
  }
}

/** Apunta un envío. Devuelve su id. */
async function registrar({
  nombre,
  carpeta = '',
  destino = null,
  biblioteca = null,
  fichas = [],
  jobIds = [],
}) {
  const id = crypto.randomUUID();
  await almacen.cambiar(d => {
    d.paquetes = d.paquetes || [];
    d.paquetes.unshift({
      id,
      nombre,
      carpeta,
      destino,
      biblioteca,
      fichas: fichas.slice(0, 500),
      jobIds: jobIds.filter(Boolean),
      creado: Date.now(),
      estado: 'enviado',
      contadores: null,
      sustituidas: [],
      sinDirecto: [],
      directos: {},
    });
    d.paquetes = d.paquetes.slice(0, config.jd.maxPaquetes);
  });
  arrancar();
  return id;
}

/** Suma un trabajo del capturador a un paquete (los envíos de fichero directo van aparte). */
async function anotarTrabajo(id, jobId, directos = {}) {
  if (!jobId) return;
  await almacen.cambiar(d => {
    const p = (d.paquetes || []).find(x => x.id === id);
    if (!p) return;
    p.jobIds.push(jobId);
    Object.assign(p.directos, directos);
  });
}

/** La ficha de la que salió un enlace de JDownloader (o null si no se puede saber). */
function fichaDe(p, enlace) {
  if (p.fichas.includes(enlace.url)) return enlace.url;
  // Un fichero directo que ya mandamos nosotros: si vuelve a caer no se insiste solo.
  if (p.directos[enlace.url]) return null;
  return p.fichas.length === 1 ? p.fichas[0] : null;
}

/**
 * Sustituye por el fichero directo los enlaces caídos de un paquete. `forzar`: también las fichas
 * que ya se sustituyeron una vez (botón «Reintentar»). Devuelve cuántas fichas se mandaron.
 */
async function sustituir(jdUrl, p, caidos, { forzar = false, autostart = true } = {}) {
  const jd = require('./jdownloader');
  const porFicha = new Map();
  for (const l of caidos) {
    const ficha = l.ficha;
    if (!ficha || (!forzar && p.sustituidas.includes(ficha))) continue;
    if (!porFicha.has(ficha)) porFicha.set(ficha, []);
    porFicha.get(ficha).push(l);
  }
  let mandadas = 0;
  for (const [ficha, enlaces] of porFicha) {
    let ficheros = [];
    try {
      ficheros = await directo.resolverDirecto(ficha);
    } catch (error) {
      logger.warn(`Fichero directo de ${ficha}: ${error.message}`);
    }
    if (!p.sustituidas.includes(ficha)) {
      p.sustituidas.push(ficha);
      // La primera vez que JDownloader no puede con ella: cuenta como fallo de ese sitio.
      require('./estadisticas').sumarEnlace(ficha, { fallidosJd: 1 });
    }
    if (ficheros.length === 0) {
      if (!p.sinDirecto.includes(ficha)) p.sinDirecto.push(ficha);
      continue;
    }
    const trabajo = await jd.anadir(jdUrl, {
      links: ficheros,
      paquete: p.nombre,
      destino: p.destino,
      origen: ficha,
      autostart,
    });
    if (trabajo?.id) p.jobIds.push(trabajo.id);
    for (const f of ficheros) p.directos[f] = ficha;
    p.sinDirecto = p.sinDirecto.filter(x => x !== ficha);
    // Los caídos se DESACTIVAN (CS-10; antes se borraban): ya hay un sustituto y, activos, darían
    // el paquete por fallido para siempre; desactivados no se pierden por si se recuperan.
    const enDescarga = enlaces.filter(l => l.lista === 'descarga').map(l => l.uuid);
    const enCapturador = enlaces.filter(l => l.lista === 'capturador').map(l => l.uuid);
    if (enDescarga.length) {
      await jd.llamar(jdUrl, '/downloadsV2/setEnabled', [false, enDescarga, []]);
    }
    if (enCapturador.length) {
      await jd.llamar(jdUrl, '/linkgrabberv2/setEnabled', [false, enCapturador, []]);
    }
    if (autostart && trabajo?.id) {
      jd.descargarCuandoEste(jdUrl, trabajo.id).catch(error =>
        logger.warn(`JDownloader: no se pudo arrancar el fichero directo: ${error.message}`)
      );
    }
    mandadas += 1;
  }
  return mandadas;
}

function hostSinWww(enlace) {
  try {
    return new URL(enlace).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Fichas de un paquete de cuyo sitio JDownloader nunca enseñó ningún enlace (ni las mandamos ya
 * como fichero directo): no supo abrirlas. Pura, para poder probarla.
 */
function fichasNoVistas(p) {
  const { desenvolver } = require('../lib/redireccion');
  const vistos = new Set(p.hostsVistos || []);
  const conDirecto = new Set(Object.values(p.directos || {}));
  // Si JDownloader nunca enseñó NADA del paquete puede que lo bajara y lo quitara de la lista antes
  // de la primera revisión: entonces solo cuentan los saltos, que seguro que no supo abrir.
  const algoVisto = vistos.size > 0;
  return (p.fichas || []).filter(
    f =>
      !conDirecto.has(f) &&
      !(p.rescatadas || []).includes(f) &&
      !vistos.has(hostSinWww(f)) &&
      (algoVisto || desenvolver(f) !== f)
  );
}

/**
 * Segunda oportunidad para lo que JDownloader no abrió: si la ficha era un salto con la de verdad
 * dentro, se manda esa; si no, el fichero directo (como con los caídos). Devuelve cuántas salieron.
 */
async function rescatar(jdUrl, p, fichas, { autostart = true } = {}) {
  const jd = require('./jdownloader');
  const { desenvolver } = require('../lib/redireccion');
  let salieron = 0;
  const directas = [];
  for (const ficha of fichas) {
    const real = desenvolver(ficha);
    if (real !== ficha) {
      const trabajo = await jd.anadir(jdUrl, {
        links: [real],
        paquete: p.nombre,
        destino: p.destino,
        origen: real,
        autostart,
      });
      if (trabajo?.id) p.jobIds.push(trabajo.id);
      if (!p.fichas.includes(real)) p.fichas.push(real);
      p.rescatadas = [...(p.rescatadas || []), ficha];
      salieron += 1;
    } else {
      directas.push({ uuid: ficha, ficha, lista: 'ninguna' });
    }
  }
  if (directas.length) salieron += await sustituir(jdUrl, p, directas, { forzar: true, autostart });
  if (salieron) logger.info(`JDownloader: ${salieron} fichas rescatadas de ${p.nombre}`);
  return salieron;
}

/**
 * Consulta a JDownloader el estado de los paquetes vigilados (o de `soloId`) y aplica lo que
 * toque: estado, contadores y fichero directo para lo caído. `forzar`: reintentar también lo ya
 * sustituido (botón «Reintentar»).
 */
async function revisar({ soloId = null, forzar = false } = {}) {
  const jd = require('./jdownloader');
  const { url: jdUrl, autostart = true } = await jd.ajustes();
  if (!jdUrl) return { revisados: 0 };
  const datos = await almacen.leer();
  const ahora = Date.now();
  const objetivo = (datos.paquetes || []).filter(p =>
    soloId ? p.id === soloId : vigilable(p, ahora)
  );
  if (objetivo.length === 0) return { revisados: 0 };

  const paquetesJd = await jd.llamar(jdUrl, '/downloadsV2/queryPackages', [
    { saveTo: true, status: true, finished: true, running: true, childCount: true },
  ]);
  // También los del capturador, por nombre y carpeta: hay versiones de JDownloader que no
  // filtran por `jobUUIDs` (devuelven []), y sin esto lo atascado allí no se vería.
  const capturadorJd = await jd
    .llamar(jdUrl, '/linkgrabberv2/queryPackages', [{ saveTo: true, childCount: true }])
    .catch(() => []);
  const cambios = new Map();
  let sustituidas = 0;
  for (const p0 of objetivo) {
    const p = structuredClone(p0);
    // «Reintentar» vuelve a intentar también las fichas que JDownloader nunca llegó a ver.
    if (forzar) p.rescatado = null;
    const coinciden = (Array.isArray(paquetesJd) ? paquetesJd : []).filter(
      k => k.name === p.nombre && (!p.destino || k.saveTo === p.destino)
    );
    // CS-11: otro envío con el mismo nombre y carpeta acaba en el mismo paquete de JDownloader.
    // Entonces cada uno cuenta solo SUS enlaces (sus fichas y sus ficheros directos); sin otro
    // envío así, todo el paquete es suyo (JDownloader puede cambiar la dirección de un enlace).
    const gemelo = (datos.paquetes || []).some(
      o => o.id !== p.id && o.nombre === p.nombre && (o.destino || null) === (p.destino || null)
    );
    const esNuestro = l => !gemelo || p.fichas.includes(l.url) || Boolean(p.directos[l.url]);
    const enlacesDescarga = coinciden.length
      ? await jd.llamar(jdUrl, '/downloadsV2/queryLinks', [
          {
            packageUUIDs: coinciden.map(k => k.uuid),
            url: true,
            status: true,
            finished: true,
            running: true,
            availability: true,
            enabled: true,
          },
        ])
      : [];
    const enCapturador = (Array.isArray(capturadorJd) ? capturadorJd : []).filter(
      k => k.name === p.nombre && (!p.destino || k.saveTo === p.destino)
    );
    let enlacesCapturador = p.jobIds.length
      ? await jd.llamar(jdUrl, '/linkgrabberv2/queryLinks', [
          { jobUUIDs: p.jobIds, url: true, availability: true, enabled: true },
        ])
      : [];
    if (!(Array.isArray(enlacesCapturador) && enlacesCapturador.length) && enCapturador.length) {
      enlacesCapturador = await jd.llamar(jdUrl, '/linkgrabberv2/queryLinks', [
        {
          packageUUIDs: enCapturador.map(k => k.uuid),
          url: true,
          availability: true,
          enabled: true,
        },
      ]);
    }
    const descarga = (Array.isArray(enlacesDescarga) ? enlacesDescarga : []).filter(esNuestro);
    const capturador = Array.isArray(enlacesCapturador) ? enlacesCapturador : [];
    const caidos = [
      ...descarga.filter(fallido).map(l => ({ ...l, lista: 'descarga' })),
      ...capturador
        .filter(l => l.availability === 'OFFLINE' && l.enabled !== false)
        .map(l => ({ ...l, lista: 'capturador' })),
    ].map(l => ({ ...l, ficha: fichaDe(p, l) }));
    const listos = caidosParaSustituir(p, caidos, { forzar });
    if (listos.length > 0) {
      try {
        sustituidas += await sustituir(jdUrl, p, listos, { forzar, autostart });
      } catch (error) {
        logger.warn(`JDownloader: no se pudo mandar el fichero directo: ${error.message}`);
      }
    }
    const r = resumir(descarga, capturador);
    // De qué sitios ha visto JDownloader enlaces en este paquete (para saber qué fichas no entraron).
    p.hostsVistos = [
      ...new Set([
        ...(p.hostsVistos || []),
        ...[...descarga, ...capturador].map(l => hostSinWww(l.url)).filter(Boolean),
      ]),
    ];
    // JDownloader puede quitar de la lista lo terminado («borrar al terminar»): un envío que ya no
    // está en ninguna de las dos listas, pasado un rato, se da por terminado.
    if (
      r.total === 0 &&
      coinciden.length === 0 &&
      enCapturador.length === 0 &&
      ahora - p.creado > config.jd.desaparecidoTerminadoMs
    ) {
      r.estado = 'terminado';
      r.desaparecido = true;
      // …salvo las fichas de las que nunca se vio nada: JDownloader no supo abrirlas. Se intenta
      // una vez salvarlas (la ficha de dentro de un salto, o el fichero directo); si no, el paquete
      // queda incompleto y se avisa, en vez de darlo por bueno en silencio.
      const noVistas = fichasNoVistas(p);
      if (noVistas.length > 0 && !p.rescatado) {
        p.rescatado = ahora;
        const rescatadas = await rescatar(jdUrl, p, noVistas, { autostart }).catch(error => {
          logger.warn(`JDownloader: rescate de ${p.nombre}: ${error.message}`);
          return 0;
        });
        if (rescatadas > 0) {
          r.estado = 'enviado';
          r.desaparecido = false;
        }
      }
      if (r.estado === 'terminado' && noVistas.length > 0) {
        r.estado = 'incompleto';
        r.faltan = noVistas.length;
        p.faltan = noVistas;
      }
    }
    // CS-N5: aviso al pasar a terminado, fallido o incompleto (una vez: solo cuando cambia).
    const tipoAviso = {
      terminado: 'paquete_terminado',
      error: 'paquete_fallido',
      incompleto: 'paquete_incompleto',
    }[r.estado];
    if (r.estado !== p.estado && tipoAviso) {
      require('./avisos').anotar(tipoAviso, {
        nombre: p.nombre,
        carpeta: p.carpeta || '',
        ...(r.faltan ? { faltan: r.faltan, total: p.fichas.length } : {}),
      });
    }
    p.estado = r.estado;
    p.contadores = r;
    p.revisado = ahora;
    if (r.estado === 'terminado' && !p.terminadoEn) p.terminadoEn = ahora;
    if (faltaAviso(p)) await avisarClipkeeper(p);
    cambios.set(p.id, p);
  }
  await almacen.cambiar(d => {
    d.paquetes = (d.paquetes || []).map(p => {
      const nuevo = cambios.get(p.id);
      // jobIds/directos pudieron crecer mientras se revisaba (otro envío al mismo paquete)
      return nuevo
        ? {
            ...nuevo,
            jobIds: [...new Set([...p.jobIds, ...nuevo.jobIds])],
            directos: { ...p.directos, ...nuevo.directos },
          }
        : p;
    });
  });
  return { revisados: objetivo.length, sustituidas };
}

let reloj = null;
let revisando = false;

/** Arranca la vigilancia (si hay algo que vigilar). Se para sola cuando no queda nada. */
function arrancar() {
  if (reloj) return;
  reloj = setInterval(async () => {
    if (revisando) return;
    revisando = true;
    try {
      const d = await almacen.leer();
      if (!(d.paquetes || []).some(p => vigilable(p))) {
        clearInterval(reloj);
        reloj = null;
        return;
      }
      await revisar();
    } catch (error) {
      logger.warn(`JDownloader: no se pudo revisar el estado: ${error.message}`);
    } finally {
      revisando = false;
    }
  }, config.jd.vigilarCadaMs);
  reloj.unref?.();
}

function parar() {
  clearInterval(reloj);
  reloj = null;
}

async function listar() {
  return (await almacen.leer()).paquetes || [];
}

/**
 * Memoria de lo ya enviado (CS-N7): de estas fichas, cuáles van en algún paquete y cuándo se
 * mandaron por última vez. Pura, para poder probarla. Una ficha con o sin «/» final es la misma.
 */
function enviadosDe(paquetes, enlaces) {
  const normal = u => String(u || '').replace(/\/+$/, '');
  const pedidos = new Map();
  for (const e of enlaces || []) pedidos.set(normal(e), e);
  const r = {};
  for (const p of paquetes || []) {
    for (const f of p.fichas || []) {
      const original = pedidos.get(normal(f));
      if (original === undefined) continue;
      if (!r[original] || r[original] < p.creado) r[original] = p.creado;
    }
  }
  return r;
}

module.exports = {
  registrar,
  anotarTrabajo,
  revisar,
  listar,
  enviadosDe,
  arrancar,
  parar,
  resumir,
  fallido,
  caidoClaro,
  caidosParaSustituir,
  faltaAviso,
  fichasNoVistas,
  almacen,
};
