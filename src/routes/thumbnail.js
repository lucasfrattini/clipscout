'use strict';

const express = require('express');

const config = require('../config');
const { AppError } = require('../lib/errors');
const { obtenerMiniatura } = require('../services/thumbnails');
const { puedeIntermediar, dominioBase } = require('../lib/firmaProxy');

/** Dominios base de los sitios configurados (para el intermediario sin firma, CS-S8). */
async function dominiosSitios() {
  const { readProfiles } = require('../services/profiles');
  const perfiles = await readProfiles().catch(() => []);
  const dominios = new Set();
  for (const p of perfiles) {
    try {
      dominios.add(
        dominioBase(new URL(String(p.config.searchUrl || '').replace(/\{q\}/g, 'q')).hostname)
      );
    } catch {
      // sin dirección válida: no cuenta
    }
  }
  return dominios;
}

const router = express.Router();

/**
 * GET /api/thumbnail?url=… — sirve una miniatura desde NUESTRO origen.
 *
 * El navegador del usuario nunca habla con el CDN del sitio explorado: pide
 * aquí, y es el servidor —que ya hablaba con ese sitio— quien va a buscarla.
 * Así la IP del usuario no se reparte por los CDN de los sitios que explora y
 * la CSP puede seguir con `img-src 'self' data:`.
 *
 * ── Sobre ser un proxy de imágenes ────────────────────────────────────
 *
 * Sí, esto acepta una URL arbitraria y la descarga, igual que el resto de la
 * aplicación. Lo que lo acota:
 *   - la misma validación SSRF que todo lo demás, incluida la comprobación
 *     de IP al conectar;
 *   - solo se devuelve lo que sea de verdad una imagen, por content-type;
 *   - tope de tamaño por imagen y caché con tope global;
 *   - el rate limiting general de /api.
 *
 * No añade alcance: cualquiera que pueda llamar aquí ya podía pedirle al
 * scraper que descargara esa misma URL.
 */
router.get('/thumbnail', async (req, res, next) => {
  try {
    if (!config.thumbnails.enabled) {
      throw new AppError('Las miniaturas están desactivadas', 404, 'THUMBNAILS_DISABLED');
    }

    const { url, s } = req.query || {};
    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
    }
    // CS-S8: solo lo que entregó el propio servidor (firmado) o de un sitio configurado.
    const permitido = puedeIntermediar({
      url: url.trim(),
      firma: s,
      admin: req.clave?.tipo === 'admin',
      dominiosSitios: await dominiosSitios(),
    });
    if (!permitido) {
      throw new AppError('Esa imagen no la entregó este servidor', 403, 'PROXY_NO_FIRMADO');
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const { buffer, contentType, deCache } = await obtenerMiniatura(url.trim(), {
      signal: controller.signal,
    });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', `private, max-age=${config.thumbnails.browserCacheSeconds}`);
    // Que no se reenvíe la URL de origen a ningún sitio
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Thumbnail-Cache', deCache ? 'hit' : 'miss');
    res.send(buffer);
  } catch (error) {
    // Una miniatura que no se pudo traer tampoco debe pedirla otra vez el navegador en cada
    // repintado: el mismo rato que la recuerda el servidor como fallida.
    if (error?.code === 'THUMBNAIL_UNAVAILABLE' || error?.code === 'NOT_AN_IMAGE') {
      res.set(
        'Cache-Control',
        `private, max-age=${Math.round(config.thumbnails.negativeTtlMs / 1000)}`
      );
    }
    next(error);
  }
});

module.exports = router;
