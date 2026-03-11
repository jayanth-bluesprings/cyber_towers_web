const { query } = require('../db');

const DEDUP_SECONDS = 30;

function toISTString(val) {
    if (!val) return null;
    const s = String(val);
    const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + '+05:30');
    if (isNaN(d)) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
    const t = new Date(utcMs + 5.5 * 3600000);
    return (
        `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` +
        `T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}+05:30`
    );
}

// GET /api/report/debug
// Call this first to see what EquptName values actually exist in your DB
async function getDebug(req, res) {
    try {
        const gates = await query(`
      SELECT DISTINCT EquptName, COUNT(*) AS cnt
      FROM CardRecord
      GROUP BY EquptName
      ORDER BY cnt DESC
    `);
        const sample = await query(`
      SELECT TOP 10
        CardRecordID, CardData, EquptName,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime
      FROM CardRecord
      ORDER BY CardRecordID DESC
    `);
        res.json({
            gates: gates.recordset,
            sample: sample.recordset,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// GET /api/report/summary
async function getReportSummary(req, res) {
    try {
        const result = await query(`
      WITH Deduped AS (
        SELECT
          CardData,
          EquptName,
          DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY CardData, CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY CardRecordID DESC
          ) AS rn
        FROM CardRecord
      ),
      Clean AS (
        SELECT CardData, EquptName, ScanTime
        FROM Deduped WHERE rn = 1
      ),
      LastScan AS (
        SELECT DISTINCT CardData,
               LAST_VALUE(EquptName) OVER (
                 PARTITION BY CardData
                 ORDER BY ScanTime
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
               ) AS LastGate
        FROM Clean
      )
      SELECT
        (SELECT COUNT(DISTINCT CardData) FROM Clean)                                AS TotalVehicles,
        (SELECT COUNT(*) FROM Clean WHERE LEFT(CardData,1)='2')                    AS TwoWheeler,
        (SELECT COUNT(*) FROM Clean WHERE LEFT(CardData,1)='4')                    AS FourWheeler,
        (SELECT COUNT(*) FROM LastScan WHERE LOWER(LastGate) LIKE '%entry%')       AS StillInside
    `);

        const r = result.recordset[0];
        res.json({
            success: true,
            data: {
                totalVehicles: r.TotalVehicles,
                twoWheeler: r.TwoWheeler,
                fourWheeler: r.FourWheeler,
                stillInside: r.StillInside,
            },
        });
    } catch (err) {
        console.error('getReportSummary error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

// GET /api/report/records
async function getReportRecords(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '50')));
        const offset = (page - 1) * limit;
        const from = req.query.from || null;
        const to = req.query.to || null;
        const type = req.query.type || '';
        const search = req.query.search || '';
        const status = req.query.status || '';
        const download = req.query.download === '1';

        const dateConditions = [];
        if (from) dateConditions.push(`DATEADD(SECOND, DataTime * 86400, '1899-12-30') >= '${from} 00:00:00'`);
        if (to) dateConditions.push(`DATEADD(SECOND, DataTime * 86400, '1899-12-30') <= '${to} 23:59:59'`);
        const dateWhere = dateConditions.length ? 'AND ' + dateConditions.join(' AND ') : '';

        const sessionConditions = [];
        if (type === '2') sessionConditions.push(`LEFT(s.CardData,1) = '2'`);
        if (type === '4') sessionConditions.push(`LEFT(s.CardData,1) = '4'`);
        if (search) sessionConditions.push(`s.CardData LIKE '%${search.replace(/'/g, "''")}%'`);
        if (status === 'inside') sessionConditions.push(`s.ExitTime IS NULL`);
        if (status === 'exited') sessionConditions.push(`s.ExitTime IS NOT NULL`);
        const sessionWhere = sessionConditions.length ? 'WHERE ' + sessionConditions.join(' AND ') : '';

        // NOTE: We match gate names flexibly:
        //   Entry = EquptName contains 'entry' (case-insensitive) OR is exactly 'in'
        //   Exit  = EquptName contains 'exit'  (case-insensitive) OR is exactly 'out'
        // Adjust the CASE expressions below if your gate names are different.
        // Visit /api/report/debug to see your actual EquptName values.
        const cte = `
      WITH Deduped AS (
        SELECT
          CardRecordID,
          CardData,
          EquptName,
          DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
          CASE WHEN LEFT(CardData,1)='2' THEN '2-Wheeler'
               WHEN LEFT(CardData,1)='4' THEN '4-Wheeler'
               ELSE 'Other' END AS VehicleType,
          -- Normalise gate direction
          CASE
            WHEN LOWER(EquptName) LIKE '%entry%' OR LOWER(EquptName) = 'in'  THEN 'Entry'
            WHEN LOWER(EquptName) LIKE '%exit%'  OR LOWER(EquptName) = 'out' THEN 'Exit'
            ELSE 'Entry'   -- treat unknown gates as Entry so they show up
          END AS GateDir,
          ROW_NUMBER() OVER (
            PARTITION BY CardData, CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY CardRecordID DESC
          ) AS rn
        FROM CardRecord
        WHERE 1=1 ${dateWhere}
      ),
      Clean AS (
        SELECT CardRecordID, CardData, VehicleType, EquptName, GateDir, ScanTime
        FROM Deduped WHERE rn = 1
      ),
      WithNext AS (
        SELECT
          CardData,
          VehicleType,
          ScanTime  AS CurTime,
          EquptName AS CurGate,
          GateDir   AS CurDir,
          LEAD(ScanTime)   OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
          LEAD(EquptName)  OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextGate,
          LEAD(GateDir)    OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
        FROM Clean
      ),
      Sessions AS (
        SELECT
          CardData,
          VehicleType,
          CurTime  AS EntryTime,
          CurGate  AS EntryGate,
          CASE WHEN NextDir = 'Exit' THEN NextTime ELSE NULL END AS ExitTime,
          CASE WHEN NextDir = 'Exit' THEN NextGate ELSE NULL END AS ExitGate,
          CASE WHEN NextDir = 'Exit' THEN 'Exited' ELSE 'Still Inside' END AS Status
        FROM WithNext
        WHERE CurDir = 'Entry'
      )
    `;

        if (download) {
            const rows = await query(`
        ${cte}
        SELECT s.CardData, s.VehicleType, s.EntryTime, s.EntryGate,
               s.ExitTime, s.ExitGate, s.Status
        FROM Sessions s
        ${sessionWhere}
        ORDER BY s.EntryTime DESC
      `);

            const header = 'Card Data,Vehicle Type,Entry Time,Entry Gate,Exit Time,Exit Gate,Status';
            const csvRows = rows.recordset.map(r => [
                `"${String(r.CardData || '').replace(/"/g, '""')}"`,
                `"${r.VehicleType}"`,
                `"${toISTString(r.EntryTime) || ''}"`,
                `"${String(r.EntryGate || '').replace(/"/g, '""')}"`,
                `"${r.ExitTime ? toISTString(r.ExitTime) : 'Still Inside'}"`,
                `"${r.ExitTime ? String(r.ExitGate || '').replace(/"/g, '""') : '—'}"`,
                `"${r.Status}"`,
            ].join(','));

            const csv = [header, ...csvRows].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="vehicle-sessions-${Date.now()}.csv"`);
            return res.send(csv);
        }

        const combined = await query(`
      ${cte},
      Filtered AS (
        SELECT s.CardData, s.VehicleType, s.EntryTime, s.EntryGate,
               s.ExitTime, s.ExitGate, s.Status,
               COUNT(*) OVER () AS TotalRows
        FROM Sessions s
        ${sessionWhere}
      )
      SELECT * FROM Filtered
      ORDER BY EntryTime DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `);

        const records = combined.recordset;
        const total = records.length > 0 ? Number(records[0].TotalRows) : 0;
        const normalised = records.map(({ TotalRows, ...r }) => ({
            ...r,
            EntryTime: toISTString(r.EntryTime),
            ExitTime: r.ExitTime ? toISTString(r.ExitTime) : null,
        }));

        res.json({
            success: true,
            data: { records: normalised, total, page, limit, totalPages: Math.ceil(total / limit) },
        });
    } catch (err) {
        console.error('getReportRecords error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { getDebug, getReportSummary, getReportRecords };