'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL no está definido. Revisa variables en Railway.');
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Evento conexión
pool.on('connect', () => {
  logger.info('✅ Conectado a PostgreSQL');
});

// Evento error crítico
pool.on('error', (err) => {
  logger.error('❌ Error en pool PostgreSQL', { error: err.message });
  process.exit(1);
});

// Query helper
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query ejecutada', { duration_ms: duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('❌ Error ejecutando query', { error: err.message });
    throw err;
  }
}

// Cliente para transacciones
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

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
