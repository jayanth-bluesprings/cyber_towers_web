const { query } = require('../db');
const { enrichRecord } = require('../websocket');

// Same card scanned within this many seconds = duplicate, keep only the latest scan.
const DEDUP_SECONDS = 30;

function authorizedSql(fieldName) {
  return `
    ${fieldName} IS NOT NULL
    AND LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255)))) NOT IN ('', '-', '0')
    AND LOWER(LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255))))) NOT IN ('null', 'undefined')
  `;
}

// CTE: partitions by CardData + 30-second time bucket, keeps only the highest
// CardRecordID per bucket (rn = 1). Eliminates repeated scans from the same
// card reader firing multiple times on a single vehicle pass-through.
function dedupCTE() {
  return `
    WITH RankedScans AS (
      SELECT
        c.CardRecordID,
        c.CardData,
        c.PName,
        c.PCode,
        c.DeptName,
        c.EquptName,
        p.Addr,
        pe2.CarNumber,
        p.PDesc AS Remark,
        DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
        ROW_NUMBER() OVER (
          PARTITION BY
            c.CardData,
            CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
          ORDER BY c.CardRecordID DESC
        ) AS rn
      FROM CardRecord c
      LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
      LEFT JOIN PersonnelExtend2 pe2 ON pe2.PersonnelID = c.PersonnelID
    )
  `;
}

async function getLive(req, res) {
  try {
    const result = await query(`
      ${dedupCTE()}
      SELECT TOP 100
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, Addr, CarNumber, Remark, ScanTime
      FROM RankedScans
      WHERE rn = 1
        AND ${authorizedSql('PCode')}
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
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, Addr, CarNumber, Remark, ScanTime
      FROM RankedScans
      WHERE rn = 1
        AND CardRecordID > @lastId
        AND ${authorizedSql('PCode')}
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
        CardRecordID, CardData, PName, PCode, DeptName, EquptName, Addr, CarNumber, Remark, ScanTime
      FROM RankedScans
      WHERE rn = 1
        AND ${authorizedSql('PCode')}
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

async function getAuthorizedVehicles(req, res) {
  try {
    const result = await query(`
      WITH LatestAuthorized AS (
        SELECT
          c.CardData,
          c.PName,
          c.PCode,
          p.Addr,
          pe2.CarNumber,
          p.PDesc AS Remark,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY c.CardData
            ORDER BY c.CardRecordID DESC
          ) AS rn
        FROM CardRecord c
        LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
        LEFT JOIN PersonnelExtend2 pe2 ON pe2.PersonnelID = c.PersonnelID
        WHERE ${authorizedSql('c.PCode')}
      )
      SELECT
        CardData,
        PName,
        PCode,
        Addr,
        CarNumber,
        Remark,
        ScanTime
      FROM LatestAuthorized
      WHERE rn = 1
      ORDER BY PName ASC, CardData ASC
    `);

    const records = result.recordset.map(enrichRecord);
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getAuthorizedVehicles error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getLive, getNew, search, getAuthorizedVehicles };
