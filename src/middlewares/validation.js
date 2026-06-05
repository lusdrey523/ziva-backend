'use strict';

const Joi = require('joi');

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

/**
 * Schema JWK de clave pública P-256.
 */
const jwkPublicKeySchema = Joi.object({
  kty: Joi.string().valid('EC').required(),
  crv: Joi.string().valid('P-256').required(),
  x:   Joi.string().base64({ urlSafe: true, paddingRequired: false }).required(),
  y:   Joi.string().base64({ urlSafe: true, paddingRequired: false }).required(),
  // Rechazar explícitamente el campo de clave privada
  d:   Joi.forbidden().messages({ 'any.unknown': 'El campo "d" (clave privada) no está permitido' }),
}).unknown(false); // No permitir campos adicionales desconocidos en el JWK

const schemas = {
  // POST /identity/register
  registerIdentity: Joi.object({
    zid: Joi.string()
      .alphanum()
      .min(4)
      .max(64)
      .required()
      .messages({
        'string.alphanum': 'El zid solo puede contener letras y números',
        'string.min': 'El zid debe tener al menos 4 caracteres',
        'string.max': 'El zid no puede superar 64 caracteres',
      }),
    publicKey: jwkPublicKeySchema.required(),
    signature: Joi.string()
      .base64()
      .required()
      .messages({ 'string.base64': 'La firma debe estar en formato base64' }),
    country_code: Joi.string()
      .length(2)
      .uppercase()
      .optional()
      .messages({ 'string.length': 'country_code debe ser un código ISO 3166-1 alpha-2 de 2 letras' }),
  }),

  // POST /auth/challenge
  requestChallenge: Joi.object({
    zid: Joi.string().alphanum().min(4).max(64).required(),
  }),

  // POST /auth/verify
  verifyChallenge: Joi.object({
    zid:       Joi.string().alphanum().min(4).max(64).required(),
    challenge: Joi.string().hex().length(64).required()
      .messages({ 'string.length': 'El challenge debe ser un hex de 64 caracteres (32 bytes)' }),
    signature: Joi.string().base64().required(),
  }),

  // POST /ledger/event
  submitLedgerEvent: Joi.object({
    zid: Joi.string().alphanum().min(4).max(64).required(),
    event: Joi.object({
      type: Joi.string().alphanum().max(64).required(),
    })
    .unknown(true) // El payload del evento puede tener campos arbitrarios
    .required(),
    signature: Joi.string().base64().required(),
  }),

  // GET /reputation/:zid
  getReputation: Joi.object({
    zid: Joi.string().alphanum().min(4).max(64).required(),
  }),
};

/**
 * Middleware factory: valida req.body contra un schema Joi.
 * @param {string} schemaName - Nombre del schema en el objeto schemas
 */
function validateBody(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      return res.status(500).json({ error: 'Schema de validación no encontrado' });
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,      // Retornar todos los errores, no solo el primero
      stripUnknown: true,     // Eliminar campos no definidos en el schema
      allowUnknown: false,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({
        error: 'Error de validación',
        details,
      });
    }

    req.body = value; // Usar el valor sanitizado
    return next();
  };
}

/**
 * Middleware factory: valida req.params contra un schema Joi.
 * @param {string} schemaName
 */
function validateParams(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      return res.status(500).json({ error: 'Schema de validación no encontrado' });
    }

    const { error, value } = schema.validate(req.params, { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
      return res.status(400).json({ error: 'Parámetros inválidos', details });
    }

    req.params = value;
    return next();
  };
}

module.exports = { validateBody, validateParams, schemas };
