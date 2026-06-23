-- Migration 003: store the cardholder's blood group on the card record.
ALTER TABLE cybertowers.cards
  ADD COLUMN IF NOT EXISTS blood_group VARCHAR(8);
