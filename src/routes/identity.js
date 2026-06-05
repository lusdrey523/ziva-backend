'use strict';

const express = require('express');
const router = express.Router();

const identityController = require('../controllers/identityController');
const { validateBody, validateParams } = require('../middlewares/validation');
const { registrationLimiter } = require('../middlewares/rateLimiter');

// POST /identity/register
router.post(
  '/register',
  registrationLimiter,
  validateBody('registerIdentity'),
  identityController.register
);

// GET /identity/:zid
router.get(
  '/:zid',
  validateParams('getReputation'), // Reutiliza el schema de validación de zid
  identityController.getIdentity
);

module.exports = router;
