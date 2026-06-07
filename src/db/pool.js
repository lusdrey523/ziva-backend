'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

// Determinar SSL automáticamente si se indica en DATABASE_URL
const connectionString = process.env.DATABASE_URL;
const dbSslEnv = String(process.env.DB_SSL || '').toLowerCase();
const shouldUseSsl = dbSslEnv === 'true' || /sslmode=require|ssl=true/i.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  logger.debug('Nueva conexión establecida con PostgreSQL');
});

// Manejo de errores del pool: loguear pero no terminar el proceso.
// El pool de `pg` reintentará conexiones según su propia lógica.
pool.on('error', (err) => {
  logger.error('Error inesperado en el pool de PostgreSQL', { error: err.message });
});

// Espera la disponibilidad de la base de datos intentando `pool.connect()`.
// No ejecuta queries durante el proceso de verificación (cumple regla).
async function waitForConnection(options = {}) {
  const maxRetries = parseInt(options.maxRetries || process.env.DB_CONN_MAX_RETRIES || '15', 10);
  const baseDelay = parseInt(options.baseDelayMs || process.env.DB_CONN_BASE_DELAY_MS || '3000', 10);
  const factor = parseFloat(options.factor || process.env.DB_CONN_BACKOFF_FACTOR || '1.7');
  const jitter = parseFloat(options.jitter || process.env.DB_CONN_JITTER || '0.3');

  // Evitar usar localhost en producción
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(connectionString || '')) {
    throw new Error('Conexión inválida: no use localhost en producción. Configure process.env.DATABASE_URL correctamente.');
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (err) {
      const attemptNum = attempt + 1;
      logger.warn(`Intento ${attemptNum}/${maxRetries} para conectar a la DB falló`, { error: err.message });
      if (attempt + 1 >= maxRetries) break;
      // Exponential backoff con jitter
      const backoff = Math.min(60000, Math.round(baseDelay * Math.pow(factor, attempt)));
      const jitterMs = Math.round((Math.random() * 2 - 1) * jitter * backoff);
      const waitMs = Math.max(500, backoff + jitterMs);
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }

  throw new Error('DB no disponible después de múltiples intentos');
}

/**
 * Ejecuta una query con parámetros.
 * @param {string} text - SQL query
 * @param {Array} params - Parámetros de la query
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query ejecutada', { duration_ms: duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('Error ejecutando query', { error: err.message, query: text });
    throw err;
  }
}

/**
 * Obtiene un cliente del pool para transacciones.
 */
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  // Wrapper para loggear queries dentro de transacciones
  client.query = (...args) => {
    client.lastQuery = args[0];
    return originalQuery(...args);
  };

  client.release = () => {
    client.query = originalQuery;
    client.release = release;
    return release();
  };

  return client;
}

module.exports = { query, getClient, pool, waitForConnection };
