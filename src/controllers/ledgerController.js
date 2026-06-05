'use strict';

const ledgerService = require('../services/ledgerService');

/**
 * POST /ledger/event
 * Registra un evento firmado en el ledger.
 */
async function submitEvent(req, res, next) {
  try {
    const { zid, event, signature } = req.body;
    const ip_address = req.ip;

    const result = await ledgerService.submitEvent({ zid, event, signature, ip_address });

    return res.status(201).json({
      success: true,
      message: 'Evento registrado en el ledger',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /ledger/:zid
 * Obtiene los eventos del ledger de un ZID.
 */
async function getEvents(req, res, next) {
  try {
    const { zid } = req.params;
    const { limit, offset, event_type } = req.query;

    const result = await ledgerService.getEvents(zid, { limit, offset, event_type });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitEvent, getEvents };
