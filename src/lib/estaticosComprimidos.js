'use strict';

/**
 * Scripts, estilos y la página, comprimidos con gzip.
 *
 * Por una VPN, el front (unos 340 KB de texto) sin comprimir tardaba lo suyo en cada visita; con gzip
 * baja a la cuarta parte. Se comprime una vez por fichero y se guarda en memoria (se rehace si el
 * fichero cambia). La caché del navegador sigue igual que con `express.static` («no-cache» +
 * ETag: revalidar siempre), para que tras desplegar no se mezclen versiones.
 *
 * Lo que no sabe servir (imágenes, ficheros pequeños, clientes sin gzip) lo deja pasar a
 * `express.static`.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TIPOS = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const MINIMO = 1024; // por debajo, comprimir no compensa

function estaticosComprimidos(raiz) {
  const base = path.resolve(raiz);
  const memoria = new Map(); // ruta → { mtimeMs, size, gz | null, etag }

  return async function comprimidos(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!/\bgzip\b/i.test(req.get('accept-encoding') || '')) return next();
    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (rel === '/') rel = '/index.html';
    // Como express.static: nada oculto (.env, .git…) ni fuera de la carpeta.
    if (rel.split('/').some(parte => parte.startsWith('.'))) return next();
    const tipo = TIPOS[path.extname(rel).toLowerCase()];
    if (!tipo) return next();
    const absoluta = path.join(base, rel);
    if (!absoluta.startsWith(base + path.sep)) return next();

    let st;
    try {
      st = await fs.promises.stat(absoluta);
    } catch {
      return next();
    }
    if (!st.isFile()) return next();

    let e = memoria.get(absoluta);
    if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
      let datos;
      try {
        datos = await fs.promises.readFile(absoluta);
      } catch {
        return next();
      }
      e = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        gz: datos.length < MINIMO ? null : zlib.gzipSync(datos, { level: 9 }),
        etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-gz"`,
      };
      memoria.set(absoluta, e);
    }
    if (!e.gz) return next();

    res.set({
      'Content-Type': tipo,
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      ETag: e.etag,
      'Last-Modified': st.mtime.toUTCString(),
      'Cache-Control': 'no-cache',
    });
    if (req.fresh) return res.status(304).end();
    res.set('Content-Length', String(e.gz.length));
    return req.method === 'HEAD' ? res.end() : res.end(e.gz);
  };
}

module.exports = { estaticosComprimidos };
