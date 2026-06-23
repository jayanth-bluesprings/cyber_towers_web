-- Migration 006: vehicle brand and color on the card record.
ALTER TABLE cybertowers.cards
  ADD COLUMN IF NOT EXISTS vehicle_brand VARCHAR(60),
  ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(40);
