'use strict';

const helmet = require('helmet');
const logger = require('../utils/logger');

/**
 * Configuración de Helmet con headers de seguridad para API fintech.
 */
const securityHeaders = helmet({
  // Content-Security-Policy: API pura, no sirve HTML
  contentSecurityPolicy: false,
  // Strict-Transport-Security: HTTPS obligatorio
  hsts: {
    maxAge: 31536000,        // 1 año
    includeSubDomains: true,
    preload: true,
  },
  // Evitar que navegadores "adivinen" el MIME type
  noSniff: true,
  // Ocultar X-Powered-By
  hidePoweredBy: true,
  // Referrer policy restrictiva
  referrerPolicy: { policy: 'no-referrer' },
  // No permitir frames
  frameguard: { action: 'deny' },
  // XSS Protection
  xssFilter: true,
});

/**
 * Middleware que agrega headers personalizados de la API ZIVA.
 */
function zivaHeaders(req, res, next) {
  // Identificador de API
  res.setHeader('X-ZIVA-Version', '1.0.0');
  // No cachear respuestas de la API
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Prevenir información de timing
  res.setHeader('Timing-Allow-Origin', 'none');
  next();
}

/**
 * Middleware que verifica que las requests críticas vengan por HTTPS en producción.
 */
function enforceHttps(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  // Verificar el header X-Forwarded-Proto (Railway/Render usan proxies)
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') {
    logger.warn('Intento de conexión HTTP bloqueado en producción', { ip: req.ip });
    return res.status(403).json({
      error: 'HTTPS requerido. Las conexiones HTTP no están permitidas.',
    });
  }

  next();
}

module.exports = { securityHeaders, zivaHeaders, enforceHttps };
