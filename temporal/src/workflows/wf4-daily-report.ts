// ═══════════════════════════════════════════════════════════════
//  WF4 — DAILY SUMMARY REPORT WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  WHAT PROBLEM DOES THIS SOLVE?
//
//  Old code in cronJobs.js:
//    cron.schedule('59 23 * * *', () => sendDailySummary());
//
//  THE BUG:
//    node-cron runs IN the Node.js process.
//    If your server is DOWN at 11:59 PM (crash, deploy, reboot):
//      → the cron job NEVER runs
//      → the daily report is MISSED forever
//      → nobody knows a report was skipped
//
//  HOW TEMPORAL FIXES IT:
//    Temporal runs a SCHEDULE on its own server (separate from your app).
//    Even if YOUR server is down at 11:59 PM, the Temporal Server
//    remembers "WF4 should have run at 11:59 PM yesterday."
//    When your worker restarts, Temporal immediately catches up and
//    runs WF4 for the missed day.
//
// ═══════════════════════════════════════════════════════════════
//
//  WF4 IS THE SIMPLEST WORKFLOW TYPE — no signals, no waiting.
//
//  Compare to WF1 (complex):
//    WF1: start → call activities → sleep for exit → wake up → activities → end
//    WF1 runs for HOURS or DAYS.
//
//  WF4 (simple):
//    WF4: start → call activities → end
//    WF4 runs for just a few SECONDS.
//
//  This shows that Temporal handles both types perfectly.
//  The Schedule (external trigger) fires WF4 once per day.
//  WF4 runs, sends the email, and completes.
//
// ═══════════════════════════════════════════════════════════════
//
//  NEW TYPESCRIPT CONCEPT — Type casting with 'as':
//
//    (stats as any).insideVehicles
//
//    TypeScript doesn't know that we attached insideVehicles to stats
//    (we did this in getDailyStats activity as a trick to return two values).
//    The 'as any' tells TypeScript: "trust me, this field exists at runtime."
//    Use this sparingly — it bypasses type safety.
//
//  BETTER APPROACH: Return both stats AND insideVehicles from the activity.
//  We do this by returning a combined object type:
//    DailyReportStats & { insideVehicles: InsideVehicle[] }
//    The & means "both types combined into one"
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

// import type = only TypeScript shapes (safe in workflow files)
import type * as reportAct from '../activities/report.activities';
import type * as dbAct     from '../activities/db.activities';
import type { InsideVehicle, DailyReportStats } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
//
//  Report activities can take longer (big DB queries + email).
//  startToCloseTimeout is set higher: 5 minutes for DB, 2 min for email.
//  retry.maximumAttempts: 3 — if DB or email fails, try 3 times before giving up.
//
const report = wf.proxyActivities<typeof reportAct>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts:        3,
    initialInterval:        '10 seconds',  // wait 10s before first retry
    backoffCoefficient:     2,             // wait 20s, then 40s (doubles each time)
    maximumInterval:        '2 minutes',   // never wait more than 2 min between retries
  },
});

const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
//
//  WF4 takes NO input — the activities determine "today" themselves.
//
//  WHY NO INPUT?
//    When a Temporal Schedule fires WF4, it doesn't need to pass a date
//    because getDailyStats() uses new Date() to get today's date.
//    Activities are allowed to use Date.now() — only WORKFLOWS cannot.
//
export async function wf4DailyReport(): Promise<void> {

  // ── STEP 1: Fetch all daily statistics from the database ──
  //
  //  getDailyStats() runs 4 SQL queries:
  //    • Count entries + exits today
  //    • Find open sessions (vehicles still inside)
  //    • Per-company breakdown
  //    • Peak entry hour
  //
  //  The return type is:
  //    DailyReportStats & { insideVehicles: InsideVehicle[] }
  //    The & is TypeScript for "this type AND that type combined"
  //    So it has ALL fields of DailyReportStats PLUS insideVehicles.
  //
  const { stats, vehicles: insideVehicles } = await report.getDailyStats();

  // Log what we found — visible in Temporal Web UI and worker console
  console.log(
    `[WF4] Daily report for ${stats.reportDate}: ` +
    `${stats.totalEntries} entries, ${stats.totalExits} exits, ` +
    `${stats.currentlyInside} currently inside`
  );

  // ── STEP 2: Send the daily summary email ──────────────────
  //
  //  sendDailyReportEmail builds the HTML and sends via nodemailer.
  //  Same email as cronJobs.js sendDailySummary() but enhanced with
  //  company breakdown and peak hour sections.
  //
  await report.sendDailyReportEmail(stats, insideVehicles ?? []);

  // ── STEP 3: Write audit log ───────────────────────────────
  //
  //  Record that the daily report was sent.
  //  This is useful for proving the report ran (for compliance etc.)
  //
  await db.writeAuditLog({
    eventType:     'DAILY_REPORT_SENT',
    cardId:        'SYSTEM',
    vehicleNumber: 'SYSTEM',
    gate:          'SYSTEM',
    timestamp:     stats.reportGeneratedAt,
    notes:
      `Daily report for ${stats.reportDate}: ` +
      `${stats.totalEntries} entries, ${stats.totalExits} exits, ` +
      `${stats.currentlyInside} currently inside. ` +
      `Peak hour: ${stats.peakHour ?? 'N/A'} (${stats.peakHourCount} entries).`,
  });

  // WF4 ends here — Temporal marks it COMPLETED
  // The Schedule will fire WF4 again tomorrow at 11:59 PM automatically
}
