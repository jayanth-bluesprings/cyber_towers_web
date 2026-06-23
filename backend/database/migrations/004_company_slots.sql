-- Migration 004: Company parking slot tracking for Temporal workflows
-- Replaces SQL Server CompanySlots table used by temporal/db.activities.ts

CREATE TABLE IF NOT EXISTS cybertowers.company_slots (
  company_code   VARCHAR(100) PRIMARY KEY,
  company_name   VARCHAR(200),
  total_slots    INT NOT NULL DEFAULT 10,
  occupied_slots INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure occupied_slots never goes negative
ALTER TABLE cybertowers.company_slots
  ADD CONSTRAINT company_slots_occupied_nonneg CHECK (occupied_slots >= 0);
