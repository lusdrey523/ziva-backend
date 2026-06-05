'use strict';

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { validateBody } = require('../middlewares/validation');
const { authLimiter } = require('../middlewares/rateLimiter');

// POST /auth/challenge
router.post(
  '/challenge',
  authLimiter,
  validateBody('requestChallenge'),
  authController.requestChallenge
);

// POST /auth/verify
router.post(
  '/verify',
  authLimiter,
  validateBody('verifyChallenge'),
  authController.verifyChallenge
);

module.exports = router;
