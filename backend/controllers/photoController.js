const { query } = require('../db');

let _colCache = undefined;
let _colCacheAt = 0;
const COL_TTL = 5 * 60 * 1000;

async function discoverPhotoColumn() {
  const now = Date.now();
  if (_colCache !== undefined && now - _colCacheAt < COL_TTL) return _colCache;

  try {
    const result = await query(`
      SELECT TOP 1 TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS WITH (NOLOCK)
      WHERE COLUMN_NAME IN ('Photo','photo','UserPhoto','FacePhoto','Picture','Image','Avatar','Pic')
        AND TABLE_NAME IN ('Personnel','PersonnelPhoto','PersonnelFace','PersonnelExtend','PersonnelExtend2')
      ORDER BY
        CASE TABLE_NAME  WHEN 'Personnel'      THEN 1
                         WHEN 'PersonnelPhoto' THEN 2
                         WHEN 'PersonnelFace'  THEN 3
                         ELSE 4 END,
        CASE COLUMN_NAME WHEN 'Photo' THEN 1
                         WHEN 'photo' THEN 2
                         ELSE 3 END
    `);
    _colCache = result.recordset[0] || null;
  } catch (err) {
    console.error('[photo] Column discovery error:', err.message);
    _colCache = null;
  }
  _colCacheAt = Date.now();
  console.log('[photo] Discovered photo column:', _colCache);
  return _colCache;
}

async function getPersonPhoto(req, res) {
  const { cardId } = req.params;
  if (!cardId) return res.status(400).send('cardId required');

  try {
    const col = await discoverPhotoColumn();
    if (!col) return res.status(404).send('no-photo-column');

    let photoResult;
    if (col.TABLE_NAME === 'Personnel') {
      photoResult = await query(
        `SELECT ${col.COLUMN_NAME} AS Photo
         FROM Personnel WITH (NOLOCK)
         WHERE CardData = @cardId
           AND ${col.COLUMN_NAME} IS NOT NULL`,
        { cardId }
      );
    } else {
      photoResult = await query(
        `SELECT t.${col.COLUMN_NAME} AS Photo
         FROM ${col.TABLE_NAME} t WITH (NOLOCK)
         INNER JOIN Personnel p WITH (NOLOCK) ON p.PersonnelID = t.PersonnelID
         WHERE p.CardData = @cardId
           AND t.${col.COLUMN_NAME} IS NOT NULL`,
        { cardId }
      );
    }

    const photoData = photoResult.recordset[0]?.Photo;
    if (!photoData) return res.status(404).send('no-photo');

    let buf;
    if (Buffer.isBuffer(photoData)) {
      buf = photoData;
    } else if (typeof photoData === 'string') {
      buf = Buffer.from(photoData, 'base64');
    } else {
      return res.status(404).send('invalid-photo-data');
    }

    if (buf.length < 4) return res.status(404).send('empty-photo');

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.error('[photo] getPersonPhoto error:', err.message);
    res.status(500).send('error');
  }
}

async function getPhotoSchema(req, res) {
  const col = await discoverPhotoColumn();
  res.json({ found: !!col, column: col || null });
}

module.exports = { getPersonPhoto, getPhotoSchema };
