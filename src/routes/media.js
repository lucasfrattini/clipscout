'use strict';

const axios = require('axios');
const express = require('express');

const config = require('../config');
const { AppError } = require('../lib/errors');
const { agentesPara, buildHeaders, guardRedirect } = require('../lib/http');
const { assertUrlIsSafe } = require('../lib/ssrf');

const router = express.Router();

/** Lo que se deja pasar: vídeo de verdad (o un binario genérico, que es como lo sirven muchos CDN). */
const TIPO_VIDEO = /^(video\/|application\/octet-stream|binary\/octet-stream)/i;

/** Cabeceras de la respuesta del sitio que el reproductor necesita para saltar dentro del vídeo. */
const CABECERAS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/**
 * GET /api/media?url=…&ref=… — reproduce un vídeo desde NUESTRO origen.
 *
 * Por lo mismo que las miniaturas (docs/FEATURES.md): el navegador nunca habla con el CDN del
 * sitio. Además es lo único que funciona en muchos sitios: el enlace al fichero lleva un token
 * ligado a quien abrió la ficha (el servidor, por su salida) o exige la ficha como Referer, y
 * pedido desde el navegador da 403.
 *
 * Es un paso de streaming, sin caché ni disco: reenvía la cabecera Range del reproductor y
 * devuelve el 206 tal cual, así que se puede saltar a cualquier punto sin bajar el vídeo entero.
 * Acotado igual que el resto: validación SSRF (también al conectar y en cada redirección) y
 * solo contenido de vídeo.
 */
router.get('/media', async (req, res, next) => {
  const { url, ref } = req.query || {};
  try {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      throw new AppError('Se requiere la URL del vídeo', 400, 'URL_REQUIRED');
    }
    const destino = url.trim();
    await assertUrlIsSafe(destino);
    const referer = typeof ref === 'string' && /^https?:\/\//i.test(ref) ? ref : undefined;

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const respuesta = await axios.get(destino, {
      responseType: 'stream',
      headers: buildHeaders({
        Accept: '*/*',
        'Accept-Encoding': 'identity', // un vídeo comprimido por el camino no admite Range
        ...(req.headers.range ? { Range: req.headers.range } : {}),
        ...(referer ? { Referer: referer } : {}),
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      }),
      timeout: config.media.timeoutMs,
      maxRedirects: config.http.maxRedirects,
      signal: controller.signal,
      validateStatus: s => s === 200 || s === 206,
      decompress: false,
      ...agentesPara(destino),
      beforeRedirect: guardRedirect,
    });

    const tipo = String(respuesta.headers['content-type'] || '');
    if (!TIPO_VIDEO.test(tipo)) {
      respuesta.data.destroy();
      throw new AppError('Eso no es un vídeo que se pueda reproducir aquí', 415, 'NOT_VIDEO');
    }
    res.status(respuesta.status);
    for (const c of CABECERAS) {
      if (respuesta.headers[c] !== undefined) res.set(c, respuesta.headers[c]);
    }
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    respuesta.data.on('error', () => res.destroy());
    respuesta.data.pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    if (error instanceof AppError) return next(error);
    if (axios.isCancel?.(error) || error.name === 'CanceledError') return res.end();
    const estado = error.response?.status;
    next(
      new AppError(
        estado ? `El sitio respondió ${estado}` : 'No se pudo traer el vídeo',
        502,
        'MEDIA_UPSTREAM'
      )
    );
  }
});

module.exports = router;
