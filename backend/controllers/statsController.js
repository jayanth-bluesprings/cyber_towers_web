const { query } = require('../db');

// Same dedup window as liveController — same card within 30s = one scan
const DEDUP_SECONDS = 30;

// Deduped base CTE: one row per card per 30-second bucket, within a date range.
// Pass the GETDATE() offset as a literal string (e.g. "DATEADD(DAY,-1,GETDATE())")
function dedupCTE(since) {
  return `
    WITH Deduped AS (
      SELECT
        CardRecordID,
        CardData,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
        ROW_NUMBER() OVER (
          PARTITION BY
            CardData,
            CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
          ORDER BY CardRecordID DESC
        ) AS rn
      FROM CardRecord
      WHERE DATEADD(SECOND, DataTime * 86400, '1899-12-30') >= ${since}
    )
  `;
}

async function getVehicleStats(req, res) {
  try {
    const daily = await query(`
      ${dedupCTE('DATEADD(DAY, -30, GETDATE())')}
      SELECT
        CAST(ScanTime AS DATE) AS Day,
        COUNT(*) AS Total,
        SUM(CASE WHEN CardData LIKE '2W%' THEN 1 ELSE 0 END) AS TwoWheeler,
        SUM(CASE WHEN CardData LIKE '4W%' THEN 1 ELSE 0 END) AS FourWheeler
      FROM Deduped
      WHERE rn = 1
      GROUP BY CAST(ScanTime AS DATE)
      ORDER BY Day ASC
    `);
    res.json({ success: true, data: daily.recordset });
  } catch (err) {
    console.error('getVehicleStats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleTypeCount(req, res) {
  try {
    const result = await query(`
      ${dedupCTE('DATEADD(DAY, -30, GETDATE())')}
      SELECT
        SUM(CASE WHEN CardData LIKE '2W%' THEN 1 ELSE 0 END) AS TwoWheeler,
        SUM(CASE WHEN CardData LIKE '4W%' THEN 1 ELSE 0 END) AS FourWheeler,
        SUM(CASE WHEN CardData NOT LIKE '2W%' AND CardData NOT LIKE '4W%' THEN 1 ELSE 0 END) AS Other
      FROM Deduped
      WHERE rn = 1
    `);
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('getVehicleTypeCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleCount(req, res) {
  try {
    const result = await query(`
      -- Single pass: count deduped rows across all three windows at once
      WITH Deduped AS (
        SELECT
          CardRecordID,
          CardData,
          DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY
              CardData,
              CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY CardRecordID DESC
          ) AS rn
        FROM CardRecord
        WHERE DATEADD(SECOND, DataTime * 86400, '1899-12-30') >= DATEADD(DAY, -30, GETDATE())
      )
      SELECT
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1,  GETDATE()) THEN 1 ELSE 0 END) AS DayTotal,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7,  GETDATE()) THEN 1 ELSE 0 END) AS WeekTotal,
        COUNT(*) AS MonthTotal,
        SUM(CASE WHEN CardData LIKE '2W%' THEN 1 ELSE 0 END) AS TwoWheeler,
        SUM(CASE WHEN CardData LIKE '4W%' THEN 1 ELSE 0 END) AS FourWheeler
      FROM Deduped
      WHERE rn = 1
    `);

    const row = result.recordset[0];
    res.json({
      success: true,
      data: {
        day: row.DayTotal,
        week: row.WeekTotal,
        month: row.MonthTotal,
        twoWheeler: row.TwoWheeler,
        fourWheeler: row.FourWheeler,
      },
    });
  } catch (err) {
    console.error('getVehicleCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getVehicleStats, getVehicleTypeCount, getVehicleCount };