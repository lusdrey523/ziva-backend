'use strict';

const db = require('../db/pool');
const {
  validatePublicKeyJWK,
  importPublicKeyFromJWK,
  verifySignature,
  buildRegistrationPayload,
  hashPublicKey,
} = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Registra una nueva identidad criptográfica ZIVA.
 * @param {object} params
 * @param {string} params.zid
 * @param {object} params.publicKey - JWK
 * @param {string} params.signature - base64
 * @param {string} [params.country_code]
 */
async function registerIdentity({ zid, publicKey, signature, country_code }) {
  // 1. Validar estructura del JWK
  validatePublicKeyJWK(publicKey);

  // 2. Reconstruir el payload que el cliente debió firmar
  const expectedPayload = buildRegistrationPayload(zid, publicKey);

  // 3. Verificar la firma
  const isValid = verifySignature(publicKey, expectedPayload, signature);
  if (!isValid) {
    logger.warn('Firma de registro inválida', { zid });
    throw Object.assign(new Error('Firma ECDSA inválida. Verifica que el payload firmado sea correcto.'), { status: 401 });
  }

  // 4. Calcular zid_hash (SHA-256 del JWK canónico)
  const zidHash = hashPublicKey(publicKey);

  // 5. Verificar duplicados (zid y publicKey)
  const existingCheck = await db.query(
    'SELECT zid, zid_hash FROM identities WHERE zid = $1 OR zid_hash = $2',
    [zid, zidHash]
  );

  if (existingCheck.rowCount > 0) {
    const existing = existingCheck.rows[0];
    if (existing.zid === zid) {
      throw Object.assign(new Error(`El ZID "${zid}" ya está registrado.`), { status: 409 });
    }
    throw Object.assign(new Error('Esta clave pública ya está asociada a otra identidad.'), { status: 409 });
  }

  // 6. Insertar la identidad
  const result = await db.query(
    `INSERT INTO identities (zid, zid_hash, public_key, country_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, zid, zid_hash, country_code, status, created_at`,
    [zid, zidHash, JSON.stringify(publicKey), country_code || null]
  );

  const identity = result.rows[0];
  logger.info('Identidad registrada exitosamente', { zid, id: identity.id });

  // 7. Crear score inicial de reputación
  await _initializeReputationScore(zid);

  return {
    id: identity.id,
    zid: identity.zid,
    zid_hash: identity.zid_hash,
    country_code: identity.country_code,
    status: identity.status,
    created_at: identity.created_at,
  };
}

/**
 * Obtiene la información pública de una identidad.
 * @param {string} zid
 */
async function getIdentity(zid) {
  const result = await db.query(
    `SELECT id, zid, zid_hash, public_key, country_code, status, created_at
     FROM identities WHERE zid = $1 AND status = 'active'`,
    [zid]
  );

  if (result.rowCount === 0) {
    throw Object.assign(new Error(`Identidad "${zid}" no encontrada.`), { status: 404 });
  }

  const row = result.rows[0];
  return {
    id: row.id,
    zid: row.zid,
    zid_hash: row.zid_hash,
    public_key: row.public_key,
    country_code: row.country_code,
    status: row.status,
    created_at: row.created_at,
  };
}

/**
 * Obtiene la clave pública JWK de un ZID (uso interno).
 * @param {string} zid
 * @returns {object} JWK
 */
async function getPublicKeyByZid(zid) {
  const result = await db.query(
    `SELECT public_key FROM identities WHERE zid = $1 AND status = 'active'`,
    [zid]
  );

  if (result.rowCount === 0) {
    throw Object.assign(new Error(`Identidad "${zid}" no encontrada o inactiva.`), { status: 404 });
  }

  return result.rows[0].public_key;
}

/**
 * Inicializa el score de reputación base al crear una identidad.
 * @param {string} zid
 */
async function _initializeReputationScore(zid) {
  const initialFactors = {
    activity: 0,
    transaction_history: 0,
    consistency: 0,
    trust_signals: 0,
    account_age_days: 0,
  };

  await db.query(
    `INSERT INTO reputation_scores (zid, score, factors, version, is_current)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [zid, 0, JSON.stringify(initialFactors), 1]
  );
}

module.exports = { registerIdentity, getIdentity, getPublicKeyByZid };
