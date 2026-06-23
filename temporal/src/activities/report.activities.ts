// ═══════════════════════════════════════════════════════════════
//  REPORT ACTIVITIES — PostgreSQL (cybertowers_access)
//
//  WF4: getDailyStats()  + sendDailyReportEmail()
//  WF5: getWeeklyStats() + sendWeeklyReportEmail()
//
//  All queries hit cybertowers.scan_events and cybertowers.cards
//  in PostgreSQL — SQL Server / TimeWatch is not used.
// ═══════════════════════════════════════════════════════════════

import { Pool }        from 'pg';
import * as path       from 'path';
import * as dotenv     from 'dotenv';
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

// ─── PG POOL ──────────────────────────────────────────────────
const _pool = new Pool({
  host:     process.env.PG_HOST     || '127.0.0.1',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'cybertowers_access',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max: 5,
  idleTimeoutMillis: 30000,
});

// ─── NODEMAILER TRANSPORT ─────────────────────────────────────
function makeTransport() {
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

// ─── HELPERS ──────────────────────────────────────────────────
function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function daysAgoIST(n: number): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - n * 86400000);
  return ist.toISOString().slice(0, 10);
}
function dayName(dateStr: string): string {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][
    new Date(dateStr + 'T00:00:00Z').getUTCDay()
  ];
}

// ═══════════════════════════════════════════════════════════════
//  WF4 ACTIVITIES
// ═══════════════════════════════════════════════════════════════

export async function getDailyStats(): Promise<{
  stats: DailyReportStats;
  vehicles: InsideVehicle[];
}> {
  const today    = todayIST();
  const dayStart = `${today}T00:00:00`;
  const dayEnd   = `${today}T23:59:59`;

  const totalsRes = await _pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE direction = 'IN' AND access_result = 'Approved') AS total_entries,
       COUNT(*) FILTER (WHERE direction = 'OUT')                               AS total_exits
     FROM cybertowers.scan_events
     WHERE event_date >= $1 AND event_date <= $2`,
    [dayStart, dayEnd]
  );
  const tRow         = totalsRes.rows[0] ?? {};
  const totalEntries = parseInt(tRow.total_entries ?? '0');
  const totalExits   = parseInt(tRow.total_exits   ?? '0');
  const currentlyInside = Math.max(0, totalEntries - totalExits);

  const companyRes = await _pool.query(
    `SELECT
       COALESCE(s.company_code, 'Unknown') AS company_code,
       COUNT(*) FILTER (WHERE s.direction = 'IN')  AS entry_count,
       COUNT(*) FILTER (WHERE s.direction = 'OUT') AS exit_count
     FROM cybertowers.scan_events s
     WHERE s.event_date >= $1 AND s.event_date <= $2
     GROUP BY 1 ORDER BY entry_count DESC LIMIT 20`,
    [dayStart, dayEnd]
  );
  const companyBreakdown: CompanyDailyStat[] = companyRes.rows.map(r => ({
    companyCode: r.company_code,
    entryCount:  parseInt(r.entry_count),
    exitCount:   parseInt(r.exit_count),
  }));

  const peakRes = await _pool.query(
    `SELECT EXTRACT(HOUR FROM event_date AT TIME ZONE 'UTC') AS hr, COUNT(*) AS cnt
     FROM cybertowers.scan_events
     WHERE event_date >= $1 AND event_date <= $2
     GROUP BY hr ORDER BY cnt DESC LIMIT 1`,
    [dayStart, dayEnd]
  );
  const peakHour      = peakRes.rows.length ? parseInt(peakRes.rows[0].hr)  : null;
  const peakHourCount = peakRes.rows.length ? parseInt(peakRes.rows[0].cnt) : 0;

  const insideRes = await _pool.query(
    `SELECT
       s.card_no,
       COALESCE(c.person_name, s.card_no) AS p_name,
       COALESCE(c.company_code, '')        AS p_code,
       s.event_date
     FROM cybertowers.scan_events s
     LEFT JOIN cybertowers.cards c ON c.card_no = s.card_no
     WHERE s.event_date >= $1 AND s.event_date <= $2
       AND s.direction = 'IN' AND s.access_result = 'Approved'
     ORDER BY s.event_date DESC LIMIT 50`,
    [dayStart, dayEnd]
  );
  const vehicles: InsideVehicle[] = insideRes.rows.map(r => {
    const hoursInside = parseFloat(
      ((Date.now() - new Date(r.event_date).getTime()) / 3600000).toFixed(1)
    );
    return {
      cardId:    r.card_no,
      pName:     r.p_name,
      pCode:     r.p_code,
      entryTime: r.event_date instanceof Date ? r.event_date.toISOString() : String(r.event_date),
      hoursInside,
    };
  });

  const stats: DailyReportStats = {
    reportDate:        today,
    totalEntries,
    totalExits,
    currentlyInside,
    companyBreakdown,
    peakHour,
    peakHourCount,
    reportGeneratedAt: new Date().toISOString(),
  };

  return { stats, vehicles };
}

export async function sendDailyReportEmail(
  stats:    DailyReportStats,
  vehicles: InsideVehicle[]
): Promise<void> {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS ||
      process.env.EMAIL_PASS === 'YOUR_APP_PASSWORD_HERE') {
    console.warn('[WF4] Email not configured — skipping. Set EMAIL_USER and EMAIL_PASS in .env');
    return;
  }
  const to = process.env.ADMIN_EMAIL || '';
  if (!to) { console.warn('[WF4] ADMIN_EMAIL not set — skipping'); return; }

  const companyRows = (stats.companyBreakdown || []).map((c: CompanyDailyStat) =>
    `<tr>
       <td style="padding:6px 10px;border:1px solid #ddd">${c.companyCode}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${c.entryCount}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${c.exitCount}</td>
     </tr>`
  ).join('');

  const vehicleRows = vehicles.slice(0, 20).map((v: InsideVehicle) =>
    `<tr>
       <td style="padding:6px 10px;border:1px solid #ddd">${v.pName}</td>
       <td style="padding:6px 10px;border:1px solid #ddd">${v.pCode}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${v.hoursInside}h</td>
     </tr>`
  ).join('');

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
    <div style="background:#1E3A5F;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">CyberTowers Daily Access Report</h2>
      <p style="margin:4px 0 0;opacity:0.8">${stats.reportDate}</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 24px">
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${[
          ['Total Entries',    stats.totalEntries,    '#27ae60'],
          ['Total Exits',      stats.totalExits,      '#2980b9'],
          ['Currently Inside', stats.currentlyInside, '#e67e22'],
          [`Peak ${stats.peakHour != null ? stats.peakHour+':00' : '-'}`, stats.peakHourCount + ' scans', '#8e44ad'],
        ].map(([label, val, color]) =>
          `<div style="background:#fff;border-radius:8px;padding:16px 20px;border-top:4px solid ${color};min-width:130px;flex:1">
            <div style="font-size:13px;color:#666">${label}</div>
            <div style="font-size:28px;font-weight:bold;color:${color}">${val}</div>
          </div>`
        ).join('')}
      </div>
      ${companyRows ? `
      <h3 style="margin-top:24px;color:#1E3A5F">By Company</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1E3A5F;color:#fff">
          <th style="padding:8px 10px;text-align:left">Company</th>
          <th style="padding:8px 10px">Entries</th>
          <th style="padding:8px 10px">Exits</th>
        </tr></thead>
        <tbody>${companyRows}</tbody>
      </table>` : ''}
      ${vehicleRows ? `
      <h3 style="margin-top:24px;color:#1E3A5F">Vehicles Entered Today (Top 20)</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1E3A5F;color:#fff">
          <th style="padding:8px 10px;text-align:left">Name</th>
          <th style="padding:8px 10px;text-align:left">Company</th>
          <th style="padding:8px 10px">Hours Inside</th>
        </tr></thead>
        <tbody>${vehicleRows}</tbody>
      </table>` : ''}
    </div>
    <div style="background:#1E3A5F;color:rgba(255,255,255,0.6);padding:12px 24px;font-size:11px;border-radius:0 0 8px 8px;text-align:center">
      Generated at ${stats.reportGeneratedAt} | CyberTowers Vehicle Access System
    </div>
  </div>`;

  const transporter = makeTransport();
  const info = await transporter.sendMail({
    from:    `"Cyber Towers Access" <${process.env.EMAIL_USER}>`,
    to,
    subject: `[CyberTowers] Daily Access Report — ${stats.reportDate}`,
    html,
  });
  console.log(`[WF4] Email sent to ${to}: ${info.messageId}`);
}

// ═══════════════════════════════════════════════════════════════
//  WF5 ACTIVITIES
// ═══════════════════════════════════════════════════════════════

export async function getWeeklyStats(): Promise<WeeklyReportStats> {
  const weekEnd   = todayIST();
  const weekStart = daysAgoIST(6);
  const startTs   = `${weekStart}T00:00:00`;
  const endTs     = `${weekEnd}T23:59:59`;

  const totalsRes = await _pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE direction = 'IN' AND access_result = 'Approved') AS total_entries,
       COUNT(*) FILTER (WHERE direction = 'OUT')                               AS total_exits,
       COUNT(*) FILTER (WHERE access_result = 'Denied')                        AS unauthorized_count
     FROM cybertowers.scan_events
     WHERE event_date >= $1 AND event_date <= $2`,
    [startTs, endTs]
  );
  const tRow              = totalsRes.rows[0] ?? {};
  const totalEntries      = parseInt(tRow.total_entries      ?? '0');
  const totalExits        = parseInt(tRow.total_exits        ?? '0');
  const unauthorizedCount = parseInt(tRow.unauthorized_count ?? '0');
  const currentlyInside   = Math.max(0, totalEntries - totalExits);

  const dayRes = await _pool.query(
    `SELECT
       DATE(event_date AT TIME ZONE 'UTC')                                 AS day,
       COUNT(*) FILTER (WHERE direction = 'IN')  AS entries,
       COUNT(*) FILTER (WHERE direction = 'OUT') AS exits
     FROM cybertowers.scan_events
     WHERE event_date >= $1 AND event_date <= $2
     GROUP BY day ORDER BY day`,
    [startTs, endTs]
  );
  const dailyBreakdown: DailyBreakdown[] = dayRes.rows.map(r => {
    const d = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day);
    return { date: d, dayName: dayName(d), entries: parseInt(r.entries), exits: parseInt(r.exits) };
  });

  const busiest       = dailyBreakdown.reduce(
    (best, d) => d.entries > best.entries ? d : best,
    { date: weekStart, dayName: dayName(weekStart), entries: 0, exits: 0 }
  );
  const busiestDay      = busiest.dayName;
  const busiestDayCount = busiest.entries;

  const peakHourRes = await _pool.query(
    `SELECT EXTRACT(HOUR FROM event_date AT TIME ZONE 'UTC') AS hr, COUNT(*) AS cnt
     FROM cybertowers.scan_events
     WHERE event_date >= $1 AND event_date <= $2
     GROUP BY hr ORDER BY cnt DESC LIMIT 1`,
    [startTs, endTs]
  );
  const peakHour      = peakHourRes.rows.length ? parseInt(peakHourRes.rows[0].hr)  : null;
  const peakHourCount = peakHourRes.rows.length ? parseInt(peakHourRes.rows[0].cnt) : 0;

  const companyRes = await _pool.query(
    `SELECT
       COALESCE(s.company_code, 'Unknown') AS company_code,
       COUNT(*) FILTER (WHERE s.direction = 'IN')  AS entry_count,
       COUNT(*) FILTER (WHERE s.direction = 'OUT') AS exit_count
     FROM cybertowers.scan_events s
     WHERE s.event_date >= $1 AND s.event_date <= $2
     GROUP BY 1 ORDER BY entry_count DESC LIMIT 20`,
    [startTs, endTs]
  );
  const companyBreakdown: CompanyWeeklyStat[] = companyRes.rows.map(r => ({
    companyCode: r.company_code,
    entryCount:  parseInt(r.entry_count),
    exitCount:   parseInt(r.exit_count),
  }));

  const topCardsRes = await _pool.query(
    `SELECT
       s.card_no,
       COALESCE(c.person_name, s.card_no) AS p_name,
       COALESCE(c.company_code, '')        AS p_code,
       COUNT(*) AS scan_count
     FROM cybertowers.scan_events s
     LEFT JOIN cybertowers.cards c ON c.card_no = s.card_no
     WHERE s.event_date >= $1 AND s.event_date <= $2
       AND s.direction = 'IN'
     GROUP BY s.card_no, p_name, p_code
     ORDER BY scan_count DESC LIMIT 5`,
    [startTs, endTs]
  );
  const topCards: TopCard[] = topCardsRes.rows.map(r => ({
    cardId: r.card_no,
    pName:  r.p_name,
    pCode:  r.p_code,
    visits: parseInt(r.scan_count),
  }));

  const insideRes = await _pool.query(
    `SELECT s.card_no,
       COALESCE(c.person_name, s.card_no) AS p_name,
       COALESCE(c.company_code, '')        AS p_code,
       s.event_date
     FROM cybertowers.scan_events s
     LEFT JOIN cybertowers.cards c ON c.card_no = s.card_no
     WHERE s.event_date >= $1 AND s.event_date <= $2
       AND s.direction = 'IN' AND s.access_result = 'Approved'
     ORDER BY s.event_date DESC LIMIT 50`,
    [startTs, endTs]
  );
  const insideVehicles: InsideVehicle[] = insideRes.rows.map(r => {
    const hoursInside = parseFloat(
      ((Date.now() - new Date(r.event_date).getTime()) / 3600000).toFixed(1)
    );
    return {
      cardId:    r.card_no,
      pName:     r.p_name,
      pCode:     r.p_code,
      entryTime: r.event_date instanceof Date ? r.event_date.toISOString() : String(r.event_date),
      hoursInside,
    };
  });

  return {
    weekStart,
    weekEnd,
    totalEntries,
    totalExits,
    currentlyInside,
    dailyBreakdown,
    companyBreakdown,
    busiestDay,
    busiestDayCount,
    peakHour,
    peakHourCount,
    unauthorizedCount,
    topCards,
    overnightCount:    0,
    insideVehicles,
    reportGeneratedAt: new Date().toISOString(),
  };
}

export async function sendWeeklyReportEmail(
  stats: WeeklyReportStats
): Promise<void> {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS ||
      process.env.EMAIL_PASS === 'YOUR_APP_PASSWORD_HERE') {
    console.warn('[WF5] Email not configured — skipping. Set EMAIL_USER and EMAIL_PASS in .env');
    return;
  }
  const to = process.env.ADMIN_EMAIL || '';
  if (!to) { console.warn('[WF5] ADMIN_EMAIL not set — skipping'); return; }

  const dailyRows = (stats.dailyBreakdown || []).map((d: DailyBreakdown) =>
    `<tr>
       <td style="padding:6px 10px;border:1px solid #ddd">${d.dayName}</td>
       <td style="padding:6px 10px;border:1px solid #ddd">${d.date}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${d.entries}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${d.exits}</td>
     </tr>`
  ).join('');

  const companyRows = (stats.companyBreakdown || []).map((c: CompanyWeeklyStat) =>
    `<tr>
       <td style="padding:6px 10px;border:1px solid #ddd">${c.companyCode}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${c.entryCount}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${c.exitCount}</td>
     </tr>`
  ).join('');

  const topCardRows = (stats.topCards || []).map((t: TopCard) =>
    `<tr>
       <td style="padding:6px 10px;border:1px solid #ddd">${t.pName}</td>
       <td style="padding:6px 10px;border:1px solid #ddd">${t.pCode}</td>
       <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${t.visits}</td>
     </tr>`
  ).join('');

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:750px;margin:0 auto">
    <div style="background:#1E3A5F;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">CyberTowers Weekly Access Report</h2>
      <p style="margin:4px 0 0;opacity:0.8">${stats.weekStart} to ${stats.weekEnd}</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 24px">
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
        ${[
          ['Week Entries',   stats.totalEntries,      '#27ae60'],
          ['Week Exits',     stats.totalExits,         '#2980b9'],
          ['Inside Now',     stats.currentlyInside,    '#e67e22'],
          ['Unauthorized',   stats.unauthorizedCount,  '#e74c3c'],
          ['Busiest Day',    stats.busiestDay ?? '-',  '#16a085'],
          ['Peak Hour',      stats.peakHour != null ? stats.peakHour+':00' : '-', '#8e44ad'],
        ].map(([label, val, color]) =>
          `<div style="background:#fff;border-radius:8px;padding:14px 18px;border-top:4px solid ${color};min-width:120px;flex:1">
            <div style="font-size:12px;color:#666">${label}</div>
            <div style="font-size:22px;font-weight:bold;color:${color}">${val}</div>
          </div>`
        ).join('')}
      </div>
      ${dailyRows ? `
      <h3 style="color:#1E3A5F">Daily Breakdown</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1E3A5F;color:#fff">
          <th style="padding:8px 10px;text-align:left">Day</th>
          <th style="padding:8px 10px;text-align:left">Date</th>
          <th style="padding:8px 10px">Entries</th>
          <th style="padding:8px 10px">Exits</th>
        </tr></thead>
        <tbody>${dailyRows}</tbody>
      </table>` : ''}
      ${companyRows ? `
      <h3 style="margin-top:24px;color:#1E3A5F">Company Summary</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1E3A5F;color:#fff">
          <th style="padding:8px 10px;text-align:left">Company</th>
          <th style="padding:8px 10px">Entries</th>
          <th style="padding:8px 10px">Exits</th>
        </tr></thead>
        <tbody>${companyRows}</tbody>
      </table>` : ''}
      ${topCardRows ? `
      <h3 style="margin-top:24px;color:#1E3A5F">Top 5 Cards This Week</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1E3A5F;color:#fff">
          <th style="padding:8px 10px;text-align:left">Name</th>
          <th style="padding:8px 10px;text-align:left">Company</th>
          <th style="padding:8px 10px">Visits</th>
        </tr></thead>
        <tbody>${topCardRows}</tbody>
      </table>` : ''}
    </div>
    <div style="background:#1E3A5F;color:rgba(255,255,255,0.6);padding:12px 24px;font-size:11px;border-radius:0 0 8px 8px;text-align:center">
      Generated at ${stats.reportGeneratedAt} | CyberTowers Vehicle Access System
    </div>
  </div>`;

  const transporter = makeTransport();
  const info = await transporter.sendMail({
    from:    `"Cyber Towers Access" <${process.env.EMAIL_USER}>`,
    to,
    subject: `[CyberTowers] Weekly Access Report — ${stats.weekStart} to ${stats.weekEnd}`,
    html,
  });
  console.log(`[WF5] Email sent to ${to}: ${info.messageId}`);
}
