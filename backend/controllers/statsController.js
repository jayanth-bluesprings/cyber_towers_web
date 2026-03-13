const { query } = require('../db');
const path = require('path');
const fs = require('fs');

const DEDUP_SECONDS = 30;

// Edit vehicleTypeMap.json (same folder as this file) to classify cards:
// { "11528938": "2W", "11528937": "4W" }
function getTypeMap() {
  try {
    const filePath = path.join(__dirname, 'vehicleTypeMap.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('vehicleTypeMap.json not found or invalid, defaulting to empty map');
    return {};
  }
}

function dedupCTE(since) {
  return `
    WITH Deduped AS (
      SELECT
        c.CardData,
        c.PCode,
        p.PDesc AS Remark,
        c.PortNum,
        DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
        ROW_NUMBER() OVER (
          PARTITION BY
            c.CardData,
            CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
          ORDER BY c.CardRecordID DESC
        ) AS rn
      FROM CardRecord c
      LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
      WHERE DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') >= ${since}
    )
  `;
}

function isAuthorizedPCode(value) {
  const pcode = value == null ? '' : String(value).trim().toLowerCase();
  return !['', '-', '0', 'null', 'undefined'].includes(pcode);
}

function getVehicleType(record, typeMap) {
  const remarkType = record.Remark == null ? '' : String(record.Remark).trim().toUpperCase();
  if (remarkType === '2W' || remarkType === '4W') return remarkType;
  return null;
}

function formatSqlDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getLocalTimeWindows() {
  const IST_OFFSET_MINUTES = 330;
  const nowUtc = new Date();
  const nowIstMs = nowUtc.getTime() + (IST_OFFSET_MINUTES * 60 * 1000);
  const nowIst = new Date(nowIstMs);

  const dayStart = new Date(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate(),
    0, 0, 0
  );
  const nextDayStart = new Date(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() + 1,
    0, 0, 0
  );
  const weekStart = new Date(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() - 6,
    0, 0, 0
  );
  const monthStart = new Date(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() - 29,
    0, 0, 0
  );

  return {
    dayStartSql: formatSqlDateTime(dayStart),
    nextDayStartSql: formatSqlDateTime(nextDayStart),
    weekStartSql: formatSqlDateTime(weekStart),
    monthStartSql: formatSqlDateTime(monthStart),
  };
}

async function getVehicleStats(req, res) {
  try {
    const period = String(req.query.period || 'day').toLowerCase();
    const { dayStartSql, nextDayStartSql, weekStartSql, monthStartSql } = getLocalTimeWindows();

    const rangeStartSql = period === 'week' ? weekStartSql : period === 'month' ? monthStartSql : dayStartSql;
    const rangeEndSql = period === 'day' ? nextDayStartSql : null;

    const result = await query(`
      WITH Deduped AS (
        SELECT
          c.CardData,
          c.PCode,
          p.PDesc AS Remark,
          c.EquptName,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY
              c.CardData,
              CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY c.CardRecordID DESC
          ) AS rn
        FROM CardRecord c
        LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
        WHERE DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') >= '${rangeStartSql}'
        ${rangeEndSql ? `AND DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') < '${rangeEndSql}'` : ''}
      )
      SELECT
        ScanTime,
        DATEPART(HOUR, ScanTime) AS ScanHour,
        CONVERT(VARCHAR(10), ScanTime, 23) AS ScanDay,
        PCode,
        Remark,
        CASE
          WHEN LTRIM(RTRIM(EquptName)) = '24074151 - 1' THEN 'Entry'
          WHEN LTRIM(RTRIM(EquptName)) = '24074151 - 2' THEN 'Exit'
          WHEN LOWER(EquptName) LIKE '%entry%' OR LOWER(EquptName) = 'in' THEN 'Entry'
          WHEN LOWER(EquptName) LIKE '%exit%' OR LOWER(EquptName) = 'out' THEN 'Exit'
          ELSE 'Unknown'
        END AS GateDirection
      FROM Deduped
      WHERE rn = 1
    `);

    if (period === 'day') {
      const byHour = new Map();
      for (let hour = 0; hour < 24; hour += 1) {
        byHour.set(hour, {
          Hour: hour,
          Entry: 0,
          Exit: 0,
          Total: 0,
          TwoWheelerEntry: 0,
          TwoWheelerExit: 0,
          FourWheelerEntry: 0,
          FourWheelerExit: 0,
        });
      }

      for (const row of result.recordset) {
        if (!isAuthorizedPCode(row.PCode)) continue;
        const bucket = byHour.get(Number(row.ScanHour));
        if (!bucket) continue;
        const remark = row.Remark == null ? '' : String(row.Remark).trim().toUpperCase();
        if (row.GateDirection === 'Entry') bucket.Entry += 1;
        if (row.GateDirection === 'Exit') bucket.Exit += 1;
        if (row.GateDirection === 'Entry' || row.GateDirection === 'Exit') bucket.Total += 1;
        if (remark === '2W' && row.GateDirection === 'Entry') bucket.TwoWheelerEntry += 1;
        if (remark === '2W' && row.GateDirection === 'Exit') bucket.TwoWheelerExit += 1;
        if (remark === '4W' && row.GateDirection === 'Entry') bucket.FourWheelerEntry += 1;
        if (remark === '4W' && row.GateDirection === 'Exit') bucket.FourWheelerExit += 1;
      }

      res.json({ success: true, data: Array.from(byHour.values()) });
      return;
    }

    const daysToShow = period === 'week' ? 7 : 30;
    const byDay = new Map();
    const startDate = new Date(period === 'week' ? weekStartSql.replace(' ', 'T') : monthStartSql.replace(' ', 'T'));
    for (let i = 0; i < daysToShow; i += 1) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const key = formatSqlDateTime(d).slice(0, 10);
      byDay.set(key, {
        Day: key,
        Entry: 0,
        Exit: 0,
        Total: 0,
        TwoWheelerEntry: 0,
        TwoWheelerExit: 0,
        FourWheelerEntry: 0,
        FourWheelerExit: 0,
      });
    }

    for (const row of result.recordset) {
      if (!isAuthorizedPCode(row.PCode)) continue;
      const key = String(row.ScanDay || '');
      const bucket = byDay.get(key);
      if (!bucket) continue;
      const remark = row.Remark == null ? '' : String(row.Remark).trim().toUpperCase();
      if (row.GateDirection === 'Entry') bucket.Entry += 1;
      if (row.GateDirection === 'Exit') bucket.Exit += 1;
      if (row.GateDirection === 'Entry' || row.GateDirection === 'Exit') bucket.Total += 1;
      if (remark === '2W' && row.GateDirection === 'Entry') bucket.TwoWheelerEntry += 1;
      if (remark === '2W' && row.GateDirection === 'Exit') bucket.TwoWheelerExit += 1;
      if (remark === '4W' && row.GateDirection === 'Entry') bucket.FourWheelerEntry += 1;
      if (remark === '4W' && row.GateDirection === 'Exit') bucket.FourWheelerExit += 1;
    }

    res.json({ success: true, data: Array.from(byDay.values()) });
  } catch (err) {
    console.error('getVehicleStats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleTypeCount(req, res) {
  try {
    const typeMap = getTypeMap();
    const { monthStartSql } = getLocalTimeWindows();

    const result = await query(`
      ${dedupCTE(`'${monthStartSql}'`)}
      , LatestPerCard AS (
        SELECT
          CardData,
          PCode,
          Remark,
          ROW_NUMBER() OVER (
            PARTITION BY CardData
            ORDER BY ScanTime DESC
          ) AS card_rn
        FROM Deduped
        WHERE rn = 1
      )
      SELECT CardData, PCode, Remark
      FROM LatestPerCard
      WHERE card_rn = 1
    `);

    let twoWheeler = 0, fourWheeler = 0, total = 0;
    for (const r of result.recordset) {
      if (!isAuthorizedPCode(r.PCode)) continue;
      total++;
      const t = getVehicleType(r, typeMap);
      if (t === '2W') twoWheeler++;
      else if (t === '4W') fourWheeler++;
    }

    res.json({ success: true, data: { twoWheeler, fourWheeler, total } });
  } catch (err) {
    console.error('getVehicleTypeCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleCount(req, res) {
  try {
    const typeMap = getTypeMap();
    const { dayStartSql, weekStartSql, monthStartSql } = getLocalTimeWindows();

    const result = await query(`
      WITH Deduped AS (
        SELECT
          c.CardData,
          c.PCode,
          p.PDesc AS Remark,
          c.EquptName,
          c.PortNum,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY
              c.CardData,
              CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY c.CardRecordID DESC
          ) AS rn
        FROM CardRecord c
        LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
        WHERE DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') >= '${monthStartSql}'
      )
      SELECT
        CardData,
        PCode,
        Remark,
        EquptName,
        PortNum,
        CASE
          WHEN LTRIM(RTRIM(EquptName)) = '24074151 - 1' THEN 'Entry'
          WHEN LTRIM(RTRIM(EquptName)) = '24074151 - 2' THEN 'Exit'
          WHEN LOWER(EquptName) LIKE '%entry%' OR LOWER(EquptName) = 'in' THEN 'Entry'
          WHEN LOWER(EquptName) LIKE '%exit%' OR LOWER(EquptName) = 'out' THEN 'Exit'
          WHEN PortNum = 1 THEN 'Entry'
          WHEN PortNum = 2 THEN 'Exit'
          ELSE 'Unknown'
        END AS GateDirection,
        CASE WHEN ScanTime >= '${dayStartSql}' THEN 1 ELSE 0 END AS InDay,
        CASE WHEN ScanTime >= '${weekStartSql}' THEN 1 ELSE 0 END AS InWeek
      FROM Deduped
      WHERE rn = 1
    `);

    const all = result.recordset;

    function stats(rows) {
      let total = rows.length, twoWheeler = 0, fourWheeler = 0;
      let entry = 0, exit = 0;
      let twoWheelerEntry = 0, twoWheelerExit = 0;
      let fourWheelerEntry = 0, fourWheelerExit = 0;
      for (const r of rows) {
        if (!isAuthorizedPCode(r.PCode)) continue;
        const t = getVehicleType(r, typeMap);
        if (t === '2W') {
          twoWheeler++;
          if (r.GateDirection === 'Entry') twoWheelerEntry++;
          if (r.GateDirection === 'Exit') twoWheelerExit++;
        } else if (t === '4W') {
          fourWheeler++;
          if (r.GateDirection === 'Entry') fourWheelerEntry++;
          if (r.GateDirection === 'Exit') fourWheelerExit++;
        }
        if (r.GateDirection === 'Entry') entry++;
        if (r.GateDirection === 'Exit') exit++;
      }
      total = entry + exit;
      return {
        total,
        twoWheeler,
        fourWheeler,
        entry,
        exit,
        twoWheelerEntry,
        twoWheelerExit,
        fourWheelerEntry,
        fourWheelerExit,
      };
    }

    res.json({
      success: true,
      data: {
        day:   stats(all.filter(r => r.InDay  === 1)),
        week:  stats(all.filter(r => r.InWeek === 1)),
        month: stats(all),
      },
    });
  } catch (err) {
    console.error('getVehicleCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getVehicleStats, getVehicleTypeCount, getVehicleCount };
