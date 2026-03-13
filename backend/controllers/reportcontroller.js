const { query } = require('../db');

const DEDUP_SECONDS = 30;

function isAuthorizedPCodeSql(fieldName) {
    return `
      ${fieldName} IS NOT NULL
      AND LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255)))) NOT IN ('', '-', '0')
      AND LOWER(LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255))))) NOT IN ('null', 'undefined')
    `;
}

function buildSessionCTE(dateWhere = '') {
    return `
      WITH Deduped AS (
        SELECT
          c.CardRecordID,
          c.CardData,
          c.PName,
          c.PCode,
          p.Addr,
          c.EquptName,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          CASE
            WHEN UPPER(LTRIM(RTRIM(p.PDesc))) = '2W' THEN '2-Wheeler'
            WHEN UPPER(LTRIM(RTRIM(p.PDesc))) = '4W' THEN '4-Wheeler'
            ELSE 'Other'
          END AS VehicleType,
          CASE
            WHEN LTRIM(RTRIM(c.EquptName)) = '24074151 - 1' THEN 'Entry'
            WHEN LTRIM(RTRIM(c.EquptName)) = '24074151 - 2' THEN 'Exit'
            WHEN LOWER(c.EquptName) LIKE '%entry%' OR LOWER(c.EquptName) = 'in' THEN 'Entry'
            WHEN LOWER(c.EquptName) LIKE '%exit%' OR LOWER(c.EquptName) = 'out' THEN 'Exit'
            ELSE 'Unknown'
          END AS GateDir,
          ROW_NUMBER() OVER (
            PARTITION BY c.CardData, CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY c.CardRecordID DESC
          ) AS rn
        FROM CardRecord c
        LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
        WHERE 1=1 ${dateWhere}
      ),
      Clean AS (
        SELECT CardRecordID, CardData, PName, PCode, Addr, VehicleType, EquptName, GateDir, ScanTime
        FROM Deduped
        WHERE rn = 1
          AND GateDir <> 'Unknown'
          AND ${isAuthorizedPCodeSql('PCode')}
      ),
      WithNext AS (
        SELECT
          CardData,
          PName,
          PCode,
          Addr,
          VehicleType,
          ScanTime AS CurTime,
          EquptName AS CurGate,
          GateDir AS CurDir,
          LEAD(ScanTime) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
          LEAD(EquptName) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextGate,
          LEAD(GateDir) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
        FROM Clean
      ),
      Sessions AS (
        SELECT
          CardData,
          PName,
          PCode,
          Addr,
          VehicleType,
          CurTime AS EntryTime,
          CurGate AS EntryGate,
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
    const pad = (n) => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
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
          c.CardData,
          p.PDesc AS Remark,
          c.EquptName,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          ROW_NUMBER() OVER (
            PARTITION BY c.CardData, CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
            ORDER BY c.CardRecordID DESC
          ) AS rn
        FROM CardRecord c
        LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
      ),
      Clean AS (
        SELECT CardData, Remark, EquptName, ScanTime
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
      ),
      LastGateClassified AS (
        SELECT
          CardData,
          CASE
            WHEN LTRIM(RTRIM(LastGate)) = '24074151 - 1' THEN 'Entry'
            WHEN LTRIM(RTRIM(LastGate)) = '24074151 - 2' THEN 'Exit'
            WHEN LOWER(LastGate) LIKE '%entry%' OR LOWER(LastGate) = 'in' THEN 'Entry'
            WHEN LOWER(LastGate) LIKE '%exit%' OR LOWER(LastGate) = 'out' THEN 'Exit'
            ELSE 'Unknown'
          END AS LastGateDir
        FROM LastScan
      )
      SELECT
        (SELECT COUNT(DISTINCT CardData) FROM Clean)                                AS TotalVehicles,
        (SELECT COUNT(*) FROM Clean WHERE UPPER(LTRIM(RTRIM(Remark))) = '2W')      AS TwoWheeler,
        (SELECT COUNT(*) FROM Clean WHERE UPPER(LTRIM(RTRIM(Remark))) = '4W')      AS FourWheeler,
        (SELECT COUNT(*) FROM LastGateClassified WHERE LastGateDir = 'Entry')      AS StillInside
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
        const all = req.query.all === '1';

        const dateConditions = [];
        if (from) {
            dateConditions.push(`DATEADD(SECOND, DataTime * 86400, '1899-12-30') >= '${from} 00:00:00'`);
        }
        if (to) {
            dateConditions.push(`DATEADD(SECOND, DataTime * 86400, '1899-12-30') <= '${to} 23:59:59'`);
        }
        const dateWhere = dateConditions.length ? 'AND ' + dateConditions.join(' AND ') : '';

        const sessionConditions = [];
        if (type === '2') sessionConditions.push(`s.VehicleType = '2-Wheeler'`);
        if (type === '4') sessionConditions.push(`s.VehicleType = '4-Wheeler'`);
        if (status === 'inside') sessionConditions.push(`s.ExitTime IS NULL`);
        if (status === 'exited') sessionConditions.push(`s.ExitTime IS NOT NULL`);
        if (search) {
            const safeSearch = search.replace(/'/g, "''");
            sessionConditions.push(`(
                CAST(s.CardData AS NVARCHAR(255)) LIKE '%${safeSearch}%'
                OR CAST(s.PName AS NVARCHAR(255)) LIKE '%${safeSearch}%'
                OR CAST(s.PCode AS NVARCHAR(255)) LIKE '%${safeSearch}%'
                OR CAST(s.Addr AS NVARCHAR(255)) LIKE '%${safeSearch}%'
            )`);
        }
        const sessionWhere = sessionConditions.length ? 'WHERE ' + sessionConditions.join(' AND ') : '';

        const cte = buildSessionCTE(dateWhere);

        if (download) {
            const rows = await query(`
        ${cte}
        SELECT s.CardData, s.PName, s.PCode, s.Addr, s.VehicleType, s.EntryTime, s.EntryGate,
               s.ExitTime, s.ExitGate, s.Status
        FROM Sessions s
        ${sessionWhere}
        ORDER BY s.EntryTime DESC
      `);

            const header = 'Card ID,Name,Flat,Access Code,Vehicle Type,Entry Time,Exit Time,Duration,Status';
            const csvRows = rows.recordset.map((r) => {
                const start = r.EntryTime ? new Date(r.EntryTime) : null;
                const end = r.ExitTime ? new Date(r.ExitTime) : new Date();
                const totalMinutes = start && !isNaN(start) && end && !isNaN(end)
                    ? Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))
                    : null;
                const hours = totalMinutes == null ? '' : Math.floor(totalMinutes / 60);
                const minutes = totalMinutes == null ? '' : totalMinutes % 60;
                const duration = totalMinutes == null ? '' : `${hours}h ${minutes}m`;

                return [
                    `"${String(r.CardData || '').replace(/"/g, '""')}"`,
                    `"${String(r.PName || '').replace(/"/g, '""')}"`,
                    `"${String(r.Addr || '').replace(/"/g, '""')}"`,
                    `"${String(r.PCode || '').replace(/"/g, '""')}"`,
                    `"${String(r.VehicleType || '').replace(/"/g, '""')}"`,
                    `"${toISTString(r.EntryTime) || ''}"`,
                    `"${r.ExitTime ? toISTString(r.ExitTime) : 'Still Inside'}"`,
                    `"${duration}"`,
                    `"${String(r.Status || '').replace(/"/g, '""')}"`,
                ].join(',');
            });

            const csv = [header, ...csvRows].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="vehicle-sessions-${Date.now()}.csv"`);
            return res.send(csv);
        }

        if (all) {
            const allRows = await query(`
      ${cte}
      SELECT s.CardData, s.PName, s.PCode, s.Addr, s.VehicleType, s.EntryTime, s.EntryGate,
             s.ExitTime, s.ExitGate, s.Status
      FROM Sessions s
      ${sessionWhere}
      ORDER BY s.EntryTime DESC
    `);

            const normalisedAll = allRows.recordset.map((r) => ({
                ...r,
                EntryTime: toISTString(r.EntryTime),
                ExitTime: r.ExitTime ? toISTString(r.ExitTime) : null,
            }));

            return res.json({
                success: true,
                data: {
                    records: normalisedAll,
                    total: normalisedAll.length,
                },
            });
        }

        const combined = await query(`
      ${cte},
      Filtered AS (
        SELECT s.CardData, s.PName, s.PCode, s.Addr, s.VehicleType, s.EntryTime, s.EntryGate,
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

// GET /api/report/occupancy
async function getVehicleOccupancy(req, res) {
    try {
        const status = req.query.status || '';

        const result = await query(`
      ${buildSessionCTE()}
      , LatestSessions AS (
        SELECT
          s.CardData,
          s.PName,
          s.PCode,
          s.Addr,
          s.VehicleType,
          s.EntryTime,
          s.EntryGate,
          s.ExitTime,
          s.ExitGate,
          s.Status,
          ROW_NUMBER() OVER (
            PARTITION BY s.CardData
            ORDER BY COALESCE(s.ExitTime, s.EntryTime) DESC, s.EntryTime DESC
          ) AS rn
        FROM Sessions s
      ),
      CurrentStatus AS (
        SELECT
          CardData,
          PName,
          PCode,
          Addr,
          VehicleType,
          EntryTime,
          EntryGate,
          ExitTime,
          ExitGate,
          Status
        FROM LatestSessions
        WHERE rn = 1
      )
      SELECT * FROM CurrentStatus
      ORDER BY COALESCE(ExitTime, EntryTime) DESC, EntryTime DESC
    `);

        const allRecords = result.recordset.map((r) => ({
            ...r,
            EntryTime: toISTString(r.EntryTime),
            ExitTime: r.ExitTime ? toISTString(r.ExitTime) : null,
        }));

        const insideRecords = allRecords.filter((r) => r.Status === 'Still Inside');
        const outsideRecords = allRecords.filter((r) => r.Status === 'Exited');

        const filteredRecords = status === 'inside'
            ? insideRecords
            : status === 'outside'
                ? outsideRecords
                : allRecords;

        res.json({
            success: true,
            data: {
                insideCount: insideRecords.length,
                outsideCount: outsideRecords.length,
                records: filteredRecords,
            },
        });
    } catch (err) {
        console.error('getVehicleOccupancy error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy };
