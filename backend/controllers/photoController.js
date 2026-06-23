const { pgQuery } = require('../pgdb');

// Photo resolution order for a card:
//   1. photo_data — a locally uploaded image (base64, optionally a data: URI). Served as bytes.
//   2. photo_url  — an external link. We redirect the browser to it.
async function getPersonPhoto(req, res) {
  const { cardId } = req.params;
  if (!cardId) return res.status(400).send('cardId required');

  try {
    const { rows } = await pgQuery(
      `SELECT photo_data, photo_url FROM cybertowers.cards WHERE card_no = $1 AND deleted_at IS NULL`,
      [cardId]
    );
    const row = rows[0];
    if (!row) return res.status(404).send('no-photo');

    const photoData = row.photo_data;

    if (photoData) {
      let buf;
      let contentType = 'image/jpeg';
      if (Buffer.isBuffer(photoData)) {
        buf = photoData;
      } else if (typeof photoData === 'string') {
        // Accept raw base64 or a full data: URI (data:image/png;base64,....)
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(photoData);
        if (match) {
          contentType = match[1];
          buf = Buffer.from(match[2], 'base64');
        } else {
          buf = Buffer.from(photoData, 'base64');
        }
      }
      if (buf && buf.length >= 4) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(buf);
      }
    }

    // Fall back to the external link
    if (row.photo_url) {
      return res.redirect(302, row.photo_url);
    }

    return res.status(404).send('no-photo');
  } catch (err) {
    console.error('[photo] getPersonPhoto error:', err.message);
    res.status(500).send('error');
  }
}

async function getPhotoSchema(req, res) {
  try {
    // Check if photo_data column exists in cybertowers.cards
    const { rows } = await pgQuery(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'cybertowers' AND table_name = 'cards' AND column_name = 'photo_data'
    `);
    const found = rows.length > 0;
    res.json({ found, column: found ? { TABLE_NAME: 'cards', COLUMN_NAME: 'photo_data' } : null });
  } catch (err) {
    res.json({ found: false, column: null });
  }
}

module.exports = { getPersonPhoto, getPhotoSchema };
