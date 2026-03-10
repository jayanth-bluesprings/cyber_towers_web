const { query } = require('../db');
const { enrichRecord } = require('../websocket');

// Same card scanned within this many seconds = duplicate, keep only the latest scan.
const DEDUP_SECONDS = 30;

// CTE: partitions by CardData + 30-second time bucket, keeps only the highest
// CardRecordID per bucket (rn = 1). Eliminates repeated scans from the same
// card reader firing multiple times on a single vehicle pass-through.
function dedupCTE() {
  return `
    WITH RankedScans AS (
      SELECT
        CardRecordID,
        CardData,
        PName,
        PCode,
        DeptName,
        EquptName,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
        ROW_NUMBER() OVER (
          PARTITION BY
            CardData,
            CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
          ORDER BY CardRecordID DESC
        ) AS rn
      FROM CardRecord
    )
  `;
}

async function getLive(req, res) {
  try {
    const result = await query(`
      ${dedupCTE()}
      SELECT TOP 100
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, ScanTime
      FROM RankedScans
      WHERE rn = 1
      ORDER BY CardRecordID DESC
    `);
    const records = result.recordset.map(enrichRecord);
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getLive error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getNew(req, res) {
  const lastId = parseInt(req.query.lastId || '0');
  try {
    const result = await query(
      `${dedupCTE()}
      SELECT TOP 100
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, ScanTime
      FROM RankedScans
      WHERE rn = 1 AND CardRecordID > @lastId
      ORDER BY CardRecordID ASC`,
      { lastId }
    );
    const records = result.recordset.map(enrichRecord);
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getNew error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function search(req, res) {
  const { q } = req.query;
  if (!q) return res.json({ success: true, data: [] });
  const like = `%${q}%`;
  try {
    const result = await query(
      `${dedupCTE()}
      SELECT TOP 100
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, ScanTime
      FROM RankedScans
      WHERE rn = 1
        AND (CardData LIKE @like OR PName LIKE @like OR PCode LIKE @like)
      ORDER BY CardRecordID DESC`,
      { like }
    );
    const records = result.recordset.map(enrichRecord);
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getLive, getNew, search };