'use strict';

const authService = require('../services/authService');

/**
 * POST /auth/challenge
 * Genera un challenge para un ZID.
 */
async function requestChallenge(req, res, next) {
  try {
    const { zid } = req.body;
    const result = await authService.requestChallenge(zid);

    return res.status(200).json({
      success: true,
      message: 'Challenge generado. Firma el challenge con tu clave privada y envíalo a /auth/verify.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/verify
 * Verifica la firma del challenge (completa la autenticación).
 */
async function verifyChallenge(req, res, next) {
  try {
    const { zid, challenge, signature } = req.body;
    const result = await authService.verifyChallenge(zid, challenge, signature);

    return res.status(200).json({
      success: true,
      message: 'Autenticación exitosa',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestChallenge, verifyChallenge };
