'use strict';

const db = require('../db/pool');
const { generateChallenge, verifySignature } = require('../utils/crypto');
const { getPublicKeyByZid } = require('./identityService');
const logger = require('../utils/logger');

const CHALLENGE_TTL_MS = parseInt(process.env.CHALLENGE_TTL_MS || '60000', 10);

/**
 * PASO 1: Genera un challenge aleatorio para un ZID.
 * El challenge expira en CHALLENGE_TTL_MS milisegundos.
 * @param {string} zid
 * @returns {{ challenge: string, expires_at: string }}
 */
async function requestChallenge(zid) {
  // Verificar que el ZID existe y está activo
  await getPublicKeyByZid(zid); // Lanza 404 si no existe

  // Limpiar challenges anteriores no usados para este ZID (anti-flooding)
  await db.query(
    `DELETE FROM auth_challenges WHERE zid = $1`,
    [zid]
  );

  const challenge = generateChallenge(); // 32 bytes hex = 64 chars
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await db.query(
    `INSERT INTO auth_challenges (zid, challenge, expires_at)
     VALUES ($1, $2, $3)`,
    [zid, challenge, expiresAt]
  );

  logger.info('Challenge generado', { zid, expires_at: expiresAt.toISOString() });

  return {
    challenge,
    expires_at: expiresAt.toISOString(),
    ttl_seconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

/**
 * PASO 2: Verifica la firma del challenge.
 * Anti-replay: el challenge se marca como usado inmediatamente.
 * @param {string} zid
 * @param {string} challenge - hex de 64 chars
 * @param {string} signature - base64
 * @returns {{ verified: boolean, zid: string }}
 */
async function verifyChallenge(zid, challenge, signature) {
  // Buscar el challenge en base de datos con transacción para prevenir condición de carrera
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // SELECT FOR UPDATE: bloquea el row para prevenir replay concurrente
    const result = await client.query(
      `SELECT id, zid, challenge, expires_at, used
       FROM auth_challenges
       WHERE zid = $1 AND challenge = $2
       FOR UPDATE`,
      [zid, challenge]
    );

    if (result.rowCount === 0) {
      throw Object.assign(
        new Error('Challenge no encontrado o ya fue eliminado.'),
        { status: 401 }
      );
    }

    const challengeRow = result.rows[0];

    // Verificar que no haya sido usado (replay attack)
    if (challengeRow.used) {
      logger.warn('Intento de replay attack detectado', { zid });
      throw Object.assign(new Error('Challenge ya fue utilizado (replay attack).'), { status: 401 });
    }

    // Verificar expiración
    if (new Date() > new Date(challengeRow.expires_at)) {
      await client.query('DELETE FROM auth_challenges WHERE id = $1', [challengeRow.id]);
      await client.query('COMMIT');
      throw Object.assign(new Error('Challenge expirado. Solicita uno nuevo.'), { status: 401 });
    }

    // Marcar como usado ANTES de verificar firma (previene timing attacks y replay)
    await client.query(
      `UPDATE auth_challenges SET used = TRUE WHERE id = $1`,
      [challengeRow.id]
    );

    await client.query('COMMIT');

    // Verificar la firma fuera de la transacción
    const publicKey = await getPublicKeyByZid(zid);
    // El cliente firma el challenge en hex (como string)
    const isValid = verifySignature(publicKey, challenge, signature);

    if (!isValid) {
      logger.warn('Verificación de challenge fallida: firma inválida', { zid });
      throw Object.assign(new Error('Firma del challenge inválida.'), { status: 401 });
    }

    logger.info('Autenticación exitosa', { zid });

    return {
      verified: true,
      zid,
      authenticated_at: new Date().toISOString(),
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Limpia challenges expirados o usados.
 * Llamar periódicamente (ej: cron job o en cada request de challenge).
 */
async function cleanupChallenges() {
  const result = await db.query(
    `DELETE FROM auth_challenges WHERE expires_at < NOW() OR used = TRUE`
  );
  return result.rowCount;
}

module.exports = { requestChallenge, verifyChallenge, cleanupChallenges };
