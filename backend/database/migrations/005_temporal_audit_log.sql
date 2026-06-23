-- Migration 005: Temporal workflow audit log in PostgreSQL
-- Replaces SQL Server TemporalAuditLog table used by temporal/db.activities.ts

CREATE TABLE IF NOT EXISTS cybertowers.temporal_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  event_type     VARCHAR(60)  NOT NULL,
  card_id        VARCHAR(50),
  vehicle_number VARCHAR(50),
  gate           VARCHAR(30),
  event_time     VARCHAR(40),
  company_code   VARCHAR(100),
  person_name    VARCHAR(200),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temporal_audit_log_event_type ON cybertowers.temporal_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_temporal_audit_log_card_id    ON cybertowers.temporal_audit_log(card_id);
CREATE INDEX IF NOT EXISTS idx_temporal_audit_log_created_at ON cybertowers.temporal_audit_log(created_at);
