'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL no está definida');
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: isProduction
    ? {
        rejectUnauthorized: false,
      }
    : false,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test de conexión al iniciar
pool
  .connect()
  .then((client) => {
    console.log('✅ PostgreSQL conectado correctamente');
    client.release();
  })
  .catch((err) => {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
    process.exit(1);
  });

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };        return; // ✅ Conexión exitosa — salir del loop
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
