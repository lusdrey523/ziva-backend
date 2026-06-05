'use strict';

const winston = require('winston');

// ─── CAMPOS SENSIBLES A OMITIR DEL LOG ────────────────────────────────────────
const SENSITIVE_FIELDS = [
  'privateKey', 'private_key', 'password', 'token', 'secret',
  'authorization', 'cookie', 'signature', 'x-api-key'
];

/**
 * Filtra campos sensibles de un objeto antes de loggear.
 */
function sanitize(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitize(item, depth + 1));

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitize(value, depth + 1);
    }
  }
  return sanitized;
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const cleanMeta = Object.keys(meta).length ? JSON.stringify(sanitize(meta), null, 2) : '';
  return `${timestamp} [${level}] ${stack || message} ${cleanMeta}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : combine(colorize(), consoleFormat)
  ),
  transports: [
    new winston.transports.Console(),
  ],
  // En producción agregar transporte a archivo o servicio externo (Datadog, etc.)
});

// Wrapper para sanitizar automáticamente los metadatos
const safeLogger = {
  error: (msg, meta = {}) => logger.error(msg, sanitize(meta)),
  warn:  (msg, meta = {}) => logger.warn(msg, sanitize(meta)),
  info:  (msg, meta = {}) => logger.info(msg, sanitize(meta)),
  debug: (msg, meta = {}) => logger.debug(msg, sanitize(meta)),
  http:  (msg, meta = {}) => logger.http(msg, sanitize(meta)),
};

module.exports = safeLogger;
