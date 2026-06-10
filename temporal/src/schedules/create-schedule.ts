// ═══════════════════════════════════════════════════════════════
//  CREATE SCHEDULE — Run this ONCE to register WF4's daily schedule
// ═══════════════════════════════════════════════════════════════
//
//  WHAT IS A TEMPORAL SCHEDULE?
//
//  A Schedule = Temporal's version of a cron job.
//  BUT unlike node-cron, it runs on the TEMPORAL SERVER — not inside
//  your Node.js process. So:
//
//    node-cron:       Lives in your server → server down = missed job
//    Temporal Schedule: Lives in Temporal Server → your server down?
//                       Temporal waits. When you restart, it catches up.
//
//  HOW TO USE THIS FILE:
//
//    Run it ONCE from the terminal:
//      cd temporal
//      npm run create-schedule
//
//    This creates the schedule in Temporal Server.
//    You NEVER need to run it again (unless you delete the schedule).
//    The schedule keeps firing every day at 11:59 PM even if this
//    file is never touched again.
//
//  HOW TO CHECK/MANAGE THE SCHEDULE:
//    In Temporal Web UI (http://localhost:8233):
//      → Schedules → "cyber-towers-daily-report"
//    You can pause, trigger manually, or delete it from there.
//
// ═══════════════════════════════════════════════════════════════
//
//  NEW TYPESCRIPT CONCEPT — try / catch:
//
//    try {
//      // code that might fail
//    } catch (err) {
//      // what to do if it fails
//      // 'err' is the error object
//    }
//
//    We use this to handle the case where the schedule already exists.
//    If you run this file twice, Temporal throws an error saying
//    "schedule already exists". The catch block handles it gracefully.
//
// ═══════════════════════════════════════════════════════════════

import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// The unique ID for this schedule — used to find/edit/delete it later
const SCHEDULE_ID = 'cyber-towers-daily-report';

// The task queue must match what the worker listens on
const TASK_QUEUE  = 'cyber-towers-task-queue';

async function createDailyReportSchedule(): Promise<void> {
  console.log('🔌 Connecting to Temporal Server...');

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const client = new Client({ connection, namespace: 'default' });

  console.log(`📅 Creating schedule: "${SCHEDULE_ID}"...`);

  try {
    await client.schedule.create({

      // ── SCHEDULE IDENTITY ────────────────────────────────
      // Unique ID — like a name for this schedule.
      // If you try to create another schedule with the same ID, it errors.
      scheduleId: SCHEDULE_ID,

      // ── WHEN TO FIRE ─────────────────────────────────────
      spec: {
        // Same as cronJobs.js: '59 23 * * *' = 11:59 PM every day
        // Cron format: minute hour day month weekday
        //   59   = at minute 59
        //   23   = at hour 23 (11 PM)
        //   * *  = every day, every month
        //   *    = every weekday
        cronExpressions: ['59 23 * * *'],

        // TIMEZONE: Set to 'Asia/Kolkata' (IST) so the report fires
        // at 11:59 PM IST, not 11:59 PM UTC.
        // IST = UTC + 5:30, so 11:59 PM IST = 6:29 PM UTC.
        timezone: 'Asia/Kolkata',
      },

      // ── WHAT WORKFLOW TO START ────────────────────────────
      action: {
        type: 'startWorkflow',

        // This must match the exported function name in wf4-daily-report.ts
        workflowType: 'wf4DailyReport',

        taskQueue: TASK_QUEUE,

        // WF4 should complete in well under 30 minutes.
        // If it takes longer (stuck DB query?), Temporal will cancel it.
        workflowExecutionTimeout: '30 minutes',

        // No args needed — getDailyStats() uses new Date() internally
        args: [],
      },

      // ── POLICIES ─────────────────────────────────────────
      policies: {
        // CATCH-UP WINDOW: If the server was down and missed the 11:59 PM run,
        // Temporal will catch up within 1 day of coming back online.
        // e.g. server was down for 3 hours past midnight → report still sent.
        // If server was down for MORE than 1 day, the missed report is skipped.
        catchupWindow: '1 day',

        // OVERLAP POLICY: What to do if the previous WF4 is still running
        // when the next one is supposed to start.
        // SKIP = don't start a new one, wait for next day.
        // This prevents duplicate reports if DB is slow one night.
        overlap: ScheduleOverlapPolicy.SCHEDULE_OVERLAP_POLICY_SKIP,
      },

      // ── HUMAN-READABLE DESCRIPTION ───────────────────────
      state: {
        note: 'Fires every day at 11:59 PM IST. Sends daily vehicle access summary email. Replaces cronJobs.js sendDailySummary().',
      },
    });

    console.log('');
    console.log('✅ Schedule created successfully!');
    console.log('');
    console.log(`   Schedule ID : ${SCHEDULE_ID}`);
    console.log('   Fires at    : 11:59 PM IST every day');
    console.log('   Catch-up    : 1 day window (missed runs are recovered)');
    console.log('   Workflow    : wf4DailyReport');
    console.log('');
    console.log('View it at: http://localhost:8233 → Schedules');
    console.log('');
    console.log('⚠️  You can now DISABLE the cron job in cronJobs.js:');
    console.log('   Comment out: cron.schedule("59 23 * * *", sendDailySummary)');
    console.log('');

  } catch (err: any) {
    // ── HANDLE "ALREADY EXISTS" ERROR ────────────────────────
    // If you run this script twice, Temporal throws an error.
    // We catch it here and give a helpful message instead of crashing.
    //
    // err.code === 6 = gRPC "ALREADY_EXISTS" status code
    if (err.code === 6 || err.message?.includes('already exists')) {
      console.log('');
      console.log('⚠️  Schedule already exists — nothing to do.');
      console.log('');
      console.log('To update it: delete it first in Temporal Web UI, then re-run.');
      console.log('   http://localhost:8233 → Schedules → cyber-towers-daily-report → Delete');
      console.log('');
    } else {
      // Unknown error — rethrow so we see it
      console.error('❌ Failed to create schedule:', err.message);
      throw err;
    }
  } finally {
    await connection.close();
  }
}

// Run the function
createDailyReportSchedule().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
