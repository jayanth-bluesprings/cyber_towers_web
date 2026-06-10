// ═══════════════════════════════════════════════════════════════
//  WF5 — WEEKLY ANALYTICS REPORT WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  WHAT IT DOES:
//
//  Fires every Monday at 07:00 AM IST via a Temporal Schedule.
//  Covers the previous 7 complete days (Mon–Sun of the last week).
//
//  Steps:
//    1. getWeeklyStats()      → 8 SQL queries (7-day analytics)
//    2. sendWeeklyReportEmail() → rich HTML email to ADMIN_EMAIL
//    3. writeAuditLog()       → record WEEKLY_REPORT_SENT in DB
//
//  WHY USE TEMPORAL INSTEAD OF node-cron?
//
//    node-cron runs inside your Node.js process.
//    If the server is DOWN on Monday morning, the weekly report
//    is MISSED FOREVER — node-cron has no memory.
//
//    Temporal Schedule lives on the Temporal Server (separate process).
//    If your worker is down Monday morning, Temporal remembers.
//    When the worker restarts, it immediately runs the missed WF5.
//    The weekly report can NEVER be permanently lost.
//
//  STRUCTURE:
//    Same as WF4 (simple fire-and-complete, no signals, no waiting).
//    Start → activities → end. Completes in ~15 seconds.
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

import type * as reportAct from '../activities/report.activities';
import type * as dbAct     from '../activities/db.activities';
import type { WeeklyReportStats } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
//
//  getWeeklyStats runs 8 SQL queries — give it 10 minutes to complete.
//  sendWeeklyReportEmail sends a large HTML email — 2 minutes is enough.
//  writeAuditLog is a simple INSERT — 30 seconds.
//
//  retry settings:
//    maximumAttempts: 3  → try up to 3 times on failure
//    initialInterval: '15 seconds' → wait 15s before first retry
//    backoffCoefficient: 2 → then 30s, then 60s
//    maximumInterval: '3 minutes' → never wait longer than 3 min
//
const report = wf.proxyActivities<typeof reportAct>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts:    3,
    initialInterval:    '15 seconds',
    backoffCoefficient: 2,
    maximumInterval:    '3 minutes',
  },
});

const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
//
//  wf5WeeklyReport() takes NO input.
//  The getWeeklyStats() activity uses new Date() internally to
//  determine "the last 7 complete days" at the time it runs.
//  Activities CAN use Date.now() — only WORKFLOWS cannot.
//
export async function wf5WeeklyReport(): Promise<void> {

  // ── STEP 1: Gather all 7-day analytics from the database ──────
  //
  //  Runs 8 SQL queries:
  //    - Total entries/exits
  //    - Day-by-day breakdown (7 rows)
  //    - Per-company totals (top 10)
  //    - Peak hour of the week
  //    - Unauthorized attempt count
  //    - Top 5 most active people
  //    - Overnight sessions (stayed > 12 hours)
  //    - Vehicles currently inside right now
  //
  const stats: WeeklyReportStats = await report.getWeeklyStats();

  console.log(
    `[WF5] Weekly report ${stats.weekStart} → ${stats.weekEnd}: ` +
    `${stats.totalEntries} entries, ${stats.totalExits} exits, ` +
    `${stats.currentlyInside} inside, ${stats.unauthorizedCount} unauthorized`
  );

  // ── STEP 2: Send the weekly analytics email ───────────────────
  //
  //  Builds and sends a rich HTML email with:
  //    • Stat cards (entries, exits, inside, unauthorized)
  //    • Highlight tiles (busiest day, peak hour, overnight count)
  //    • Day-by-day bar chart table
  //    • Top companies table
  //    • Top 5 most active people table
  //    • Vehicles currently inside table
  //
  //  Skipped gracefully if EMAIL_USER / EMAIL_PASS are not configured.
  //
  await report.sendWeeklyReportEmail(stats);

  // ── STEP 3: Write audit log ───────────────────────────────────
  //
  //  Records that WF5 ran. Useful for proving compliance / auditing.
  //  'WEEKLY_REPORT_SENT' is stored in TemporalAuditLog table.
  //
  await db.writeAuditLog({
    eventType:     'WEEKLY_REPORT_SENT',
    cardId:        'SYSTEM',
    vehicleNumber: 'SYSTEM',
    gate:          'SYSTEM',
    timestamp:     stats.reportGeneratedAt,
    notes:
      `Week ${stats.weekStart} → ${stats.weekEnd}: ` +
      `${stats.totalEntries} entries, ${stats.totalExits} exits, ` +
      `${stats.currentlyInside} inside, ${stats.unauthorizedCount} unauthorized. ` +
      `Busiest: ${stats.busiestDay ?? 'N/A'} (${stats.busiestDayCount}). ` +
      `Peak hour: ${stats.peakHour ?? 'N/A'}:00 (${stats.peakHourCount} entries).`,
  });

  // WF5 ends here — Temporal marks it COMPLETED
  // The Schedule will fire WF5 again next Monday at 07:00 AM IST automatically
}
