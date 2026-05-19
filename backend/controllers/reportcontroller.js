const { query } = require('../db');
const { getLocalTimeWindows } = require('./statsController');
const { getPersonnelMap } = require('../personnelCache');

const DEDUP_SECONDS = 30;

function buildSessionCTE(dateWhere = '') {
    return `;
      WITH RawData AS (
        SELECT
          c.CardRecordID,
          c.CardData,
          c.PName,
          c.PCode,
          c.PersonnelID,
          c.EquptName,
          c.PortNum,
          c.DataTime,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          CASE
            WHEN c.PortNum = 1 THEN 'Entry'
            WHEN c.PortNum = 2 THEN 'Exit'
            ELSE 'Unknown'
          END AS GateDir
        FROM CardRecord c WITH (NOLOCK)
        WHERE 1=1 ${dateWhere}
      ),
      Deduped AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY CardData, CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY CardRecordID DESC
          ) AS rn
        FROM RawData
      ),
      Clean AS (
        SELECT * FROM Deduped 
        WHERE rn = 1 AND GateDir <> 'Unknown'
      ),
      WithNext AS (
        SELECT
          CardData, PName, PCode, PersonnelID,
          ScanTime AS CurTime, EquptName AS CurGate, GateDir AS CurDir,
          LEAD(ScanTime) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
          LEAD(EquptName) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextGate,
          LEAD(GateDir) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
        FROM Clean
      ),
      Sessions AS (
        SELECT
          CardData, PName, PCode, PersonnelID,
          CurTime AS EntryTime, CurGate AS EntryGate,
          CASE WHEN NextDir = 'Exit' THEN NextTime ELSE NULL END AS ExitTime,
          CASE WHEN NextDir = 'Exit' THEN NextGate ELSE NULL END AS ExitGate,
          CASE WHEN NextDir = 'Exit' THEN 'Exited' ELSE 'Still Inside' END AS Status
        FROM WithNext
        WHERE CurDir = 'Entry'
      )
    `;
}

function toISTString(val) {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d)) return null;
    return d.toISOString().replace('Z', '').split('.')[0];
}

async function getDebug(req, res) {
    try {
        const gates = await query(`
      SET NOCOUNT ON;
      SELECT DISTINCT EquptName, COUNT(*) AS cnt
      FROM CardRecord WITH (NOLOCK)
      GROUP BY EquptName
      ORDER BY cnt DESC
    `);
        res.json({ success: true, gates: gates.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

async function getReportSummary(req, res) {
    try {
        const { monthStartFloat } = getLocalTimeWindows();
        const result = await query(`
      SET NOCOUNT ON;
      SELECT CardData, CardRecordID, DataTime
      FROM CardRecord WITH (NOLOCK)
      WHERE DataTime >= @monthStartFloat
    `, { monthStartFloat });

        const all = result.recordset;
        const vehicles = new Set(all.map(r => r.CardData)).size;
        res.json({ success: true, data: { totalVehicles: vehicles, totalScans: all.length } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

function normalizeVehicleType(value) {
  const text = (value || '').toString().trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.startsWith('2')) return '2-Wheeler';
  if (upper.startsWith('4')) return '4-Wheeler';
  return text;
}

function formatDurationMinutes(entryTime, exitTime) {
  const start = entryTime ? new Date(entryTime) : null;
  const end = exitTime ? new Date(exitTime) : new Date();
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';
  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function getAuthorizationLabel(pcode) {
  const value = (pcode ?? '').toString().trim();
  return value !== '' && value !== '-' ? 'Authorized' : 'Unauthorized';
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
  const value = flag.toString().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

async function getReportRecords(req, res) {
  try {
    const { startDate, endDate, from, to, page = 1, limit = 50, search, status, type, download, all, authorization } = req.query;
    const resolvedStart = startDate || from;
    const resolvedEnd = endDate || to;
    let where = '';
    const params = {};
    const personnelMap = await getPersonnelMap();
        
    if (resolvedStart) {
      const start = new Date(resolvedStart);
      const baseDate = new Date('1899-12-30').getTime();
      params.startFloat = (start.getTime() - baseDate) / (24 * 60 * 60 * 1000);
      where += ` AND c.DataTime >= @startFloat`;
    }
    if (resolvedEnd) {
      const end = new Date(resolvedEnd);
      end.setDate(end.getDate() + 1); // Make it inclusive of the end day
      const baseDate = new Date('1899-12-30').getTime();
      params.endFloat = (end.getTime() - baseDate) / (24 * 60 * 60 * 1000);
      where += ` AND c.DataTime < @endFloat`;
    }

    const result = await query(`
    ${buildSessionCTE(where)}
    SELECT * FROM Sessions ORDER BY EntryTime DESC
  `, params);

    let records = result.recordset.map(r => {
      const p = personnelMap.get(r.PersonnelID) || {};
      const vehicleType = normalizeVehicleType(p.Remark || p.VehicleType || p.PDesc || p.Remarks);
      const authorization = getAuthorizationLabel(r.PCode || p.PCode);
      return {
        ...r,
        Addr: p.Addr || null,
        VehicleType: vehicleType,
        Authorization: authorization,
        EntryTime: toISTString(r.EntryTime),
        ExitTime: toISTString(r.ExitTime)
      };
    });

    // Apply Search Filter (in-memory since session logic is complex)
    if (search) {
      const s = search.toLowerCase();
      records = records.filter(r => 
        (r.CardData && r.CardData.toLowerCase().includes(s)) ||
        (r.PName && r.PName.toLowerCase().includes(s)) ||
        (r.Addr && r.Addr.toLowerCase().includes(s)) ||
        (r.PCode && r.PCode.toLowerCase().includes(s))
      );
    }

    // Apply Status Filter
    if (status === 'inside') {
      records = records.filter(r => r.Status === 'Still Inside');
    } else if (status === 'exited') {
      records = records.filter(r => r.Status === 'Exited');
    }

    // Apply Type Filter (2 or 4)
    if (type) {
      const desired = type.toString();
      records = records.filter(r => {
        const norm = normalizeVehicleType(r.VehicleType || '');
        const upper = (norm || '').toString().toUpperCase();
        return desired === '2' ? upper.startsWith('2') : desired === '4' ? upper.startsWith('4') : true;
      });
    }

    // Apply Authorization Filter
    if (authorization) {
      const target = authorization.toLowerCase();
      records = records.filter(r => r.Authorization.toLowerCase() === target);
    }

    const total = records.length;
    const p = parseInt(page);
    const l = parseInt(limit);
    const totalPages = Math.max(1, Math.ceil(total / l));
    const returnAll = shouldDownload(download) ? true : (all && all.toString().toLowerCase() !== '0' && all.toString().toLowerCase() !== 'false');

    if (shouldDownload(download)) {
      const safeRecords = records.map(r => ({
        ...r,
        EntryTime: r.EntryTime || '-',
        ExitTime: r.ExitTime || '-',
        Duration: formatDurationMinutes(r.EntryTime, r.ExitTime)
      }));

      const header = 'Card ID,Vehicle No.,Company Name,Authorization,Type,Entry Time,Exit Time,Duration,Status\n';
      const rows = safeRecords.map(r => [
        csvEscape(r.CardData),
        csvEscape(r.PName),
        csvEscape(r.Addr),
        csvEscape(r.Authorization),
        csvEscape(r.VehicleType),
        csvEscape(r.EntryTime),
        csvEscape(r.ExitTime),
        csvEscape(r.Duration),
        csvEscape(r.Status)
      ].join(',')).join('\n');

      const csv = `${header}${rows}`;
      const fileName = `vehicle-report-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(csv);
    }

    const payloadRecords = returnAll ? records : records.slice((p - 1) * l, p * l);

    res.json({ 
      success: true, 
      data: {
        records: payloadRecords,
        total: total,
        page: returnAll ? 1 : p,
        limit: returnAll ? records.length : l,
        totalPages: returnAll ? 1 : totalPages
      } 
    });
  } catch (err) {
    console.error('getReportRecords error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleOccupancy(req, res) {
    try {
        const { status } = req.query;
        // Use the month window so ongoing sessions from previous days are included in "Still Inside"
        const { monthStartFloat } = getLocalTimeWindows();
        const personnelMap = await getPersonnelMap();
        const where = ` AND c.DataTime >= @monthStartFloat`;

        const result = await query(`
      ${buildSessionCTE(where)}
      , LatestSessions AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY CardData ORDER BY EntryTime DESC) AS session_rn
        FROM Sessions
      )
      SELECT * FROM LatestSessions WHERE session_rn = 1
    `, { monthStartFloat });

        const allRecords = result.recordset.map(r => {
            const p = personnelMap.get(r.PersonnelID) || {};
            return {
                ...r,
                Addr: p.Addr || null,
                VehicleType: (p.Remark || '').toString().trim().toUpperCase() === '2W' ? '2-Wheeler' : (p.Remark || '').toString().trim().toUpperCase() === '4W' ? '4-Wheeler' : (p.Remark || null),
                EntryTimeRaw: r.EntryTime,
                EntryTime: toISTString(r.EntryTime),
                ExitTime: toISTString(r.ExitTime),
            };
        });

        const inside = allRecords.filter(r => r.Status === 'Still Inside');
        const outside = allRecords.filter(r => r.Status === 'Exited');
        
        const now = new Date();
        const overstay = inside.filter(r => {
            const entryDate = new Date(r.EntryTimeRaw);
            const entryTimeLocalAsUtc = entryDate.getTime();
            const nowLocalAsUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
            return (nowLocalAsUtc - entryTimeLocalAsUtc) / (1000 * 60 * 60) > 24;
        });

        res.json({
            success: true,
            data: {
                insideCount: inside.length,
                outsideCount: outside.length,
                overstayCount: overstay.length,
                records: status === 'inside' ? inside : status === 'outside' ? outside : status === 'overstay' ? overstay : allRecords
            }
        });
    } catch (err) {
        console.error('getVehicleOccupancy error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

const { check24HourStays } = require('../services/cronJobs');

async function trigger24hAlert(req, res) {
    try {
        const vehicles = await check24HourStays(true); // force run
        res.json({ success: true, data: vehicles });
    } catch (err) {
        console.error('trigger24hAlert error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy, trigger24hAlert };
