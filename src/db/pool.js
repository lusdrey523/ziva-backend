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

pool.on('error', (err) => {
  logger.error('Error inesperado en el pool de PostgreSQL', { error: err.message });
  process.exit(-1);
});

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

module.exports = { query, getClient, pool };
