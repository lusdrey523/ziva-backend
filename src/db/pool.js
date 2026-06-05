'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  logger.debug('PostgreSQL conectado');
});

pool.on('error', (err) => {
  logger.error('Error en pool', { error: err.message });
});

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    logger.error('Error query', { error: err.message });
    throw err;
  }
}

module.exports = { query, pool };
