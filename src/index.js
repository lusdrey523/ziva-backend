'use strict';

const express = require('express');
const { pool } = require('./db/pool');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check (clave para Railway)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Ruta base
app.get('/', (req, res) => {
  res.send('ZIVA Backend running');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
