// ═══════════════════════════════════════════════════════════════
//  REPORT ACTIVITIES — used by WF4 (Daily Summary Report)
// ═══════════════════════════════════════════════════════════════
//
//  These activities replicate EXACTLY what sendDailySummary() does
//  in backend/services/cronJobs.js — but now they run inside Temporal
//  so they are durable, retried on failure, and can never be missed.
//
//  THE BUG THIS FIXES:
//    Old code:  cron.schedule('59 23 * * *', sendDailySummary)
//    Problem:   If server is DOWN at 11:59 PM → report is MISSED FOREVER.
//               node-cron has no memory of missed jobs.
//    Fix:       Temporal Schedule fires WF4 at 11:59 PM.
//               If server was down → Temporal catches up when it restarts.
//               Report is NEVER missed permanently.
//
//  TYPESCRIPT CONCEPT: number[] and string[]
//    number[] = an array of numbers   e.g. [1, 5, 14, 23]
//    string[] = an array of strings   e.g. ["MSFT", "GOOGL"]
//    The [] at the end means "array of"
//
//  TYPESCRIPT CONCEPT: object destructuring
//    const { TotalEntries = 0, TotalExits = 0 } = row;
//    = "pull TotalEntries and TotalExits out of the row object"
//    = 0 after the = is the DEFAULT if the value is undefined
//
// ═══════════════════════════════════════════════════════════════

import * as sql     from 'mssql';
import * as path    from 'path';
import * as dotenv  from 'dotenv';
import * as nodemailer from 'nodemailer';
import type {
  DailyReportStats,
  InsideVehicle,
  CompanyDailyStat,
  WeeklyReportStats,
  DailyBreakdown,
  CompanyWeeklyStat,
  TopCard,
} from '../shared/types';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// ─── DB CONNECTION (same config as backend/db.js) ─────────────
const dbConfig: sql.config = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'TimeWatch',
  port:     parseInt(process.env.DB_PORT || '1433'),
  options:  { encrypt: false, trustServerCertificate: true, requestTimeout: 60000 },
  pool:     { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let _pool: sql.ConnectionPool | null = null;
async function getPool(): Promise<sql.ConnectionPool> {
  if (!_pool) _pool = await new sql.ConnectionPool(dbConfig).connect();
  return _pool;
}

// ─── HELPER: Access serial date float conversion ──────────────
//
//  The TimeWatch DB stores time as "days since 1899-12-30"
//  (called an Access/OLE Automation serial date).
//  e.g. the value 45800.5 = some specific datetime in 2025.
//
//  To query "today", we convert today's midnight to this float format.
//  This is the EXACT same conversion as cronJobs.js lines 181–183.
//
//  How it works:
//    baseDate = Jan 1 1970 minus Dec 30 1899 in milliseconds
//    nowFloat = (target datetime in ms since 1970) / (ms per day)
//
function toAccessFloat(year: number, month: number, day: number,
                        hour = 0, min = 0, sec = 0): number {
  const BASE = Date.UTC(1899, 11, 30, 0, 0, 0); // Dec 30 1899 in ms
  return (Date.UTC(year, month, day, hour, min, sec) - BASE) / 86400000;
}

// ─── ACTIVITY 1: getDailyStats ────────────────────────────────
//
//  Runs 3 SQL queries (same logic as cronJobs.js sendDailySummary):
//    Query 1 → total entries and exits today
//    Query 2 → vehicles currently inside (open sessions, look back 30 days)
//    Query 3 → per-company entry breakdown today
//    Query 4 → peak hour (which hour had most entries)
//
//  Returns a DailyReportStats object used by the email activity.
//
export async function getDailyStats(): Promise<DailyReportStats> {
  const pool  = await getPool();
  const today = new Date();

  // Build today's date range as Access serial floats
  // startFloat = today at 00:00:00
  // endFloat   = tomorrow at 00:00:00 (i.e. everything BEFORE midnight tonight)
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const startFloat = toAccessFloat(y, m, d, 0, 0, 0);
  const endFloat   = toAccessFloat(y, m, d + 1, 0, 0, 0); // +1 day

  // ── QUERY 1: Total entries and exits today ─────────────────
  // This is IDENTICAL to cronJobs.js lines 186–192
  const q1 = pool.request();
  q1.input('startFloat', sql.Float, startFloat);
  q1.input('endFloat',   sql.Float, endFloat);
  const scansResult = await q1.query(`;
    SELECT
      SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) AS TotalEntries,
      SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) AS TotalExits
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @startFloat AND DataTime < @endFloat
  `);

  // Destructuring: pull TotalEntries and TotalExits out of the first row
  // If the row is empty (no records today), default both to 0
  const {
    TotalEntries = 0,
    TotalExits   = 0,
  } = scansResult.recordset[0] ?? {};

  // ── QUERY 2: Vehicles currently inside (open sessions) ────
  // This is the SAME buildSessionQuery from cronJobs.js lines 10–66
  // Look back 30 days for open sessions (vehicles that entered long ago
  // but never scanned exit)
  const activeStartFloat = startFloat - 30; // 30 days back
  const q2 = pool.request();
  q2.input('startFloat', sql.Float, activeStartFloat);
  const insideResult = await q2.query(`;
    WITH RawData AS (
      SELECT
        CardRecordID, CardData, PName, PCode, PersonnelID, EquptName,
        PortNum, DataTime,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
        CASE
          WHEN PortNum = 1 THEN 'Entry'
          WHEN PortNum = 2 THEN 'Exit'
          ELSE 'Unknown'
        END AS GateDir
      FROM CardRecord WITH (NOLOCK)
      WHERE DataTime >= @startFloat
    ),
    Deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY CardData, CAST(DataTime * 86400 / 30 AS BIGINT)
          ORDER BY CardRecordID DESC
        ) AS rn
      FROM RawData
    ),
    Clean AS (
      SELECT * FROM Deduped WHERE rn = 1 AND GateDir <> 'Unknown'
    ),
    WithNext AS (
      SELECT
        CardData, PName, PCode, PersonnelID, CardRecordID,
        ScanTime AS CurTime, EquptName AS CurGate, GateDir AS CurDir,
        LEAD(ScanTime) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
        LEAD(GateDir)  OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
      FROM Clean
    ),
    Sessions AS (
      SELECT
        CardRecordID, CardData, PName, PCode, PersonnelID,
        CurTime AS EntryTime, CurGate AS EntryGate,
        CASE WHEN NextDir = 'Exit' THEN NextTime ELSE NULL END AS ExitTime,
        CASE WHEN NextDir = 'Exit' THEN 'Exited' ELSE 'Still Inside' END AS Status
      FROM WithNext WHERE CurDir = 'Entry'
    ),
    LatestSessions AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY CardData ORDER BY EntryTime DESC) AS session_rn
      FROM Sessions
    )
    SELECT * FROM LatestSessions WHERE session_rn = 1 AND Status = 'Still Inside'
  `);

  // Build the insideVehicles array — each row = one vehicle still inside
  // map() = transform each DB row into an InsideVehicle object
  const insideVehicles: InsideVehicle[] = insideResult.recordset.map((row: any) => {
    const entryRaw   = new Date(row.EntryTime);
    const nowMs      = Date.now();
    const hoursInside = Math.floor((nowMs - entryRaw.getTime()) / (1000 * 60 * 60));
    const entryFmt   = entryRaw.toISOString().replace('T', ' ').slice(0, 16);
    return {
      cardId:     String(row.CardData   ?? ''),
      pName:      String(row.PName      ?? '-'),
      pCode:      String(row.PCode      ?? '-'),
      entryTime:  entryFmt,
      hoursInside,
    };
  });

  // ── QUERY 3: Per-company entries today ─────────────────────
  // This is NEW — not in cronJobs.js, but improves the report.
  // Groups entries by PCode to show which company had most traffic.
  // Only count authorized vehicles (PCode not empty).
  const q3 = pool.request();
  q3.input('startFloat', sql.Float, startFloat);
  q3.input('endFloat',   sql.Float, endFloat);
  const companyResult = await q3.query(`;
    SELECT
      ISNULL(PCode, 'UNKNOWN') AS CompanyCode,
      SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) AS EntryCount,
      SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) AS ExitCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @startFloat
      AND DataTime < @endFloat
      AND PCode IS NOT NULL
      AND PCode <> ''
      AND PCode <> '-'
    GROUP BY PCode
    ORDER BY EntryCount DESC
  `);

  const companyBreakdown: CompanyDailyStat[] = companyResult.recordset.map((r: any) => ({
    companyCode: String(r.CompanyCode),
    entryCount:  Number(r.EntryCount ?? 0),
    exitCount:   Number(r.ExitCount  ?? 0),
  }));

  // ── QUERY 4: Peak entry hour today ─────────────────────────
  // Finds which hour (0-23) had the most entry scans today.
  const q4 = pool.request();
  q4.input('startFloat', sql.Float, startFloat);
  q4.input('endFloat',   sql.Float, endFloat);
  const peakResult = await q4.query(`;
    SELECT TOP 1
      DATEPART(HOUR, DATEADD(SECOND, DataTime * 86400, '1899-12-30')) AS PeakHour,
      COUNT(*) AS PeakCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @startFloat
      AND DataTime < @endFloat
      AND PortNum = 1
    GROUP BY DATEPART(HOUR, DATEADD(SECOND, DataTime * 86400, '1899-12-30'))
    ORDER BY PeakCount DESC
  `);

  const peakRow = peakResult.recordset[0];

  // Build the final stats object and return it
  const reportDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return {
    reportDate,
    totalEntries:      Number(TotalEntries),
    totalExits:        Number(TotalExits),
    currentlyInside:   insideVehicles.length,
    companyBreakdown,
    peakHour:          peakRow ? Number(peakRow.PeakHour) : null,
    peakHourCount:     peakRow ? Number(peakRow.PeakCount) : 0,
    reportGeneratedAt: new Date().toISOString(),
    // Pass inside vehicles so email can show the table
    // We attach it here even though it's not in the interface
    // because the email activity needs it
    // TypeScript trick: cast to any first, then add the field
  } as DailyReportStats & { insideVehicles: InsideVehicle[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getDailyStats as any)._lastInsideVehicles = insideVehicles;
}

// ─── ACTIVITY 2: sendDailyReportEmail ────────────────────────
//
//  Builds and sends the daily summary email.
//  The HTML is an improved version of cronJobs.js lines 202–227.
//
//  'stats' parameter type = DailyReportStats
//  TypeScript knows EXACTLY what fields are inside stats,
//  so if you mistype 'stats.totalEntriez' it gives an error instantly.
//
export async function sendDailyReportEmail(
  stats:          DailyReportStats,
  insideVehicles: InsideVehicle[]
): Promise<void> {

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS ||
      process.env.EMAIL_PASS === 'YOUR_APP_PASSWORD_HERE') {
    console.warn('[WF4] Email not configured — skipping daily report email');
    return;
  }

  const to = process.env.ADMIN_EMAIL || '';
  if (!to) { console.warn('[WF4] ADMIN_EMAIL not set'); return; }

  // ── Format peak hour as readable string ───────────────────
  // e.g. peakHour = 9  → "09:00 - 10:00"
  //      peakHour = 14 → "14:00 - 15:00"
  // stats.peakHour can be null (no entries today), so we check first
  const peakHourStr = stats.peakHour !== null
    ? `${String(stats.peakHour).padStart(2, '0')}:00 – ${String(stats.peakHour + 1).padStart(2, '0')}:00`
    : 'No entries today';

  // ── Build the "currently inside" table rows ────────────────
  // If no one is inside, show a friendly message instead
  const insideTableRows = insideVehicles.length > 0
    ? insideVehicles.map(v => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">${v.cardId}</td>
          <td style="padding:8px;border:1px solid #ddd;">${v.pName}</td>
          <td style="padding:8px;border:1px solid #ddd;">${v.pCode}</td>
          <td style="padding:8px;border:1px solid #ddd;">${v.entryTime}</td>
          <td style="padding:8px;border:1px solid #ddd;color:${v.hoursInside > 8 ? '#dc2626' : '#374151'};font-weight:${v.hoursInside > 8 ? 'bold' : 'normal'};">
            ${v.hoursInside}h ${v.hoursInside > 8 ? '⚠️' : ''}
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">
         ✅ No vehicles currently inside the premises
       </td></tr>`;

  // ── Build the per-company breakdown rows ──────────────────
  const companyRows = stats.companyBreakdown.length > 0
    ? stats.companyBreakdown.slice(0, 10).map(c => `
        <tr>
          <td style="padding:7px;border:1px solid #ddd;">${c.companyCode}</td>
          <td style="padding:7px;border:1px solid #ddd;text-align:center;">${c.entryCount}</td>
          <td style="padding:7px;border:1px solid #ddd;text-align:center;">${c.exitCount}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#6b7280;">No company data today</td></tr>`;

  // ── Build the full HTML email ──────────────────────────────
  // Same style as cronJobs.js but with more data sections
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;color:#1e293b;">
      <h2 style="color:#0284c7;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">
        📊 Daily Vehicle Access Summary
      </h2>
      <p style="color:#64748b;">
        Report for: <b>${stats.reportDate}</b> &nbsp;|&nbsp;
        Generated: <b>${stats.reportGeneratedAt.replace('T', ' ').slice(0, 16)} UTC</b>
      </p>

      <!-- STAT CARDS (same as cronJobs.js but with peak hour added) -->
      <div style="display:flex;gap:16px;margin:20px 0;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
          <div style="font-size:13px;color:#166534;font-weight:600;">Total Entries</div>
          <div style="font-size:32px;font-weight:bold;color:#15803d;margin-top:4px;">${stats.totalEntries}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
          <div style="font-size:13px;color:#991b1b;font-weight:600;">Total Exits</div>
          <div style="font-size:32px;font-weight:bold;color:#b91c1c;margin-top:4px;">${stats.totalExits}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
          <div style="font-size:13px;color:#1e40af;font-weight:600;">Currently Inside</div>
          <div style="font-size:32px;font-weight:bold;color:#1d4ed8;margin-top:4px;">${stats.currentlyInside}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:16px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;">
          <div style="font-size:13px;color:#854d0e;font-weight:600;">Peak Hour</div>
          <div style="font-size:16px;font-weight:bold;color:#92400e;margin-top:4px;">${peakHourStr}</div>
          <div style="font-size:11px;color:#92400e;">${stats.peakHourCount} entries</div>
        </div>
      </div>

      <!-- VEHICLES CURRENTLY INSIDE TABLE -->
      <h3 style="color:#1e293b;margin-top:28px;">Vehicles Currently Inside (${stats.currentlyInside})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Card ID</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Name</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Company</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Entry Time</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Duration</th>
          </tr>
        </thead>
        <tbody>${insideTableRows}</tbody>
      </table>

      <!-- COMPANY BREAKDOWN TABLE -->
      <h3 style="color:#1e293b;margin-top:28px;">Company Breakdown (Top 10)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:7px;border:1px solid #ddd;text-align:left;">Company Code</th>
            <th style="padding:7px;border:1px solid #ddd;text-align:center;">Entries</th>
            <th style="padding:7px;border:1px solid #ddd;text-align:center;">Exits</th>
          </tr>
        </thead>
        <tbody>${companyRows}</tbody>
      </table>

      <p style="margin-top:28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;">
        This is an automated daily report from Cyber Towers Vehicle Access System.<br/>
        Powered by Temporal durable workflows — report will never be missed.
      </p>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const info = await transporter.sendMail({
    from:    `"Cyber Towers Access" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📊 Daily Vehicle Access Summary — ${stats.reportDate}`,
    html,
  });

  console.log(`[WF4] Daily report sent → ${to} (${info.messageId})`);
}

// ═══════════════════════════════════════════════════════════════
//  WF5 ACTIVITIES — Weekly Analytics Report
// ═══════════════════════════════════════════════════════════════
//
//  These two activities power the Monday morning weekly report.
//
//  getWeeklyStats()  → runs 8 SQL queries to gather 7-day analytics
//  sendWeeklyReportEmail() → builds HTML email and sends via nodemailer
//
// ═══════════════════════════════════════════════════════════════

// ─── ACTIVITY 3: getWeeklyStats ──────────────────────────────
//
//  Gathers analytics for the last 7 complete days (Mon–Sun).
//  Called every Monday morning by the Temporal Schedule.
//
//  Runs these 8 queries:
//    1. Total entries + exits for the week
//    2. Day-by-day breakdown (7 rows)
//    3. Per-company breakdown (top 10)
//    4. Peak hour of the week
//    5. Unauthorized attempt count
//    6. Top 5 most active people (by entry count)
//    7. Overnight sessions (vehicles that stayed > 12 hours)
//    8. Vehicles currently inside (open sessions, same CTE as getDailyStats)
//
export async function getWeeklyStats(): Promise<WeeklyReportStats> {
  const pool  = await getPool();
  const today = new Date();

  // Week = last 7 COMPLETE days ending yesterday midnight.
  // If today is Monday June 9, we cover June 2 (Mon) through June 8 (Sun).
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();

  // weekEndFloat   = today at 00:00 (= yesterday's end of day)
  // weekStartFloat = 7 days before that
  const weekEndFloat   = toAccessFloat(y, m, d, 0, 0, 0);
  const weekStartFloat = toAccessFloat(y, m, d - 7, 0, 0, 0);

  // Build ISO date strings for display in the email
  function toISODate(dt: Date): string {
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  const weekStartDate = new Date(today); weekStartDate.setDate(d - 7);
  const weekEndDate   = new Date(today); weekEndDate.setDate(d - 1);
  const weekStart = toISODate(weekStartDate);
  const weekEnd   = toISODate(weekEndDate);

  // ── QUERY 1: Total entries + exits for the week ──────────────
  const q1 = pool.request();
  q1.input('weekStart', sql.Float, weekStartFloat);
  q1.input('weekEnd',   sql.Float, weekEndFloat);
  const totalResult = await q1.query(`
    SELECT
      SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) AS TotalEntries,
      SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) AS TotalExits
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd
  `);
  const { TotalEntries = 0, TotalExits = 0 } = totalResult.recordset[0] ?? {};

  // ── QUERY 2: Day-by-day breakdown ───────────────────────────
  const q2 = pool.request();
  q2.input('weekStart', sql.Float, weekStartFloat);
  q2.input('weekEnd',   sql.Float, weekEndFloat);
  const dailyDbResult = await q2.query(`
    SELECT
      CAST(DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS DATE) AS ScanDate,
      SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) AS Entries,
      SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) AS Exits
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd
    GROUP BY CAST(DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS DATE)
    ORDER BY ScanDate
  `);

  // Build a Map: date-string → { entries, exits } for quick lookup
  const dayMap = new Map<string, { entries: number; exits: number }>();
  for (const row of dailyDbResult.recordset) {
    const rawDate = row.ScanDate instanceof Date
      ? toISODate(row.ScanDate)
      : String(row.ScanDate).slice(0, 10);
    dayMap.set(rawDate, {
      entries: Number(row.Entries ?? 0),
      exits:   Number(row.Exits   ?? 0),
    });
  }

  // Build 7 rows in order (Mon..Sun), filling 0 for days with no scans
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dailyBreakdown: DailyBreakdown[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(weekStartDate);
    dt.setDate(weekStartDate.getDate() + i);
    const ds  = toISODate(dt);
    const rec = dayMap.get(ds) ?? { entries: 0, exits: 0 };
    dailyBreakdown.push({ date: ds, dayName: DAY_NAMES[dt.getDay()], ...rec });
  }

  // Find busiest day
  let busiestDay: string | null = null;
  let busiestDayCount = 0;
  for (const day of dailyBreakdown) {
    if (day.entries > busiestDayCount) {
      busiestDayCount = day.entries;
      busiestDay      = day.dayName;
    }
  }

  // ── QUERY 3: Per-company breakdown (top 10) ──────────────────
  const q3 = pool.request();
  q3.input('weekStart', sql.Float, weekStartFloat);
  q3.input('weekEnd',   sql.Float, weekEndFloat);
  const companyResult = await q3.query(`
    SELECT TOP 10
      ISNULL(PCode, 'UNKNOWN') AS CompanyCode,
      SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) AS EntryCount,
      SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) AS ExitCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd
      AND PCode IS NOT NULL AND PCode <> '' AND PCode <> '-'
    GROUP BY PCode
    ORDER BY EntryCount DESC
  `);
  const companyBreakdown: CompanyWeeklyStat[] = companyResult.recordset.map((r: any) => ({
    companyCode: String(r.CompanyCode),
    entryCount:  Number(r.EntryCount ?? 0),
    exitCount:   Number(r.ExitCount  ?? 0),
  }));

  // ── QUERY 4: Peak hour of the week ──────────────────────────
  const q4 = pool.request();
  q4.input('weekStart', sql.Float, weekStartFloat);
  q4.input('weekEnd',   sql.Float, weekEndFloat);
  const peakResult = await q4.query(`
    SELECT TOP 1
      DATEPART(HOUR, DATEADD(SECOND, DataTime * 86400, '1899-12-30')) AS PeakHour,
      COUNT(*) AS PeakCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd AND PortNum = 1
    GROUP BY DATEPART(HOUR, DATEADD(SECOND, DataTime * 86400, '1899-12-30'))
    ORDER BY PeakCount DESC
  `);
  const peakRow = peakResult.recordset[0];

  // ── QUERY 5: Unauthorized attempts ──────────────────────────
  const q5 = pool.request();
  q5.input('weekStart', sql.Float, weekStartFloat);
  q5.input('weekEnd',   sql.Float, weekEndFloat);
  const unauthResult = await q5.query(`
    SELECT COUNT(*) AS UnauthorizedCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd
      AND PortNum = 1
      AND (PCode IS NULL OR PCode = '' OR PCode = '-')
  `);
  const unauthorizedCount = Number(unauthResult.recordset[0]?.UnauthorizedCount ?? 0);

  // ── QUERY 6: Top 5 most active cards ─────────────────────────
  // Only counts authorized vehicles (PCode present) entering this week.
  const q6 = pool.request();
  q6.input('weekStart', sql.Float, weekStartFloat);
  q6.input('weekEnd',   sql.Float, weekEndFloat);
  const topCardResult = await q6.query(`
    SELECT TOP 5
      CardData,
      ISNULL(MAX(PName), '') AS PName,
      ISNULL(MAX(PCode), '') AS PCode,
      COUNT(*) AS VisitCount
    FROM CardRecord WITH (NOLOCK)
    WHERE DataTime >= @weekStart AND DataTime < @weekEnd
      AND PortNum = 1
      AND CardData IS NOT NULL AND CardData <> ''
      AND PCode IS NOT NULL AND PCode <> '' AND PCode <> '-'
    GROUP BY CardData
    ORDER BY VisitCount DESC
  `);
  const topCards: TopCard[] = topCardResult.recordset.map((r: any) => ({
    cardId: String(r.CardData   ?? ''),
    pName:  String(r.PName      ?? '-'),
    pCode:  String(r.PCode      ?? '-'),
    visits: Number(r.VisitCount ?? 0),
  }));

  // ── QUERY 7: Overnight sessions (stayed > 12 hours) ──────────
  // Counts distinct cards that had a completed session longer than 12 hours.
  // Uses LEAD() to pair each entry scan with its next exit scan.
  const q7 = pool.request();
  q7.input('weekStart', sql.Float, weekStartFloat);
  q7.input('weekEnd',   sql.Float, weekEndFloat);
  const overnightResult = await q7.query(`
    WITH Sessions AS (
      SELECT
        CardData,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
        PortNum,
        LEAD(DATEADD(SECOND, DataTime * 86400, '1899-12-30'))
          OVER (PARTITION BY CardData ORDER BY DataTime) AS NextScanTime,
        LEAD(PortNum)
          OVER (PARTITION BY CardData ORDER BY DataTime) AS NextPortNum
      FROM CardRecord WITH (NOLOCK)
      WHERE DataTime >= @weekStart AND DataTime < @weekEnd
    )
    SELECT COUNT(DISTINCT CardData) AS OvernightCount
    FROM Sessions
    WHERE PortNum = 1
      AND NextPortNum = 2
      AND DATEDIFF(HOUR, ScanTime, NextScanTime) > 12
  `);
  const overnightCount = Number(overnightResult.recordset[0]?.OvernightCount ?? 0);

  // ── QUERY 8: Vehicles currently inside (same CTE as WF4) ─────
  // Look back up to 30 days before weekStart to catch vehicles that
  // entered before the week began and haven't exited yet.
  const insideLookback = weekStartFloat - 30;
  const q8 = pool.request();
  q8.input('startFloat', sql.Float, insideLookback);
  const insideResult = await q8.query(`
    WITH RawData AS (
      SELECT
        CardRecordID, CardData, PName, PCode, PersonnelID, EquptName,
        PortNum, DataTime,
        DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
        CASE WHEN PortNum = 1 THEN 'Entry'
             WHEN PortNum = 2 THEN 'Exit'
             ELSE 'Unknown' END AS GateDir
      FROM CardRecord WITH (NOLOCK)
      WHERE DataTime >= @startFloat
    ),
    Deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY CardData, CAST(DataTime * 86400 / 30 AS BIGINT)
          ORDER BY CardRecordID DESC
        ) AS rn
      FROM RawData
    ),
    Clean AS (
      SELECT * FROM Deduped WHERE rn = 1 AND GateDir <> 'Unknown'
    ),
    WithNext AS (
      SELECT
        CardData, PName, PCode, PersonnelID, CardRecordID,
        ScanTime AS CurTime, EquptName AS CurGate, GateDir AS CurDir,
        LEAD(ScanTime) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
        LEAD(GateDir)  OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
      FROM Clean
    ),
    Sessions AS (
      SELECT
        CardRecordID, CardData, PName, PCode, PersonnelID,
        CurTime AS EntryTime, CurGate AS EntryGate,
        CASE WHEN NextDir = 'Exit' THEN NextTime ELSE NULL END AS ExitTime,
        CASE WHEN NextDir = 'Exit' THEN 'Exited' ELSE 'Still Inside' END AS Status
      FROM WithNext WHERE CurDir = 'Entry'
    ),
    LatestSessions AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY CardData ORDER BY EntryTime DESC) AS session_rn
      FROM Sessions
    )
    SELECT * FROM LatestSessions WHERE session_rn = 1 AND Status = 'Still Inside'
  `);

  const insideVehicles: InsideVehicle[] = insideResult.recordset.map((row: any) => {
    const entryRaw    = new Date(row.EntryTime);
    const hoursInside = Math.floor((Date.now() - entryRaw.getTime()) / (1000 * 60 * 60));
    const entryFmt    = entryRaw.toISOString().replace('T', ' ').slice(0, 16);
    return {
      cardId:     String(row.CardData ?? ''),
      pName:      String(row.PName    ?? '-'),
      pCode:      String(row.PCode    ?? '-'),
      entryTime:  entryFmt,
      hoursInside,
    };
  });

  console.log(
    `[WF5] Weekly stats: ${Number(TotalEntries)} entries, ${Number(TotalExits)} exits | ` +
    `${insideVehicles.length} currently inside | ${unauthorizedCount} unauthorized | ` +
    `Week: ${weekStart} → ${weekEnd}`
  );

  return {
    weekStart,
    weekEnd,
    totalEntries:      Number(TotalEntries),
    totalExits:        Number(TotalExits),
    currentlyInside:   insideVehicles.length,
    dailyBreakdown,
    companyBreakdown,
    busiestDay:        busiestDayCount > 0 ? busiestDay : null,
    busiestDayCount,
    peakHour:          peakRow ? Number(peakRow.PeakHour) : null,
    peakHourCount:     peakRow ? Number(peakRow.PeakCount) : 0,
    unauthorizedCount,
    topCards,
    overnightCount,
    insideVehicles,
    reportGeneratedAt: new Date().toISOString(),
  };
}

// ─── ACTIVITY 4: sendWeeklyReportEmail ───────────────────────
//
//  Builds and sends the weekly analytics HTML email.
//  Skipped gracefully if EMAIL_USER/EMAIL_PASS are not configured.
//
export async function sendWeeklyReportEmail(stats: WeeklyReportStats): Promise<void> {

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS ||
      process.env.EMAIL_PASS === 'YOUR_APP_PASSWORD_HERE') {
    console.warn('[WF5] Email not configured — skipping weekly report email');
    return;
  }

  const to = process.env.ADMIN_EMAIL || '';
  if (!to) { console.warn('[WF5] ADMIN_EMAIL not set'); return; }

  // ── Helpers ───────────────────────────────────────────────────
  // Format "2026-06-02" → "2 Jun 2026"
  function fmtDate(iso: string): string {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [yy, mm, dd] = iso.split('-').map(Number);
    return `${dd} ${MONTHS[mm - 1]} ${yy}`;
  }

  // Format hour 0-23 as "09:00 – 10:00"
  const peakHourStr = stats.peakHour !== null
    ? `${String(stats.peakHour).padStart(2, '0')}:00 – ${String(stats.peakHour + 1).padStart(2, '0')}:00`
    : 'No data';

  // ── Day-by-day bar chart rows ─────────────────────────────────
  // Find max entries for scaling the bar widths (avoid divide-by-zero)
  const maxEntries = Math.max(...stats.dailyBreakdown.map(d => d.entries), 1);

  const dayRows = stats.dailyBreakdown.map(d => {
    const barPct   = Math.round((d.entries / maxEntries) * 100);
    const isBusiest = d.dayName === stats.busiestDay;
    return `
      <tr style="background:${isBusiest ? '#fffbeb' : 'transparent'};">
        <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:${isBusiest ? 'bold' : 'normal'};white-space:nowrap;">
          ${d.dayName}${isBusiest ? ' ⭐' : ''}
          <div style="font-size:10px;color:#94a3b8;">${fmtDate(d.date)}</div>
        </td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;font-weight:bold;color:#15803d;">${d.entries}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:#b91c1c;">${d.exits}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;min-width:160px;">
          <div style="background:#e2e8f0;border-radius:4px;height:10px;width:100%;overflow:hidden;">
            <div style="background:#0284c7;width:${barPct}%;height:10px;border-radius:4px;"></div>
          </div>
        </td>
      </tr>`;
  }).join('');

  // ── Company breakdown rows ────────────────────────────────────
  const companyRows = stats.companyBreakdown.length > 0
    ? stats.companyBreakdown.map((c, i) => `
        <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'transparent'};">
          <td style="padding:8px 12px;border:1px solid #e2e8f0;">${i + 1}.</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600;">${c.companyCode}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:#15803d;font-weight:bold;">${c.entryCount}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:#b91c1c;">${c.exitCount}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;color:${c.entryCount - c.exitCount > 0 ? '#0369a1' : '#6b7280'};">
            ${c.entryCount - c.exitCount > 0 ? `+${c.entryCount - c.exitCount} inside` : '—'}
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">No company data this week</td></tr>`;

  // ── Top 5 cards rows ─────────────────────────────────────────
  const topCardRows = stats.topCards.length > 0
    ? stats.topCards.map((c, i) => `
        <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'transparent'};">
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;">${i + 1}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600;">${c.pName || '—'}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;font-family:monospace;font-size:12px;color:#64748b;">${c.cardId}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;">${c.pCode}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center;">
            <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-weight:bold;font-size:13px;">
              ${c.visits}×
            </span>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">No visit data this week</td></tr>`;

  // ── Currently inside table ────────────────────────────────────
  const insideRows = stats.insideVehicles.length > 0
    ? stats.insideVehicles.slice(0, 15).map(v => `
        <tr>
          <td style="padding:7px 10px;border:1px solid #e2e8f0;">${v.pName}</td>
          <td style="padding:7px 10px;border:1px solid #e2e8f0;">${v.pCode}</td>
          <td style="padding:7px 10px;border:1px solid #e2e8f0;font-family:monospace;font-size:12px;color:#64748b;">${v.cardId}</td>
          <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;">${v.entryTime}</td>
          <td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:center;color:${v.hoursInside > 24 ? '#dc2626' : v.hoursInside > 8 ? '#d97706' : '#16a34a'};font-weight:bold;">
            ${v.hoursInside}h ${v.hoursInside > 24 ? '🔴' : v.hoursInside > 8 ? '⚠️' : ''}
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;">
         ✅ No vehicles currently inside the premises
       </td></tr>`;

  // ── Full HTML email ───────────────────────────────────────────
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:720px;color:#1e293b;margin:0 auto;">

      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#0c4a6e 0%,#0284c7 100%);padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">
          📊 Weekly Vehicle Access Analytics
        </h1>
        <p style="color:#bae6fd;margin:8px 0 0;font-size:14px;">
          ${fmtDate(stats.weekStart)} – ${fmtDate(stats.weekEnd)}
          &nbsp;·&nbsp;
          Generated ${stats.reportGeneratedAt.replace('T', ' ').slice(0, 16)} UTC
        </p>
      </div>

      <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">

        <!-- MAIN STAT CARDS -->
        <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">

          <div style="flex:1;min-width:130px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;text-align:center;">
            <div style="font-size:11px;color:#166534;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Total Entries</div>
            <div style="font-size:36px;font-weight:800;color:#15803d;margin:4px 0;">${stats.totalEntries}</div>
            <div style="font-size:11px;color:#4ade80;">this week</div>
          </div>

          <div style="flex:1;min-width:130px;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;text-align:center;">
            <div style="font-size:11px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Total Exits</div>
            <div style="font-size:36px;font-weight:800;color:#b91c1c;margin:4px 0;">${stats.totalExits}</div>
            <div style="font-size:11px;color:#f87171;">this week</div>
          </div>

          <div style="flex:1;min-width:130px;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center;">
            <div style="font-size:11px;color:#1e40af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Currently Inside</div>
            <div style="font-size:36px;font-weight:800;color:#1d4ed8;margin:4px 0;">${stats.currentlyInside}</div>
            <div style="font-size:11px;color:#60a5fa;">right now</div>
          </div>

          <div style="flex:1;min-width:130px;padding:16px;background:${stats.unauthorizedCount > 0 ? '#fef2f2' : '#f8fafc'};border:1px solid ${stats.unauthorizedCount > 0 ? '#fca5a5' : '#e2e8f0'};border-radius:10px;text-align:center;">
            <div style="font-size:11px;color:${stats.unauthorizedCount > 0 ? '#991b1b' : '#475569'};font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Unauthorized</div>
            <div style="font-size:36px;font-weight:800;color:${stats.unauthorizedCount > 0 ? '#dc2626' : '#94a3b8'};margin:4px 0;">${stats.unauthorizedCount}</div>
            <div style="font-size:11px;color:${stats.unauthorizedCount > 0 ? '#f87171' : '#cbd5e1'};">attempts</div>
          </div>

        </div>

        <!-- HIGHLIGHTS ROW -->
        <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap;">

          <div style="flex:1;min-width:160px;padding:14px 18px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;">
            <div style="font-size:11px;color:#854d0e;font-weight:600;margin-bottom:4px;">⭐ BUSIEST DAY</div>
            <div style="font-size:18px;font-weight:700;color:#78350f;">
              ${stats.busiestDay ?? 'No data'}
            </div>
            ${stats.busiestDayCount > 0 ? `<div style="font-size:12px;color:#92400e;">${stats.busiestDayCount} entries</div>` : ''}
          </div>

          <div style="flex:1;min-width:160px;padding:14px 18px;background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;">
            <div style="font-size:11px;color:#6b21a8;font-weight:600;margin-bottom:4px;">🕐 PEAK HOUR</div>
            <div style="font-size:18px;font-weight:700;color:#581c87;">${peakHourStr}</div>
            ${stats.peakHourCount > 0 ? `<div style="font-size:12px;color:#7c3aed;">${stats.peakHourCount} entries</div>` : ''}
          </div>

          <div style="flex:1;min-width:160px;padding:14px 18px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
            <div style="font-size:11px;color:#9a3412;font-weight:600;margin-bottom:4px;">🌙 OVERNIGHT STAYS</div>
            <div style="font-size:18px;font-weight:700;color:#7c2d12;">${stats.overnightCount}</div>
            <div style="font-size:12px;color:#c2410c;">vehicles stayed &gt;12h</div>
          </div>

        </div>

        <!-- DAY-BY-DAY BREAKDOWN -->
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;border-left:4px solid #0284c7;padding-left:10px;">
          Day-by-Day Breakdown
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Day</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Entries</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Exits</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Volume</th>
            </tr>
          </thead>
          <tbody>${dayRows}</tbody>
        </table>

        <!-- TOP COMPANIES -->
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;border-left:4px solid #7c3aed;padding-left:10px;">
          Top Companies This Week
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">#</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Company Code</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Entries</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Exits</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Still Inside</th>
            </tr>
          </thead>
          <tbody>${companyRows}</tbody>
        </table>

        <!-- MOST ACTIVE PEOPLE -->
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;border-left:4px solid #16a34a;padding-left:10px;">
          Most Active People This Week
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">#</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Name</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Card ID</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Company</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Visits</th>
            </tr>
          </thead>
          <tbody>${topCardRows}</tbody>
        </table>

        <!-- CURRENTLY INSIDE -->
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;border-left:4px solid #0369a1;padding-left:10px;">
          Vehicles Currently Inside (${stats.currentlyInside})
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Name</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Company</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Card ID</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:left;">Entry Time</th>
              <th style="padding:9px 12px;border:1px solid #e2e8f0;text-align:center;">Duration</th>
            </tr>
          </thead>
          <tbody>${insideRows}</tbody>
        </table>

        <!-- FOOTER -->
        <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:8px;">
          <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">
            This is an automated weekly analytics report from <b>Cyber Towers Vehicle Access System</b>.<br/>
            Powered by Temporal durable workflows — this report is never missed, even if the server was down.<br/>
            Week covered: ${fmtDate(stats.weekStart)} to ${fmtDate(stats.weekEnd)} (last 7 complete days).
          </p>
        </div>

      </div>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const info = await transporter.sendMail({
    from:    `"Cyber Towers Access" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📊 Weekly Access Analytics — ${fmtDate(stats.weekStart)} to ${fmtDate(stats.weekEnd)}`,
    html,
  });

  console.log(`[WF5] Weekly report sent → ${to} (${info.messageId})`);
}
