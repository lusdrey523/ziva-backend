'use strict';

const identityService = require('../services/identityService');
const logger = require('../utils/logger');

/**
 * POST /identity/register
 * Registra una nueva identidad criptográfica ZIVA.
 */
async function register(req, res, next) {
  try {
    const { zid, publicKey, signature, country_code } = req.body;

    const result = await identityService.registerIdentity({
      zid,
      publicKey,
      signature,
      country_code,
    });

    return res.status(201).json({
      success: true,
      message: 'Identidad registrada exitosamente',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /identity/:zid
 * Obtiene la información pública de una identidad.
 */
async function getIdentity(req, res, next) {
  try {
    const { zid } = req.params;
    const identity = await identityService.getIdentity(zid);

    return res.status(200).json({
      success: true,
      data: identity,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, getIdentity };
