'use strict';

// ─── ENV DEBE CARGARSE PRIMERO, ANTES DE CUALQUIER OTRO IMPORT ────────────────
require('dotenv').config();

// ─── DB: importar DESPUÉS de dotenv para que DATABASE_URL ya esté disponible ──
// pool.js valida DATABASE_URL en el momento del require() — fail fast garantizado.
const { initDB, pool } = require('./db/pool');

const express = require('express');
const logger  = require('./utils/logger');

const { securityHeaders, zivaHeaders, enforceHttps } = require('./middlewares/security');
const { httpLogger, errorHandler, notFound }          = require('./middlewares/logger');
const { generalLimiter }                              = require('./middlewares/rateLimiter');

const identityRoutes   = require('./routes/identity');
const authRoutes       = require('./routes/auth');
const ledgerRoutes     = require('./routes/ledger');
const reputationRoutes = require('./routes/reputation');

// ─── APLICACIÓN EXPRESS ───────────────────────────────────────────────────────
const app = express();

app.set('trust proxy', 1); // Railway/Render terminan SSL en el proxy

// ─── MIDDLEWARES GLOBALES ─────────────────────────────────────────────────────
app.use(enforceHttps);
app.use(securityHeaders);
app.use(zivaHeaders);
app.use(httpLogger);
app.use(generalLimiter);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status:      'ok',
    service:     'ZIVA Identity Platform',
    version:     '1.0.0',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── RUTAS ────────────────────────────────────────────────────────────────────
app.use('/identity',   identityRoutes);
app.use('/auth',       authRoutes);
app.use('/ledger',     ledgerRoutes);
app.use('/reputation', reputationRoutes);

// ─── MANEJO DE ERRORES ────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── MANEJO DE ERRORES NO CAPTURADOS ──────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('[APP] Promise rechazada no manejada', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('[APP] Excepción no capturada — saliendo', { error: err.message });
  process.exit(1);
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`[APP] ${signal} recibido — iniciando shutdown limpio...`);
  try {
    await pool.end();
    logger.info('[APP] Pool de DB cerrado correctamente.');
  } catch (err) {
    logger.warn('[APP] Error cerrando el pool de DB', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── INICIO DEL SERVIDOR ──────────────────────────────────────────────────────
// ORDEN ESTRICTO:
//   1. initDB()  → conecta, verifica con SELECT 1, reintenta hasta 5 veces
//   2. app.listen() → solo arranca si la DB respondió correctamente
//
// Si initDB() falla todos los reintentos → process.exit(1) dentro de initDB()
// El servidor NUNCA arranca sin DB confirmada.

const PORT = parseInt(process.env.PORT || '3000', 10);

(async () => {
  // PASO 1: Inicializar y verificar la base de datos
  await initDB();

  // PASO 2: Arrancar el servidor HTTP (DB confirmada)
  app.listen(PORT, () => {
    logger.info('[APP] ZIVA Identity Platform iniciada', {
      port:         PORT,
      environment:  process.env.NODE_ENV || 'development',
      node_version: process.version,
    });
  });
})();

module.exports = app;
