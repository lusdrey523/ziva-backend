'use strict';

const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('🔗 PostgreSQL conectado');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en PostgreSQL:', err.message);
});

module.exports = { pool };
