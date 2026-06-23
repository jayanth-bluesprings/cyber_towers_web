-- Migration 007: cardholder photograph.
--   photo_url  — an external link to the image (fetched/displayed as-is).
--   photo_data — a locally uploaded image stored as a base64 string.
-- The photo API (/api/person-photo/:cardId) serves photo_data bytes when present,
-- otherwise redirects to photo_url.
ALTER TABLE cybertowers.cards
  ADD COLUMN IF NOT EXISTS photo_url  VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS photo_data TEXT;
