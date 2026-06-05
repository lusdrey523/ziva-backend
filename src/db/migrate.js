'use strict';

require('dotenv').config();
const { pool } = require('./pool');

const MIGRATION_SQL = `
-- ─── EXTENSIONES ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TABLA: identities ────────────────────────────────────────────────────────
-- Almacena identidades criptográficas de usuarios ZIVA.
-- La clave privada NUNCA se almacena aquí ni en ningún lugar del servidor.
CREATE TABLE IF NOT EXISTS identities (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  zid           VARCHAR(64)   NOT NULL UNIQUE,
  zid_hash      CHAR(64)      NOT NULL UNIQUE,   -- SHA-256 del publicKey JWK canónico
  public_key    JSONB         NOT NULL,            -- JWK (solo clave pública P-256)
  country_code  CHAR(2),                           -- ISO 3166-1 alpha-2
  status        VARCHAR(20)   NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identities_zid       ON identities (zid);
CREATE INDEX IF NOT EXISTS idx_identities_zid_hash  ON identities (zid_hash);
CREATE INDEX IF NOT EXISTS idx_identities_status    ON identities (status);

-- ─── TABLA: auth_challenges ───────────────────────────────────────────────────
-- Challenges temporales para autenticación challenge-response.
-- Se eliminan automáticamente al verificarse o expirar.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  zid           VARCHAR(64)   NOT NULL REFERENCES identities(zid) ON DELETE CASCADE,
  challenge     CHAR(64)      NOT NULL UNIQUE,  -- 32 bytes en hex
  expires_at    TIMESTAMPTZ   NOT NULL,
  used          BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_zid        ON auth_challenges (zid);
CREATE INDEX IF NOT EXISTS idx_challenges_expires    ON auth_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_challenge  ON auth_challenges (challenge);

-- ─── TABLA: devices ──────────────────────────────────────────────────────────
-- Dispositivos asociados a una identidad.
CREATE TABLE IF NOT EXISTS devices (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id    UUID         NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  fingerprint    VARCHAR(128) NOT NULL,
  user_agent     TEXT,
  ip_address     INET,
  last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (identity_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_devices_identity_id  ON devices (identity_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint  ON devices (fingerprint);

-- ─── TABLA: ledger_events ────────────────────────────────────────────────────
-- Sistema de ledger inmutable (event sourcing).
-- APPEND-ONLY: nunca se actualizan ni eliminan registros.
CREATE TABLE IF NOT EXISTS ledger_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_num    BIGSERIAL     NOT NULL UNIQUE,  -- Orden global inmutable
  zid             VARCHAR(64)   NOT NULL REFERENCES identities(zid),
  event_type      VARCHAR(64)   NOT NULL,
  event_payload   JSONB         NOT NULL,
  payload_hash    CHAR(64)      NOT NULL,          -- SHA-256 del canonical JSON del payload
  signature       TEXT          NOT NULL,           -- Firma ECDSA P-256 del cliente (base64)
  server_timestamp TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address      INET,
  -- Encadenamiento: hash del evento anterior para detectar manipulaciones
  prev_event_hash CHAR(64)
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_ledger_zid        ON ledger_events (zid);
CREATE INDEX IF NOT EXISTS idx_ledger_type       ON ledger_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ledger_seq        ON ledger_events (sequence_num);
CREATE INDEX IF NOT EXISTS idx_ledger_timestamp  ON ledger_events (server_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_hash       ON ledger_events (payload_hash);

-- Deshabilitar DELETE y UPDATE en ledger (solo a nivel de constraint, la lógica principal está en la app)
-- En producción esto se refuerza con Row-Level Security de PostgreSQL

-- ─── TABLA: reputation_scores ────────────────────────────────────────────────
-- Historial de puntuaciones de reputación calculadas.
CREATE TABLE IF NOT EXISTS reputation_scores (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  zid             VARCHAR(64)   NOT NULL REFERENCES identities(zid) ON DELETE CASCADE,
  score           NUMERIC(5,2)  NOT NULL CHECK (score >= 0 AND score <= 100),
  factors         JSONB         NOT NULL,   -- Factores individuales que componen el score
  version         INTEGER       NOT NULL DEFAULT 1,  -- Versión del algoritmo de scoring
  calculated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_current      BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_reputation_zid      ON reputation_scores (zid);
CREATE INDEX IF NOT EXISTS idx_reputation_current  ON reputation_scores (zid, is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_reputation_calc_at  ON reputation_scores (calculated_at DESC);

-- ─── FUNCIÓN: actualizar updated_at automáticamente ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_identities_updated_at ON identities;
CREATE TRIGGER set_identities_updated_at
  BEFORE UPDATE ON identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── LIMPIEZA AUTOMÁTICA DE CHALLENGES EXPIRADOS ──────────────────────────────
-- En producción usar pg_cron. Aquí se incluye como función manual.
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM auth_challenges WHERE expires_at < NOW() OR used = TRUE;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[ZIVA Migration] Iniciando migración de base de datos...');
    await client.query('BEGIN');
    await client.query(MIGRATION_SQL);
    await client.query('COMMIT');
    console.log('[ZIVA Migration] ✅ Migración completada exitosamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ZIVA Migration] ❌ Error durante la migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
