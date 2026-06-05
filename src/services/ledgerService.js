'use strict';

const db = require('../db/pool');
const { verifySignature, canonicalJSON, hashEventPayload, sha256 } = require('../utils/crypto');
const { getPublicKeyByZid } = require('./identityService');
const logger = require('../utils/logger');

/**
 * Registra un evento firmado en el ledger inmutable.
 * @param {object} params
 * @param {string} params.zid
 * @param {object} params.event
 * @param {string} params.signature - base64
 * @param {string} [params.ip_address]
 */
async function submitEvent({ zid, event, signature, ip_address }) {
  // 1. Obtener la clave pública del ZID
  const publicKey = await getPublicKeyByZid(zid);

  // 2. Calcular el hash del payload canónico
  const payloadHash = hashEventPayload(event);

  // 3. Construir el canonical JSON que el cliente debió firmar
  //    El cliente firma: canonicalJSON({ event, zid })
  const signedPayload = canonicalJSON({ event, zid });

  // 4. Verificar la firma
  const isValid = verifySignature(publicKey, signedPayload, signature);
  if (!isValid) {
    logger.warn('Firma de evento ledger inválida', { zid, event_type: event.type });
    throw Object.assign(
      new Error('Firma del evento inválida. El evento no fue firmado correctamente.'),
      { status: 401 }
    );
  }

  // 5. Obtener el hash del último evento para encadenamiento
  const lastEventResult = await db.query(
    `SELECT payload_hash, sequence_num FROM ledger_events
     WHERE zid = $1 ORDER BY sequence_num DESC LIMIT 1`,
    [zid]
  );

  let prevEventHash = null;
  if (lastEventResult.rowCount > 0) {
    // Hash del evento anterior = sha256(payload_hash + sequence_num)
    const prev = lastEventResult.rows[0];
    prevEventHash = sha256(`${prev.payload_hash}:${prev.sequence_num}`);
  }

  // 6. Insertar el evento (APPEND-ONLY)
  const result = await db.query(
    `INSERT INTO ledger_events
       (zid, event_type, event_payload, payload_hash, signature, ip_address, prev_event_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, sequence_num, zid, event_type, server_timestamp, payload_hash, prev_event_hash`,
    [
      zid,
      event.type,
      JSON.stringify(event),
      payloadHash,
      signature,
      ip_address || null,
      prevEventHash,
    ]
  );

  const ledgerEntry = result.rows[0];
  logger.info('Evento registrado en ledger', {
    zid,
    event_type: event.type,
    sequence_num: ledgerEntry.sequence_num,
  });

  // 7. Recalcular reputación de forma asíncrona (sin bloquear la respuesta)
  setImmediate(() => {
    recalculateReputationAsync(zid).catch((err) =>
      logger.error('Error recalculando reputación post-evento', { zid, error: err.message })
    );
  });

  return {
    id: ledgerEntry.id,
    sequence_num: Number(ledgerEntry.sequence_num),
    zid: ledgerEntry.zid,
    event_type: ledgerEntry.event_type,
    payload_hash: ledgerEntry.payload_hash,
    prev_event_hash: ledgerEntry.prev_event_hash,
    server_timestamp: ledgerEntry.server_timestamp,
  };
}

/**
 * Obtiene los eventos del ledger de un ZID.
 * @param {string} zid
 * @param {object} options
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {string} [options.event_type]
 */
async function getEvents(zid, { limit = 50, offset = 0, event_type } = {}) {
  // Validar límites de paginación
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  let queryText = `
    SELECT id, sequence_num, event_type, event_payload, payload_hash,
           prev_event_hash, server_timestamp
    FROM ledger_events
    WHERE zid = $1
  `;
  const params = [zid];

  if (event_type) {
    params.push(event_type);
    queryText += ` AND event_type = $${params.length}`;
  }

  queryText += ` ORDER BY sequence_num DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(safeLimit, safeOffset);

  const [eventsResult, countResult] = await Promise.all([
    db.query(queryText, params),
    db.query('SELECT COUNT(*) FROM ledger_events WHERE zid = $1', [zid]),
  ]);

  return {
    events: eventsResult.rows.map((row) => ({
      id: row.id,
      sequence_num: Number(row.sequence_num),
      event_type: row.event_type,
      event_payload: row.event_payload,
      payload_hash: row.payload_hash,
      prev_event_hash: row.prev_event_hash,
      server_timestamp: row.server_timestamp,
    })),
    total: parseInt(countResult.rows[0].count, 10),
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Dispara recálculo de reputación de forma asíncrona.
 * Importación dinámica para evitar dependencia circular.
 */
async function recalculateReputationAsync(zid) {
  const { recalculateScore } = require('./reputationService');
  await recalculateScore(zid);
}

module.exports = { submitEvent, getEvents };
