-- Migration 001: add assigned_user_id FK to cards
-- Run once against cybertowers_access database.

ALTER TABLE cybertowers.cards
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID
    REFERENCES cybertowers.users(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cards_assigned_user_idx
  ON cybertowers.cards(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;
