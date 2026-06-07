'use strict';

// Cargar variables de entorno (solo si existe .env local)
try {
  require('dotenv').config();
} catch (err) {
  // dotenv es opcional en producción
}

// Validar que DATABASE_URL esté disponible
function validateEnv() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL no está definida. Verifica que la variable esté configurada en Railway.');
    process.exit(1);
  }

  // En producción, recomendar variables críticas adicionales
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DB_SSL && !/sslmode=/i.test(process.env.DATABASE_URL || '')) {
      console.warn('WARN: DB_SSL no está definida. Se recomienda establecer DB_SSL=true en Railway.');
    }

    if (!process.env.JWT_SECRET && !process.env.PRIVATE_KEY) {
      console.warn('WARN: JWT_SECRET o PRIVATE_KEY no están definidas. Verifica que los secretos necesarios estén configurados en Railway.');
    }
  }
}

validateEnv();

const express = require('express');
const { securityHeaders, zivaHeaders, enforceHttps } = require('./middlewares/security');
const { httpLogger, errorHandler, notFound } = require('./middlewares/logger');
const { generalLimiter } = require('./middlewares/rateLimiter');
const logger = require('./utils/logger');

// ─── RUTAS ────────────────────────────────────────────────────────────────────
const identityRoutes    = require('./routes/identity');
const authRoutes        = require('./routes/auth');
const ledgerRoutes      = require('./routes/ledger');
const reputationRoutes  = require('./routes/reputation');

const app = express();

// ─── CONFIANZA EN PROXY (Railway/Render usan proxies) ─────────────────────────
app.set('trust proxy', 1);

// ─── MIDDLEWARES GLOBALES ─────────────────────────────────────────────────────
app.use(enforceHttps);
app.use(securityHeaders);
app.use(zivaHeaders);
app.use(httpLogger);
app.use(generalLimiter);

// Parsear JSON con límite de tamaño (evita payloads maliciosos grandes)
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ZIVA Identity Platform',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── RUTAS DE LA API ──────────────────────────────────────────────────────────
app.use('/identity',    identityRoutes);
app.use('/auth',        authRoutes);
app.use('/ledger',      ledgerRoutes);
app.use('/reputation',  reputationRoutes);

// ─── MANEJO DE ERRORES ────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── INICIO DEL SERVIDOR ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  try {
    // Verificar conexión a base de datos antes de iniciar
    const db = require('./db/pool');
    await db.query('SELECT 1');
    logger.info('Conexión a PostgreSQL establecida correctamente');

    app.listen(PORT, () => {
      logger.info(`ZIVA Identity Platform iniciada`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        node_version: process.version,
      });
    });
  } catch (err) {
    logger.error('Error al iniciar el servidor', { error: err.message });
    process.exit(1);
  }
}

// ─── MANEJO DE ERRORES NO CAPTURADOS ──────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Promise rechazada no manejada', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Excepción no capturada', { error: err.message });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido, cerrando servidor...');
  try {
    const { pool } = require('./db/pool');
    // Intentar cerrar conexiones con timeout razonable
    const shutdownPromise = pool.end();
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([shutdownPromise, timeout]);
    logger.info('Pool de DB cerrado (o timeout alcanzado)');
  } catch (err) {
    logger.error('Error durante shutdown', { error: err.message });
  } finally {
    process.exit(0);
  }
});

startServer();

module.exports = app; // Para testing
