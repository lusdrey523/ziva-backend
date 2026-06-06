'use strict';

require('dotenv').config();

const express = require('express');
const { pool } = require('./db/pool');

const app = express();

app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL no definida');
    process.exit(1);
  }

  try {
    await pool.query('SELECT 1');
    console.log('✅ Conectado a PostgreSQL');

    app.listen(PORT, () => {
      console.log(`🚀 Server corriendo en puerto ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Error conectando a DB:', err.message);
    process.exit(1);
  }
}

start();
