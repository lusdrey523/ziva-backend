'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const CURVE = 'prime256v1'; // ECDSA P-256
const HASH_ALGO = 'SHA256';
const JWK_REQUIRED_FIELDS = ['kty', 'crv', 'x', 'y'];
const JWK_EXPECTED_KTY = 'EC';
const JWK_EXPECTED_CRV = 'P-256';

/**
 * Valida que un objeto sea un JWK de clave pública P-256 válido.
 * @param {object} jwk
 * @throws {Error} si el JWK es inválido
 */
function validatePublicKeyJWK(jwk) {
  if (!jwk || typeof jwk !== 'object') {
    throw new Error('El publicKey debe ser un objeto JWK');
  }

  for (const field of JWK_REQUIRED_FIELDS) {
    if (!jwk[field]) {
      throw new Error(`Campo requerido faltante en JWK: ${field}`);
    }
  }

  if (jwk.kty !== JWK_EXPECTED_KTY) {
    throw new Error(`JWK kty inválido: se esperaba "${JWK_EXPECTED_KTY}", se recibió "${jwk.kty}"`);
  }

  if (jwk.crv !== JWK_EXPECTED_CRV) {
    throw new Error(`JWK crv inválido: se esperaba "${JWK_EXPECTED_CRV}", se recibió "${jwk.crv}"`);
  }

  // Verificar que x e y son base64url válidos y tienen la longitud correcta para P-256 (32 bytes = 43 chars base64url)
  const xBytes = Buffer.from(jwk.x, 'base64url');
  const yBytes = Buffer.from(jwk.y, 'base64url');

  if (xBytes.length !== 32 || yBytes.length !== 32) {
    throw new Error('Las coordenadas x e y del JWK deben ser de 32 bytes (P-256)');
  }

  // Rechazar claves privadas — el servidor NUNCA debe recibir d
  if (jwk.d) {
    throw new Error('El servidor no acepta claves privadas (campo "d" detectado en JWK)');
  }
}

/**
 * Importa un JWK de clave pública P-256 como KeyObject de Node.js.
 * @param {object} jwk
 * @returns {crypto.KeyObject}
 */
function importPublicKeyFromJWK(jwk) {
  try {
    validatePublicKeyJWK(jwk);
    // Solo pasar los campos públicos para evitar fugas de datos
    const publicJWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    return crypto.createPublicKey({ key: publicJWK, format: 'jwk' });
  } catch (err) {
    logger.warn('Error importando clave pública JWK', { error: err.message });
    throw new Error(`JWK inválido: ${err.message}`);
  }
}

/**
 * Verifica una firma ECDSA P-256 sobre un payload.
 * @param {crypto.KeyObject|object} publicKey - KeyObject o JWK
 * @param {string|Buffer} payload - Datos firmados (se hashea con SHA-256 internamente)
 * @param {string} signatureBase64 - Firma en base64 (DER o IEEE P1363)
 * @returns {boolean}
 */
function verifySignature(publicKey, payload, signatureBase64) {
  try {
    const keyObject = publicKey instanceof crypto.KeyObject
      ? publicKey
      : importPublicKeyFromJWK(publicKey);

    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

    const verifier = crypto.createVerify(HASH_ALGO);
    verifier.update(payloadBuffer);

    // Node.js acepta DER (ASN.1) directamente
    return verifier.verify(keyObject, signatureBuffer);
  } catch (err) {
    logger.warn('Fallo en verificación de firma', { error: err.message });
    return false;
  }
}

/**
 * Genera el payload canónico para registro de identidad.
 * El cliente DEBE firmar exactamente este string.
 * @param {string} zid
 * @param {object} publicKey - JWK
 * @returns {string}
 */
function buildRegistrationPayload(zid, publicKey) {
  // Canonical JSON: llaves ordenadas alfabéticamente, sin espacios
  const jwkCanonical = canonicalJSON({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x, y: publicKey.y });
  return canonicalJSON({ publicKey: JSON.parse(jwkCanonical), zid });
}

/**
 * Calcula el SHA-256 del JWK canónico de la clave pública.
 * Se usa como zid_hash para deduplicación segura.
 * @param {object} jwk
 * @returns {string} hex
 */
function hashPublicKey(jwk) {
  const canonical = canonicalJSON({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Genera un challenge criptográficamente seguro de 32 bytes.
 * @returns {string} hex (64 caracteres)
 */
function generateChallenge() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calcula el SHA-256 de un string o Buffer.
 * @param {string|Buffer} data
 * @returns {string} hex
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Serializa un objeto a JSON canónico (llaves ordenadas recursivamente).
 * Necesario para que cliente y servidor produzcan el mismo string a firmar.
 * @param {*} obj
 * @returns {string}
 */
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(obj[key])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Calcula el hash SHA-256 de un payload de evento del ledger.
 * @param {object} eventPayload
 * @returns {string} hex
 */
function hashEventPayload(eventPayload) {
  return sha256(canonicalJSON(eventPayload));
}

module.exports = {
  validatePublicKeyJWK,
  importPublicKeyFromJWK,
  verifySignature,
  buildRegistrationPayload,
  hashPublicKey,
  generateChallenge,
  sha256,
  canonicalJSON,
  hashEventPayload,
};
