'use strict';

// ─── SINGLE SOURCE OF TRUTH ───────────────────────────────────────────────────
// Este es el ÚNICO archivo en todo el codebase que instancia Pool.
// Ningún otro archivo debe importar 'pg' ni crear conexiones directamente.

const { Pool } = require('pg');
const logger = require('../utils/logger');

// ─── CONSTANTES DE RETRY ──────────────────────────────────────────────────────
const MAX_RETRIES       = 5;
const BASE_BACKOFF_MS   = 500;   // Backoff inicial: 500ms, 1s, 2s, 4s, 8s
const CONNECT_TIMEOUT   = 10000; // 10 segundos por intento de conexión
const IDLE_TIMEOUT      = 30000;
const POOL_MAX          = 20;

// ─── VALIDACIÓN DE ENV (CRÍTICA — FAIL FAST) ──────────────────────────────────
// Se ejecuta en el momento que el módulo es requerido por primera vez.
if (!process.env.DATABASE_URL) {
  // Log sin exponer credenciales (DATABASE_URL podría no existir, no hay nada que ocultar)
  logger.error('[DB] FATAL: La variable de entorno DATABASE_URL no está definida.');
  logger.error('[DB] En Railway: Settings → Variables → Add DATABASE_URL');
  process.exit(1);
}

// Sanitizar la URL para logging: ocultar user:password
function sanitizeDbUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[URL_INVÁLIDA]';
  }
}

const SAFE_DB_URL = sanitizeDbUrl(process.env.DATABASE_URL);

// ─── INSTANCIA ÚNICA DEL POOL ─────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway requiere SSL con rejectUnauthorized: false (certificado auto-firmado)
  ssl: { rejectUnauthorized: false },
  max:                    POOL_MAX,
  idleTimeoutMillis:      IDLE_TIMEOUT,
  connectionTimeoutMillis: CONNECT_TIMEOUT,
  // Asegurar que NUNCA se use localhost como fallback
  // (connectionString tiene prioridad total sobre host/port individuales)
});

// ─── EVENTOS DEL POOL ─────────────────────────────────────────────────────────
pool.on('connect', (client) => {
  logger.debug('[DB] Cliente conectado al pool', { host: SAFE_DB_URL });
});

pool.on('acquire', () => {
  logger.debug('[DB] Cliente adquirido del pool');
});

pool.on('remove', () => {
  logger.debug('[DB] Cliente removido del pool');
});

pool.on('error', (err) => {
  // Error en cliente idle — no exponer stack completo en producción
  logger.error('[DB] Error inesperado en cliente idle del pool', {
    message: err.message,
    code:    err.code,
  });
  // No hacer process.exit aquí — el pool intentará recuperarse solo.
  // El exit fatal ocurre en initDB() si no se puede reconectar.
});

// ─── FUNCIÓN DE INIT CON RETRY ────────────────────────────────────────────────

/**
 * Inicializa y verifica la conexión a la base de datos.
 * Implementa retry con backoff exponencial (5 intentos).
 * 
 * DEBE ser llamada antes de iniciar el servidor HTTP.
 * Si falla todos los intentos → process.exit(1)
 * 
 * @returns {Promise<void>}
 */
async function initDB() {
  logger.info('[DB] Iniciando conexión a PostgreSQL...', { target: SAFE_DB_URL });

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Adquirir un cliente del pool y ejecutar health check
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        logger.info(`[DB] Conexión establecida exitosamente`, {
          attempt,
          target:   SAFE_DB_URL,
          pool_max: POOL_MAX,
        });
        return; // ✅ Conexión exitosa — salir del loop
      } finally {
        client.release();
      }
    } catch (err) {
      lastError = err;
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);

      logger.warn(`[DB] Intento ${attempt}/${MAX_RETRIES} fallido`, {
        error:      err.message,
        code:       err.code,
        next_retry: attempt < MAX_RETRIES ? `${backoffMs}ms` : 'ninguno',
      });

      if (attempt < MAX_RETRIES) {
        await _sleep(backoffMs);
      }
    }
  }

  // ─── TODOS LOS REINTENTOS AGOTADOS → FAIL FAST ────────────────────────────
  logger.error('[DB] FATAL: No se pudo establecer conexión con PostgreSQL después de todos los reintentos.', {
    attempts: MAX_RETRIES,
    target:   SAFE_DB_URL,
    error:    lastError?.message,
    code:     lastError?.code,
  });

  // Cerrar el pool limpiamente antes de salir
  try { await pool.end(); } catch (_) {}

  process.exit(1);
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

/**
 * Ejecuta una query parametrizada.
 * @param {string} text    SQL con placeholders $1, $2, ...
 * @param {Array}  params  Valores de los parámetros
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    logger.debug('[DB] Query ejecutada', {
      duration_ms: Date.now() - start,
      rows:        result.rowCount,
    });
    return result;
  } catch (err) {
    logger.error('[DB] Error ejecutando query', {
      error: err.message,
      code:  err.code,
      // NO loggear el texto de la query en producción (puede contener datos)
      query: process.env.NODE_ENV !== 'production' ? text : '[REDACTED]',
    });
    throw err;
  }
}

/**
 * Obtiene un cliente dedicado del pool para operaciones transaccionales.
 * 
 * IMPORTANTE: El caller es responsable de llamar client.release()
 * dentro de un bloque finally para evitar pool leaks.
 * 
 * @returns {Promise<import('pg').PoolClient>}
 * 
 * @example
 * const client = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT ...');
 *   await client.query('COMMIT');
 * } catch (err) {
 *   await client.query('ROLLBACK');
 *   throw err;
 * } finally {
 *   client.release();
 * }
 */
async function getClient() {
  const client = await pool.connect();

  // Guardar referencias originales antes de patchear
  const originalQuery   = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  // Patch: loggear última query ejecutada (útil para debug de transacciones)
  client.query = (...args) => {
    client._lastQuery = typeof args[0] === 'string' ? args[0] : '[object]';
    return originalQuery(...args);
  };

  // Patch: restaurar métodos originales al liberar
  client.release = () => {
    client.query   = originalQuery;
    client.release = originalRelease;
    return originalRelease();
  };

  return client;
}

// ─── UTILS INTERNOS ───────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = { query, getClient, initDB, pool };
