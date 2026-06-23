const { pgQuery } = require('../pgdb');
const { getLocalTimeWindows } = require('./statsController');
const temporalEvents = require('../temporalEvents');

const SCHEMA = 'cybertowers';

// Build entry→exit sessions from scan_events using window functions
async function querySessions(whereClause, params) {
  const { rows } = await pgQuery(`
    WITH ordered AS (
      SELECT
        card_no, person_name, company_code, vehicle_number, location_label,
        event_date, direction,
        LEAD(event_date)     OVER (PARTITION BY card_no ORDER BY event_date) AS next_event_date,
        LEAD(direction)      OVER (PARTITION BY card_no ORDER BY event_date) AS next_direction,
        LEAD(location_label) OVER (PARTITION BY card_no ORDER BY event_date) AS next_gate
      FROM ${SCHEMA}.scan_events
      WHERE direction IN ('In', 'Out') ${whereClause}
    )
    SELECT
      card_no     AS "CardData",
      person_name AS "PName",
      company_code AS "PCode",
      vehicle_number AS "CarNumber",
      event_date  AS "EntryTime",
      location_label AS "EntryGate",
      CASE WHEN next_direction = 'Out' THEN next_event_date ELSE NULL END AS "ExitTime",
      CASE WHEN next_direction = 'Out' THEN next_gate ELSE NULL END AS "ExitGate",
      CASE WHEN next_direction = 'Out' THEN 'Exited' ELSE 'Still Inside' END AS "Status"
    FROM ordered
    WHERE direction = 'In'
    ORDER BY event_date DESC
  `, params);
  return rows;
}

function toISTString(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function formatDurationMinutes(entryTime, exitTime) {
  const start = entryTime ? new Date(entryTime) : null;
  const end = exitTime ? new Date(exitTime) : new Date();
  if (!start || isNaN(start) || isNaN(end)) return '-';
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function normalizeVehicleType(value) {
  const text = (value || '').toString().trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.startsWith('2')) return '2-Wheeler';
  if (upper.startsWith('4')) return '4-Wheeler';
  return text;
}

function csvEscape(value) {
  if (value === undefined || value === null) return '';
  const text = value.toString();
  if (text.includes(',') || text.includes('\n') || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function shouldDownload(flag) {
  if (!flag) return false;
  const v = flag.toString().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function getDebug(req, res) {
  try {
    const { rows } = await pgQuery(`
      SELECT location_label, COUNT(*) AS cnt
      FROM ${SCHEMA}.scan_events
      GROUP BY location_label
      ORDER BY cnt DESC
    `);
    res.json({ success: true, gates: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getReportSummary(req, res) {
  try {
    const { monthStart } = getLocalTimeWindows();
    const { rows } = await pgQuery(`
      SELECT COUNT(*) AS total_scans, COUNT(DISTINCT card_no) AS total_vehicles
      FROM ${SCHEMA}.scan_events
      WHERE event_date >= $1
    `, [monthStart]);
    const r = rows[0] || { total_scans: 0, total_vehicles: 0 };
    res.json({ success: true, data: { totalVehicles: Number(r.total_vehicles), totalScans: Number(r.total_scans) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getReportRecords(req, res) {
  try {
    const { startDate, endDate, from, to, page = 1, limit = 50, search, status, type, download, all, authorization } = req.query;
    const resolvedStart = startDate || from;
    const resolvedEnd   = endDate   || to;

    const params = [];
    let whereClause = '';
    if (resolvedStart) {
      params.push(new Date(resolvedStart).toISOString());
      whereClause += ` AND event_date >= $${params.length}`;
    }
    if (resolvedEnd) {
      params.push(new Date(resolvedEnd + 'T23:59:59Z').toISOString());
      whereClause += ` AND event_date <= $${params.length}`;
    }

    let records = await querySessions(whereClause, params);
    records = records.map(r => ({
      ...r,
      VehicleType:   normalizeVehicleType(r.CarNumber),
      Authorization: (r.PCode || '').toString().trim() ? 'Authorized' : 'Unauthorized',
      EntryTime: r.EntryTime,
      ExitTime:  r.ExitTime,
    }));

    // Prepend Temporal in-memory sessions
    const fromMs = resolvedStart ? new Date(resolvedStart).getTime() : 0;
    const toMs   = resolvedEnd   ? new Date(resolvedEnd).getTime() + 86400000 : Infinity;
    const tSessions = temporalEvents.buildSessions(fromMs, toMs);
    if (tSessions.length > 0) records = [...tSessions, ...records];

    if (search) {
      const s = search.toLowerCase();
      records = records.filter(r =>
        (r.CardData  && r.CardData.toLowerCase().includes(s))  ||
        (r.PName     && r.PName.toLowerCase().includes(s))     ||
        (r.PCode     && r.PCode.toLowerCase().includes(s))     ||
        (r.CarNumber && r.CarNumber.toLowerCase().includes(s))
      );
    }
    if (status === 'inside')  records = records.filter(r => r.Status === 'Still Inside');
    else if (status === 'exited') records = records.filter(r => r.Status === 'Exited');
    if (type) {
      records = records.filter(r => {
        const upper = (normalizeVehicleType(r.VehicleType) || '').toUpperCase();
        return type === '2' ? upper.startsWith('2') : type === '4' ? upper.startsWith('4') : true;
      });
    }
    if (authorization) {
      const target = authorization.toLowerCase();
      records = records.filter(r => (r.Authorization || '').toLowerCase() === target);
    }

    const total      = records.length;
    const p          = parseInt(page);
    const l          = parseInt(limit);
    const totalPages = Math.max(1, Math.ceil(total / l));
    const returnAll  = shouldDownload(download) || (all && all !== '0' && all !== 'false');

    if (shouldDownload(download)) {
      const header = 'Card ID,Vehicle No.,Company Code,Authorization,Type,Entry Time,Exit Time,Duration,Status\n';
      const rows = records.map(r => [
        csvEscape(r.CardData),
        csvEscape(r.PName || r.CarNumber),
        csvEscape(r.PCode),
        csvEscape(r.Authorization),
        csvEscape(r.VehicleType),
        csvEscape(toISTString(r.EntryTime) || '-'),
        csvEscape(toISTString(r.ExitTime) || '-'),
        csvEscape(formatDurationMinutes(r.EntryTime, r.ExitTime)),
        csvEscape(r.Status),
      ].join(',')).join('\n');
      const fileName = `vehicle-report-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(`${header}${rows}`);
    }

    const payloadRecords = returnAll ? records : records.slice((p - 1) * l, p * l);
    res.json({
      success: true,
      data: { records: payloadRecords, total, page: returnAll ? 1 : p, limit: returnAll ? records.length : l, totalPages: returnAll ? 1 : totalPages },
    });
  } catch (err) {
    console.error('getReportRecords error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleOccupancy(req, res) {
  try {
    const { status } = req.query;
    const { monthStart } = getLocalTimeWindows();
    const sessions = await querySessions(' AND event_date >= $1', [monthStart]);

    // Keep only the most recent session per card
    const latestByCard = new Map();
    for (const s of sessions) {
      if (!latestByCard.has(s.CardData)) latestByCard.set(s.CardData, s);
    }
    const allRecords = Array.from(latestByCard.values()).map(r => ({
      ...r,
      VehicleType: normalizeVehicleType(r.CarNumber),
      EntryTimeRaw: r.EntryTime,
      EntryTime: toISTString(r.EntryTime),
      ExitTime:  toISTString(r.ExitTime),
    }));

    const inside  = allRecords.filter(r => r.Status === 'Still Inside');
    const outside = allRecords.filter(r => r.Status === 'Exited');
    const now = Date.now();
    const overstay = inside.filter(r => {
      const entryMs = r.EntryTimeRaw ? new Date(r.EntryTimeRaw).getTime() : 0;
      return entryMs && (now - entryMs) / 3600000 > 24;
    });

    // Merge Temporal "Still Inside" sessions
    const sevenDaysAgo = now - 7 * 86400000;
    const tSessions = temporalEvents.buildSessions(sevenDaysAgo);
    const tInside = tSessions
      .filter(s => s.Status === 'Still Inside')
      .map(s => ({ ...s, EntryTimeRaw: s.EntryTime, VehicleType: null }));

    const allInsideRecords  = [...inside, ...tInside];
    const allRecordsWithT   = [...allRecords, ...tInside];

    res.json({
      success: true,
      data: {
        insideCount:   allInsideRecords.length,
        outsideCount:  outside.length,
        overstayCount: overstay.length,
        records: status === 'inside'   ? allInsideRecords
               : status === 'outside'  ? outside
               : status === 'overstay' ? overstay
               : allRecordsWithT,
      },
    });
  } catch (err) {
    console.error('getVehicleOccupancy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function trigger24hAlert(req, res) {
  try {
    const { check24HourStays } = require('../services/cronJobs');
    const vehicles = await check24HourStays(true);
    res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error('trigger24hAlert error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy, trigger24hAlert };
