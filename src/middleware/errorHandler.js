'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const errores = require('../lib/errores');

/** 404 para rutas de API no reconocidas. */
function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next(new AppError(`Ruta no encontrada: ${req.path}`, 404, 'NOT_FOUND'));
  }
  return next();
}

/**
 * Manejador de errores unificado. Formato (SU-10): `{codigo, detail, params}` más los campos de
 * antes (`error`, `code`), que `formatoErrores` completa. Lo no previsto (una excepción que no es
 * AppError, o un AppError 500) sale como `error_interno` con un identificador corto que también
 * queda en el registro: con él se encuentra la traza sin enseñarla al cliente.
 */
// eslint-disable-next-line no-unused-vars -- Express identifica el handler por aridad
function errorHandler(error, req, res, next) {
  const isAppError = error instanceof AppError;
  // express.json() marca así un cuerpo ilegible o demasiado grande.
  const deExpress = !isAppError && Number(error?.status) >= 400 && Number(error?.status) < 500;
  const statusCode = isAppError ? error.statusCode : deExpress ? Number(error.status) : 500;

  if (res.headersSent) {
    if (statusCode >= 500) logger.error(`${req.method} ${req.path} → ${statusCode}`, error);
    return res.end();
  }

  if (statusCode === 500 || (!isAppError && !deExpress)) {
    const id = errores.nuevoId();
    errores.apuntar('error_interno', id);
    logger.error(`[${id}] ${req.method} ${req.path} → 500`, error);
    const body = {
      codigo: 'error_interno',
      detail: `Error interno (ref. ${id}).`,
      params: { id },
      code: 'INTERNAL_ERROR',
    };
    // La traza solo se expone fuera de producción
    if (config.env !== 'production') body.stack = error?.stack;
    return res.status(500).json(body);
  }

  if (statusCode > 500) logger.error(`${req.method} ${req.path} → ${statusCode}`, error);
  else logger.warn(`${req.method} ${req.path} → ${statusCode}: ${error.message}`);

  const body = isAppError
    ? error.toJSON()
    : { error: 'Petición no válida.', code: error.type === 'entity.too.large' ? 'TOO_LARGE' : '' };
  if (!body.code) delete body.code;
  if (isAppError && error.codigo) body.codigo = error.codigo;
  if (isAppError && error.params) body.params = error.params;
  // CS-18: `detail` = `error`, así quien leyera uno u otro sigue funcionando.
  body.detail = body.error;
  return res.status(statusCode).json(body);
}

module.exports = { errorHandler, notFoundHandler };
