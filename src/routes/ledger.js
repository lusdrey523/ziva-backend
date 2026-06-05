'use strict';

const express = require('express');
const router = express.Router();

const ledgerController = require('../controllers/ledgerController');
const { validateBody, validateParams } = require('../middlewares/validation');
const { ledgerLimiter } = require('../middlewares/rateLimiter');

// POST /ledger/event
router.post(
  '/event',
  ledgerLimiter,
  validateBody('submitLedgerEvent'),
  ledgerController.submitEvent
);

// GET /ledger/:zid
router.get(
  '/:zid',
  validateParams('getReputation'),
  ledgerController.getEvents
);

module.exports = router;
