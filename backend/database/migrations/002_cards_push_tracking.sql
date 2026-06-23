-- Migration 002: add push-to-controller tracking columns to cards
-- Run once against cybertowers_access database.

ALTER TABLE cybertowers.cards
  ADD COLUMN IF NOT EXISTS push_status    VARCHAR(20)  DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS last_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_error     TEXT;

-- Index for querying cards that need a push
CREATE INDEX IF NOT EXISTS cards_push_status_idx
  ON cybertowers.cards(push_status)
  WHERE deleted_at IS NULL;

-- card_push_log: one row per (card × controller) push attempt
CREATE TABLE IF NOT EXISTS cybertowers.card_push_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID        NOT NULL REFERENCES cybertowers.cards(id) ON DELETE CASCADE,
    controller_id   UUID        NOT NULL REFERENCES cybertowers.controllers(id) ON DELETE CASCADE,
    card_no         VARCHAR(30) NOT NULL,
    controller_sn   VARCHAR(30) NOT NULL,
    operation       VARCHAR(20) NOT NULL DEFAULT 'push',   -- 'push' | 'remove'
    status          VARCHAR(20) NOT NULL DEFAULT 'Pending', -- 'Pending' | 'Success' | 'Failed'
    attempts        SMALLINT    NOT NULL DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_push_log_card_idx
  ON cybertowers.card_push_log(card_id, started_at DESC);
CREATE INDEX IF NOT EXISTS card_push_log_controller_idx
  ON cybertowers.card_push_log(controller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS card_push_log_status_idx
  ON cybertowers.card_push_log(status) WHERE status IN ('Pending','Failed');
