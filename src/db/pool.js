'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Retry de conexión (CRÍTICO en Railway)
async function connectWithRetry(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('✅ PostgreSQL conectado');
      client.release();
      return;
    } catch (err) {
      console.log(`⏳ Intento ${i + 1} fallido... reintentando en ${delay}ms`);
      await new Promise(res => setTimeout(res, delay));
    }
  }

  console.error('❌ No se pudo conectar a PostgreSQL');
  process.exit(1);
}

module.exports = {
  pool,
  connectWithRetry,
};
