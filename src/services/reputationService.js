'use strict';

const db = require('../db/pool');
const logger = require('../utils/logger');

// ─── VERSIÓN DEL ALGORITMO ────────────────────────────────────────────────────
const SCORING_VERSION = 1;

// ─── PESOS DE FACTORES (deben sumar 100) ─────────────────────────────────────
const FACTOR_WEIGHTS = {
  activity:             25, // Frecuencia de actividad en los últimos 30 días
  transaction_history:  30, // Volumen y variedad de transacciones
  consistency:          20, // Regularidad del comportamiento
  trust_signals:        15, // Factores positivos: país verificado, antigüedad, etc.
  account_age:          10, // Antigüedad de la cuenta
};

/**
 * Recalcula el score de reputación para un ZID dado.
 * El cálculo es determinista: mismos datos → mismo resultado.
 * @param {string} zid
 * @returns {{ score: number, factors: object }}
 */
async function recalculateScore(zid) {
  // Recopilar todos los datos necesarios en paralelo
  const [identityResult, eventsResult, lastScoreResult] = await Promise.all([
    db.query(
      `SELECT created_at, country_code, status FROM identities WHERE zid = $1`,
      [zid]
    ),
    db.query(
      `SELECT event_type, server_timestamp
       FROM ledger_events WHERE zid = $1
       ORDER BY sequence_num DESC`,
      [zid]
    ),
    db.query(
      `SELECT score FROM reputation_scores
       WHERE zid = $1 AND is_current = TRUE LIMIT 1`,
      [zid]
    ),
  ]);

  if (identityResult.rowCount === 0) {
    throw Object.assign(new Error(`Identidad "${zid}" no encontrada`), { status: 404 });
  }

  const identity = identityResult.rows[0];
  const events = eventsResult.rows;
  const now = new Date();

  // ─── CALCULAR FACTOR: account_age ─────────────────────────────────────────
  const accountAgeDays = Math.floor(
    (now - new Date(identity.created_at)) / (1000 * 60 * 60 * 24)
  );
  // Score de antigüedad: escala logarítmica, máximo a los 365 días
  const accountAgeScore = Math.min(100, Math.round(
    (Math.log10(accountAgeDays + 1) / Math.log10(366)) * 100
  ));

  // ─── CALCULAR FACTOR: activity ────────────────────────────────────────────
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const recentEvents = events.filter(
    (e) => new Date(e.server_timestamp) >= thirtyDaysAgo
  );
  // Score de actividad: 30+ eventos en 30 días = 100 puntos
  const activityScore = Math.min(100, Math.round((recentEvents.length / 30) * 100));

  // ─── CALCULAR FACTOR: transaction_history ────────────────────────────────
  const totalEvents = events.length;
  // Variedad de tipos de evento
  const uniqueTypes = new Set(events.map((e) => e.event_type)).size;
  // Score: combinación de volumen y diversidad
  const volumeScore = Math.min(100, Math.round((totalEvents / 100) * 100));
  const diversityScore = Math.min(100, Math.round((uniqueTypes / 10) * 100));
  const transactionScore = Math.round((volumeScore * 0.6) + (diversityScore * 0.4));

  // ─── CALCULAR FACTOR: consistency ────────────────────────────────────────
  const consistencyScore = _calculateConsistencyScore(events, now);

  // ─── CALCULAR FACTOR: trust_signals ──────────────────────────────────────
  let trustScore = 50; // Base
  if (identity.country_code) trustScore += 20;       // País verificado
  if (identity.status === 'active') trustScore += 15; // Cuenta activa
  if (accountAgeDays > 30) trustScore += 15;          // Cuenta establecida
  trustScore = Math.min(100, trustScore);

  // ─── SCORE FINAL PONDERADO ────────────────────────────────────────────────
  const rawScore =
    (activityScore             * FACTOR_WEIGHTS.activity / 100) +
    (transactionScore          * FACTOR_WEIGHTS.transaction_history / 100) +
    (consistencyScore          * FACTOR_WEIGHTS.consistency / 100) +
    (trustScore                * FACTOR_WEIGHTS.trust_signals / 100) +
    (accountAgeScore           * FACTOR_WEIGHTS.account_age / 100);

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));

  const factors = {
    activity:             activityScore,
    transaction_history:  transactionScore,
    consistency:          consistencyScore,
    trust_signals:        trustScore,
    account_age:          accountAgeScore,
    // Metadatos del cálculo
    _meta: {
      total_events:       totalEvents,
      recent_events_30d:  recentEvents.length,
      unique_event_types: uniqueTypes,
      account_age_days:   accountAgeDays,
      has_country_code:   !!identity.country_code,
    },
  };

  // Guardar nuevo score marcando el anterior como no-current
  await _saveScore(zid, finalScore, factors);

  logger.info('Score de reputación recalculado', { zid, score: finalScore });

  return { score: finalScore, factors };
}

/**
 * Calcula el score de consistencia basado en la regularidad de eventos.
 * @param {Array} events
 * @param {Date} now
 * @returns {number} 0-100
 */
function _calculateConsistencyScore(events, now) {
  if (events.length < 2) return 0;

  // Calcular intervalos entre eventos consecutivos
  const sorted = [...events].sort(
    (a, b) => new Date(a.server_timestamp) - new Date(b.server_timestamp)
  );

  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = new Date(sorted[i].server_timestamp) - new Date(sorted[i - 1].server_timestamp);
    intervals.push(diff / (1000 * 60 * 60)); // En horas
  }

  if (intervals.length === 0) return 0;

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  // Coeficiente de variación: menor variación = más consistente
  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;
  // Convertir CV a score (CV=0 → 100, CV>=1 → 0)
  return Math.max(0, Math.min(100, Math.round((1 - Math.min(cv, 1)) * 100)));
}

/**
 * Persiste el nuevo score y actualiza la bandera is_current.
 */
async function _saveScore(zid, score, factors) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Desactivar score actual
    await client.query(
      `UPDATE reputation_scores SET is_current = FALSE WHERE zid = $1 AND is_current = TRUE`,
      [zid]
    );
    // Insertar nuevo score
    await client.query(
      `INSERT INTO reputation_scores (zid, score, factors, version, is_current)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [zid, score, JSON.stringify(factors), SCORING_VERSION]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtiene el score actual de reputación de un ZID.
 * @param {string} zid
 */
async function getCurrentScore(zid) {
  const result = await db.query(
    `SELECT score, factors, version, calculated_at
     FROM reputation_scores
     WHERE zid = $1 AND is_current = TRUE
     ORDER BY calculated_at DESC LIMIT 1`,
    [zid]
  );

  if (result.rowCount === 0) {
    throw Object.assign(new Error(`No se encontró score para "${zid}".`), { status: 404 });
  }

  return result.rows[0];
}

/**
 * Obtiene el historial de scores de un ZID.
 * @param {string} zid
 * @param {number} [limit=10]
 */
async function getScoreHistory(zid, limit = 10) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const result = await db.query(
    `SELECT score, factors, version, calculated_at
     FROM reputation_scores
     WHERE zid = $1
     ORDER BY calculated_at DESC
     LIMIT $2`,
    [zid, safeLimit]
  );

  return result.rows;
}

module.exports = { recalculateScore, getCurrentScore, getScoreHistory };
