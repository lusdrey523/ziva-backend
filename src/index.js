require('dotenv').config();

const express = require('express');
const { connectWithRetry } = require('./db/pool');

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ZIVA Backend OK' });
});

// 🚨 ARRANQUE CONTROLADO
async function startServer() {
  try {
    await connectWithRetry(); // ← CLAVE

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`🚀 Server corriendo en puerto ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
  }
}

startServer();
