'use strict';

const reputationService = require('../services/reputationService');

/**
 * GET /reputation/:zid
 * Obtiene el score actual de reputación.
 */
async function getScore(req, res, next) {
  try {
    const { zid } = req.params;
    const result = await reputationService.getCurrentScore(zid);

    return res.status(200).json({
      success: true,
      data: {
        zid,
        score: parseFloat(result.score),
        factors: result.factors,
        algorithm_version: result.version,
        calculated_at: result.calculated_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /reputation/:zid/recalculate
 * Fuerza el recálculo del score de reputación.
 */
async function recalculate(req, res, next) {
  try {
    const { zid } = req.params;
    const result = await reputationService.recalculateScore(zid);

    return res.status(200).json({
      success: true,
      message: 'Score recalculado exitosamente',
      data: {
        zid,
        score: result.score,
        factors: result.factors,
        recalculated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /reputation/:zid/history
 * Obtiene el historial de scores.
 */
async function getHistory(req, res, next) {
  try {
    const { zid } = req.params;
    const { limit } = req.query;
    const history = await reputationService.getScoreHistory(zid, limit);

    return res.status(200).json({
      success: true,
      data: { zid, history },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getScore, recalculate, getHistory };
