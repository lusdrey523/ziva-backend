'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// ─── HANDLER COMPARTIDO ───────────────────────────────────────────────────────
function rateLimitHandler(req, res) {
  logger.warn('Rate limit alcanzado', {
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
  return res.status(429).json({
    error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
    retryAfter: res.getHeader('Retry-After'),
  });
}

// ─── RATE LIMITER GENERAL ─────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.ip,
});

// ─── RATE LIMITER PARA AUTENTICACIÓN (más estricto) ───────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `auth:${req.ip}:${req.body?.zid || 'unknown'}`,
  skipSuccessfulRequests: false,
});

// ─── RATE LIMITER PARA REGISTRO (muy estricto) ────────────────────────────────
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // Máximo 5 registros por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `register:${req.ip}`,
});

// ─── RATE LIMITER PARA LEDGER ────────────────────────────────────────────────
const ledgerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // Máximo 30 eventos por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `ledger:${req.ip}:${req.body?.zid || 'unknown'}`,
});

module.exports = {
  generalLimiter,
  authLimiter,
  registrationLimiter,
  ledgerLimiter,
};
