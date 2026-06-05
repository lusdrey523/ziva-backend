'use strict';

const express = require('express');
const router = express.Router();

const reputationController = require('../controllers/reputationController');
const { validateParams } = require('../middlewares/validation');
const { generalLimiter } = require('../middlewares/rateLimiter');

// GET /reputation/:zid
router.get(
  '/:zid',
  generalLimiter,
  validateParams('getReputation'),
  reputationController.getScore
);

// POST /reputation/:zid/recalculate
router.post(
  '/:zid/recalculate',
  generalLimiter,
  validateParams('getReputation'),
  reputationController.recalculate
);

// GET /reputation/:zid/history
router.get(
  '/:zid/history',
  generalLimiter,
  validateParams('getReputation'),
  reputationController.getHistory
);

module.exports = router;
