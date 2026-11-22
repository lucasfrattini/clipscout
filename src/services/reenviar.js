'use strict';

/**
 * NU-7 «Volver a descargar» (contrato C6). clipkeeper manda los vídeos rotos o desaparecidos con su
 * página de origen (la que le dio clipscout en lo esperado, C2) y su carpeta; se vuelven a mandar al
 * gestor de descargas, a la misma carpeta, y se avisa de nuevo de lo esperado (con
 * `sustituye_video_id` si viene, para que la ficha se conserve).
 *
 * Un paquete por carpeta. Lo que no se pudo mandar va en `fallos` con su motivo.
 */

const MAX_ITEMS = 500;

const texto = (v, max = 300) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

async function reenviar(cuerpo = {}) {
  const items = Array.isArray(cuerpo.items) ? cuerpo.items : null;
  if (!items || items.length === 0 || items.length > MAX_ITEMS) {
    const error = new Error(`Se esperaba una lista de 1 a ${MAX_ITEMS} vídeos.`);
    error.status = 400;
    throw error;
  }
  const fallos = [];
  const grupos = new Map();
  for (const it of items) {
    const url = texto(it?.origen_url, 2000);
    if (!/^https?:\/\//i.test(url)) {
      fallos.push({ origen_url: url || null, error: 'Sin dirección de origen.' });
      continue;
    }
    const biblioteca = Number.isInteger(Number(it.biblioteca_id)) ? Number(it.biblioteca_id) : null;
    const carpeta = texto(it.carpeta, 500);
    const k = `${biblioteca}|${carpeta}`;
    if (!grupos.has(k)) grupos.set(k, { biblioteca, carpeta, lista: [] });
    grupos.get(k).lista.push({
      url,
      titulo: texto(it.titulo),
      personas: Array.isArray(it.personas) ? it.personas : [],
      sustituye: it.sustituye_video_id ?? null,
    });
  }
  const jd = require('./jdownloader');
  let enviados = 0;
  for (const g of grupos.values()) {
    try {
      const r = await jd.enviar({
        links: g.lista.map(x => x.url),
        titulos: g.lista.map(x => x.titulo),
        items: g.lista.map(x => ({
          titulo: x.titulo,
          personas: x.personas,
          sustituye_video_id: x.sustituye,
        })),
        carpeta: g.carpeta,
        paquete: g.lista.length === 1 && g.lista[0].titulo ? g.lista[0].titulo : '',
        bibliotecaId: g.biblioteca,
      });
      enviados += r.enviados;
      // Lo que quitaron las palabras bloqueadas no se manda: se dice.
      if (r.bloqueados) {
        fallos.push({ origen_url: null, error: `${r.bloqueados} con palabras bloqueadas` });
      }
    } catch (error) {
      for (const x of g.lista) fallos.push({ origen_url: x.url, error: error.message });
    }
  }
  return { enviados, fallos };
}

module.exports = { reenviar, MAX_ITEMS };
