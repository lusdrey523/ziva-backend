import 'dotenv/config';
import { pool } from './db/pool.js';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Test de conexión
    await pool.query('SELECT 1');

    console.log('✅ DB conectada correctamente');

    // Aquí va tu app (Express probablemente)
    app.listen(PORT, () => {
      console.log(`🚀 Server corriendo en puerto ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error.message);
    process.exit(1);
  }
}

startServer();
