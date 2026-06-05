'use strict';

const logger = require('../utils/logger');

/**
 * Middleware de logging de requests HTTP.
 * NO registra cuerpos de request (pueden contener datos sensibles).
 * Solo registra método, path, status code y duración.
 */
function httpLogger(req, res, next) {
  const start = Date.now();
  const { method, path, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const level = statusCode >= 500 ? 'error'
                : statusCode >= 400 ? 'warn'
                : 'http';

    logger[level]?.call
      ? logger[level](`${method} ${path}`, { status: statusCode, duration_ms: duration, ip })
      : logger.info(`${method} ${path}`, { status: statusCode, duration_ms: duration, ip });
  });

  next();
}

/**
 * Middleware de manejo de errores global.
 */
function errorHandler(err, req, res, _next) {
  logger.error('Error no manejado', {
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // No exponer detalles internos en producción
  const message = process.env.NODE_ENV === 'production'
    ? 'Error interno del servidor'
    : err.message;

  return res.status(err.status || 500).json({ error: message });
}

/**
 * Middleware para rutas no encontradas.
 */
function notFound(req, res) {
  return res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
  });
}

module.exports = { httpLogger, errorHandler, notFound };
