const { query } = require('../db');

const DEDUP_SECONDS = 30;

async function getVehicleStats(req, res) {
  try {
    const daily = await query(`
      WITH Deduped AS (
        SELECT
          cr.CardData,
          DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY cr.CardData, CAST(cr.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY cr.CardRecordID DESC
          ) AS rn
        FROM CardRecord cr
        WHERE DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') >= DATEADD(DAY, -30, GETDATE())
      )
      SELECT
        CAST(ScanTime AS DATE) AS Day,
        COUNT(*) AS Total,
        SUM(CASE WHEN LEFT(CardData, 1) = '2' THEN 1 ELSE 0 END) AS TwoWheeler,
        SUM(CASE WHEN LEFT(CardData, 1) = '4' THEN 1 ELSE 0 END) AS FourWheeler
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
      WITH Deduped AS (
        SELECT
          cr.CardData,
          DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY cr.CardData, CAST(cr.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY cr.CardRecordID DESC
          ) AS rn
        FROM CardRecord cr
        WHERE DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') >= DATEADD(DAY, -30, GETDATE())
      )
      SELECT
        SUM(CASE WHEN LEFT(CardData, 1) = '2' THEN 1 ELSE 0 END) AS TwoWheeler,
        SUM(CASE WHEN LEFT(CardData, 1) = '4' THEN 1 ELSE 0 END) AS FourWheeler,
        SUM(CASE WHEN LEFT(CardData, 1) NOT IN ('2', '4') THEN 1 ELSE 0 END) AS Other
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
      WITH Deduped AS (
        SELECT
          cr.CardData,
          e.EquptName,
          DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY cr.CardData, CAST(cr.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY cr.CardRecordID DESC
          ) AS rn
        FROM CardRecord cr
        LEFT JOIN Equipment e ON cr.EquptID = e.EquptID
        WHERE DATEADD(SECOND, cr.DataTime * 86400, '1899-12-30') >= DATEADD(DAY, -30, GETDATE())
      )
      SELECT
        -- Totals
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1, GETDATE()) THEN 1 ELSE 0 END) AS DayTotal,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) AS WeekTotal,
        COUNT(*) AS MonthTotal,

        -- 2W / 4W per period
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1, GETDATE()) AND LEFT(CardData,1)='2' THEN 1 ELSE 0 END) AS DayTwoWheeler,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1, GETDATE()) AND LEFT(CardData,1)='4' THEN 1 ELSE 0 END) AS DayFourWheeler,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7, GETDATE()) AND LEFT(CardData,1)='2' THEN 1 ELSE 0 END) AS WeekTwoWheeler,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7, GETDATE()) AND LEFT(CardData,1)='4' THEN 1 ELSE 0 END) AS WeekFourWheeler,
        SUM(CASE WHEN LEFT(CardData,1)='2' THEN 1 ELSE 0 END) AS MonthTwoWheeler,
        SUM(CASE WHEN LEFT(CardData,1)='4' THEN 1 ELSE 0 END) AS MonthFourWheeler,

        -- Entry / Exit per period
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1, GETDATE()) AND LOWER(EquptName) LIKE '%entry%' THEN 1 ELSE 0 END) AS DayEntry,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -1, GETDATE()) AND LOWER(EquptName) LIKE '%exit%'  THEN 1 ELSE 0 END) AS DayExit,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7, GETDATE()) AND LOWER(EquptName) LIKE '%entry%' THEN 1 ELSE 0 END) AS WeekEntry,
        SUM(CASE WHEN ScanTime >= DATEADD(DAY, -7, GETDATE()) AND LOWER(EquptName) LIKE '%exit%'  THEN 1 ELSE 0 END) AS WeekExit,
        SUM(CASE WHEN LOWER(EquptName) LIKE '%entry%' THEN 1 ELSE 0 END) AS MonthEntry,
        SUM(CASE WHEN LOWER(EquptName) LIKE '%exit%'  THEN 1 ELSE 0 END) AS MonthExit
      FROM Deduped
      WHERE rn = 1
    `);

    const r = result.recordset[0];
    res.json({
      success: true,
      data: {
        day: {
          total: r.DayTotal,
          twoWheeler: r.DayTwoWheeler,
          fourWheeler: r.DayFourWheeler,
          entry: r.DayEntry,
          exit: r.DayExit,
        },
        week: {
          total: r.WeekTotal,
          twoWheeler: r.WeekTwoWheeler,
          fourWheeler: r.WeekFourWheeler,
          entry: r.WeekEntry,
          exit: r.WeekExit,
        },
        month: {
          total: r.MonthTotal,
          twoWheeler: r.MonthTwoWheeler,
          fourWheeler: r.MonthFourWheeler,
          entry: r.MonthEntry,
          exit: r.MonthExit,
        },
      },
    });
  } catch (err) {
    console.error('getVehicleCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getVehicleStats, getVehicleTypeCount, getVehicleCount };