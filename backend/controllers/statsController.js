const { query } = require('../db');
const path = require('path');
const fs = require('fs');
const { getPersonnelMap, enrichWithCache } = require('../personnelCache');
const temporalEvents = require('../temporalEvents');

// Access serial date epoch → UTC milliseconds
const ACCESS_EPOCH_MS = Date.UTC(1899, 11, 30, 0, 0, 0);
const floatToMs = f => f * 86400000 + ACCESS_EPOCH_MS;
// IST is UTC+5:30
const IST_OFFSET_MS = 330 * 60 * 1000;

const DEDUP_SECONDS = 60; // Must match frontend DEDUP_SECONDS in LiveEntryExitPage.jsx / LiveTable.jsx

function deduplicateRecords(records) {
  const seen = new Map();
  const deduped = [];
  const sorted = [...records].sort((a, b) => b.DataTime - a.DataTime);
  for (const r of sorted) {
    const bucket = Math.floor((r.DataTime * 86400) / DEDUP_SECONDS);
    // Include PortNum so that entry + exit of the same card within 60 s are kept as 2 events
    const key = `${String(r.CardData || '').toUpperCase()}|${bucket}|${r.PortNum ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push(r);
    }
  }
  return deduped.reverse();
}

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

function getVehicleType(record) {
  const raw = record.vehicleType || record.Remark || '';
  const remarkType = String(raw).trim().toUpperCase();
  if (!remarkType) return null;

  // Normalize common remark forms from PDesc / vehicleType cache
  const startsWith2 = remarkType.startsWith('2');
  const startsWith4 = remarkType.startsWith('4');
  if (startsWith2 || remarkType.includes('2W') || remarkType.includes('TWO')) return '2W';
  if (startsWith4 || remarkType.includes('4W') || remarkType.includes('FOUR')) return '4W';
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

  const dayStart = new Date(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), 0, 0, 0);
  const nextDayStart = new Date(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + 1, 0, 0, 0);
  const weekStart = new Date(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 6, 0, 0, 0);
  const monthStart = new Date(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 29, 0, 0, 0);

  const baseDate = Date.UTC(1899, 11, 30, 0, 0, 0);
  const toFloat = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - baseDate) / (24 * 60 * 60 * 1000);

  return {
    dayStartSql: formatSqlDateTime(dayStart),
    dayStartFloat: toFloat(dayStart),
    nextDayStartSql: formatSqlDateTime(nextDayStart),
    nextDayStartFloat: toFloat(nextDayStart),
    weekStartSql: formatSqlDateTime(weekStart),
    weekStartFloat: toFloat(weekStart),
    monthStartSql: formatSqlDateTime(monthStart),
    monthStartFloat: toFloat(monthStart),
  };
}

async function getVehicleStats(req, res) {
  try {
    const period = String(req.query.period || 'day').toLowerCase();
    const times = getLocalTimeWindows();
    const rangeStartFloat = period === 'week' ? times.weekStartFloat : period === 'month' ? times.monthStartFloat : times.dayStartFloat;
    const rangeEndFloat = period === 'day' ? times.nextDayStartFloat : null;

    const personnelMap = await getPersonnelMap();
    const result = await query(`
      SET NOCOUNT ON;
      SELECT
        c.CardData, c.DataTime, c.PCode, c.PersonnelID,
        CASE
          WHEN c.PortNum = 1 THEN 'Entry'
          WHEN c.PortNum = 2 THEN 'Exit'
          ELSE 'Unknown'
        END AS GateDirection
      FROM CardRecord c WITH (NOLOCK)
      WHERE c.DataTime >= @rangeStartFloat
        ${rangeEndFloat ? `AND c.DataTime < @rangeEndFloat` : ''}
    `, { rangeStartFloat, rangeEndFloat });

    const rawRecords = deduplicateRecords(result.recordset);

    const processed = rawRecords.map((r) => {
      const p = personnelMap.get(r.PersonnelID) || personnelMap.get(String(r.CardData)) || {};
      const scanTime = new Date(r.DataTime * 86400 * 1000 + new Date('1899-12-30').getTime());
      const vehicleType = getVehicleType({ vehicleType: p.vehicleType, Remark: p.Remark || r.Remark || '' });
      return {
        ...r,
        ScanTime: scanTime,
        ScanHour: scanTime.getUTCHours(),
        ScanDay: scanTime.toISOString().slice(0, 10),
        Remark: p.Remark || r.Remark || '',
        vehicleType,
      };
    });

    if (period === 'day') {
      const byHour = new Map();
      for (let i = 0; i < 24; i++) {
        byHour.set(i, {
          entry: 0,
          exit: 0,
          twoWheelerEntry: 0,
          twoWheelerExit: 0,
          fourWheelerEntry: 0,
          fourWheelerExit: 0,
        });
      }
      for (const r of processed) {
        const h = r.ScanHour;
        if (byHour.has(h)) {
          const bucket = byHour.get(h);
          if (r.GateDirection === 'Entry') {
            bucket.entry++;
            if (r.vehicleType === '2W') bucket.twoWheelerEntry++;
            else if (r.vehicleType === '4W') bucket.fourWheelerEntry++;
          } else if (r.GateDirection === 'Exit') {
            bucket.exit++;
            if (r.vehicleType === '2W') bucket.twoWheelerExit++;
            else if (r.vehicleType === '4W') bucket.fourWheelerExit++;
          }
        }
      }
      // Merge Temporal events into hourly buckets
      const dayStartMs = floatToMs(times.dayStartFloat);
      const dayEndMs   = floatToMs(times.nextDayStartFloat);
      for (const ev of temporalEvents.getAll()) {
        const ms = ev.timestampMs;
        if (ms < dayStartMs || ms >= dayEndMs) continue;
        // Use IST hour to match DB's ScanHour (which stores IST wall-clock as UTC)
        const h = new Date(ms + IST_OFFSET_MS).getUTCHours();
        if (byHour.has(h)) {
          const bucket = byHour.get(h);
          if (ev.type === 'ENTRY') bucket.entry++;
          else if (ev.type === 'EXIT') bucket.exit++;
        }
      }

      return res.json({ success: true, data: Array.from(byHour.entries()).map(([hour, counts]) => ({ hour, ...counts })) });
    } else {
      const byDay = new Map();
      for (const r of processed) {
        const d = r.ScanDay;
        if (!byDay.has(d)) {
          byDay.set(d, {
            entry: 0,
            exit: 0,
            twoWheelerEntry: 0,
            twoWheelerExit: 0,
            fourWheelerEntry: 0,
            fourWheelerExit: 0,
          });
        }
        const bucket = byDay.get(d);
        if (r.GateDirection === 'Entry') {
          bucket.entry++;
          if (r.vehicleType === '2W') bucket.twoWheelerEntry++;
          else if (r.vehicleType === '4W') bucket.fourWheelerEntry++;
        } else if (r.GateDirection === 'Exit') {
          bucket.exit++;
          if (r.vehicleType === '2W') bucket.twoWheelerExit++;
          else if (r.vehicleType === '4W') bucket.fourWheelerExit++;
        }
      }

      // Merge Temporal events into daily buckets
      const rangeStartMs = floatToMs(rangeStartFloat);
      for (const ev of temporalEvents.getAll()) {
        const ms = ev.timestampMs;
        if (ms < rangeStartMs) continue;
        const day = new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { entry: 0, exit: 0, twoWheelerEntry: 0, twoWheelerExit: 0, fourWheelerEntry: 0, fourWheelerExit: 0 });
        const bucket = byDay.get(day);
        if (ev.type === 'ENTRY') bucket.entry++;
        else if (ev.type === 'EXIT') bucket.exit++;
      }

      return res.json({ success: true, data: Array.from(byDay.entries()).map(([date, counts]) => ({ date, ...counts })).sort((a, b) => a.date.localeCompare(b.date)) });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleTypeCount(req, res) {
  try {
    const personnelMap = await getPersonnelMap();
    const { monthStartFloat } = getLocalTimeWindows();
    const result = await query(`
      SET NOCOUNT ON;
      SELECT c.CardData, c.DataTime, c.PCode, c.PersonnelID
      FROM CardRecord c WITH (NOLOCK)
      WHERE c.DataTime >= @monthStartFloat
    `, { monthStartFloat });

    let twoWheeler = 0, fourWheeler = 0, total = 0;
    const rawRecords = deduplicateRecords(result.recordset);
    const uniqueCards = new Set();
    for (const r of rawRecords) {
      if (uniqueCards.has(r.CardData)) continue;
      uniqueCards.add(r.CardData);
      total++;
      const p = personnelMap.get(r.PersonnelID) || personnelMap.get(String(r.CardData)) || {};
      const type = getVehicleType({ vehicleType: p.vehicleType, Remark: p.Remark });
      if (type === '2W') twoWheeler++;
      else if (type === '4W') fourWheeler++;
    }
    res.json({ success: true, data: { twoWheeler, fourWheeler, total } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleCount(req, res) {
  try {
    const t = getLocalTimeWindows();
    const personnelMap = await getPersonnelMap();
    const result = await query(`
      SET NOCOUNT ON;
      SELECT
        c.CardData, c.PCode, c.PersonnelID, c.DataTime,
        CASE
          WHEN c.PortNum = 1 THEN 'Entry'
          WHEN c.PortNum = 2 THEN 'Exit'
          ELSE 'Unknown'
        END AS GateDirection
      FROM CardRecord c WITH (NOLOCK)
      WHERE c.DataTime >= @monthStartFloat
    `, { monthStartFloat: t.monthStartFloat });

    const all = deduplicateRecords(result.recordset);
    const process = (recs) => {
      const unique = new Set();
      let entry = 0, exit = 0, twoWheeler = 0, fourWheeler = 0, twoWheelerEntry = 0, twoWheelerExit = 0, fourWheelerEntry = 0, fourWheelerExit = 0;
      for (const r of recs) {
        const p = personnelMap.get(r.PersonnelID) || personnelMap.get(String(r.CardData)) || {};
        const type = getVehicleType({ vehicleType: p.vehicleType, Remark: p.Remark });
        
        if (r.GateDirection === 'Entry') {
          entry++;
          if (type === '2W') twoWheelerEntry++;
          else if (type === '4W') fourWheelerEntry++;
        } else if (r.GateDirection === 'Exit') {
          exit++;
          if (type === '2W') twoWheelerExit++;
          else if (type === '4W') fourWheelerExit++;
        }
        if (!unique.has(r.CardData)) {
          unique.add(r.CardData);
          if (type === '2W') twoWheeler++;
          else if (type === '4W') fourWheeler++;
        }
      }
      return { total: unique.size, entry, exit, twoWheeler, fourWheeler, twoWheelerEntry, twoWheelerExit, fourWheelerEntry, fourWheelerExit };
    };

    const dayData   = process(all.filter(r => r.DataTime >= t.dayStartFloat));
    const weekData  = process(all.filter(r => r.DataTime >= t.weekStartFloat));
    const monthData = process(all);

    // Merge in-memory Temporal events so simulator scans appear in counts immediately
    const dayStartMs   = floatToMs(t.dayStartFloat);
    const dayEndMs     = floatToMs(t.nextDayStartFloat);
    const weekStartMs  = floatToMs(t.weekStartFloat);
    const monthStartMs = floatToMs(t.monthStartFloat);

    for (const ev of temporalEvents.getAll()) {
      const ms = ev.timestampMs;
      const isEntry = ev.type === 'ENTRY';
      const isExit  = ev.type === 'EXIT';
      if (!isEntry && !isExit) continue;

      if (ms >= dayStartMs && ms < dayEndMs) {
        if (isEntry) { dayData.entry++; dayData.total++; }
        else           dayData.exit++;
      }
      if (ms >= weekStartMs) {
        if (isEntry) { weekData.entry++; weekData.total++; }
        else           weekData.exit++;
      }
      if (ms >= monthStartMs) {
        if (isEntry) { monthData.entry++; monthData.total++; }
        else           monthData.exit++;
      }
    }

    res.json({ success: true, data: { day: dayData, week: weekData, month: monthData } });
  } catch (err) {
    console.error('getVehicleCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getEventCounts(req, res) {
  try {
    const { dayStartFloat, nextDayStartFloat } = getLocalTimeWindows();

    // Today's RFID read count
    const rfidResult = await query(`
      SET NOCOUNT ON;
      SELECT COUNT(*) AS cnt FROM CardRecord WITH (NOLOCK)
      WHERE DataTime >= @dayStartFloat AND DataTime < @nextDayStartFloat
    `, { dayStartFloat, nextDayStartFloat });
    const rfidCount = rfidResult.recordset[0].cnt;

    // Today's traffic light event count — graceful fallback if table not yet configured
    let lightCount = null;
    try {
      const lightResult = await query(`
        SET NOCOUNT ON;
        SELECT COUNT(*) AS cnt FROM OutputRecord WITH (NOLOCK)
        WHERE DataTime >= @dayStartFloat AND DataTime < @nextDayStartFloat
      `, { dayStartFloat, nextDayStartFloat }, { silent: true });
      lightCount = lightResult.recordset[0].cnt;
    } catch {
      lightCount = null; // Table not configured yet
    }

    const mismatch = lightCount !== null ? Math.max(0, rfidCount - lightCount) : null;

    res.json({ success: true, data: { rfidCount, lightCount, mismatch } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getVehicleStats, getVehicleTypeCount, getVehicleCount, getLocalTimeWindows, getEventCounts };
