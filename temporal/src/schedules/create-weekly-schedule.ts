// ═══════════════════════════════════════════════════════════════
//  CREATE WEEKLY SCHEDULE — Run this ONCE to register WF5's schedule
// ═══════════════════════════════════════════════════════════════
//
//  WHAT THIS DOES:
//
//  Creates a Temporal Schedule that fires wf5WeeklyReport every
//  Monday at 07:00 AM IST (Indian Standard Time).
//
//  The schedule covers the previous 7 complete days:
//    → Runs Monday 07:00 AM IST
//    → Reports on Mon–Sun of the previous week
//
//  HOW TO RUN (run this ONCE only):
//
//    cd temporal
//    npm run create-weekly-schedule
//
//  You NEVER need to run it again. The schedule lives in Temporal Server
//  and keeps firing every Monday even if you never touch this file again.
//
//  HOW TO MANAGE THE SCHEDULE:
//    Temporal Web UI → http://localhost:8233 → Schedules
//    → "cyber-towers-weekly-report"
//    You can: pause it, trigger it manually, or delete it there.
//
//  HOW TO TRIGGER MANUALLY (for testing):
//    In the Temporal Web UI:
//      Schedules → cyber-towers-weekly-report → "Trigger Now"
//    This immediately starts one WF5 run without changing the schedule.
//
//  ALREADY EXISTS ERROR:
//    If you run this script twice, it prints a helpful message.
//    To reset: delete the schedule in the Web UI, then re-run.
//
// ═══════════════════════════════════════════════════════════════

import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

const SCHEDULE_ID = 'cyber-towers-weekly-report';
const TASK_QUEUE  = 'cyber-towers-task-queue';

async function createWeeklyReportSchedule(): Promise<void> {
  console.log('🔌 Connecting to Temporal Server...');

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const client = new Client({ connection, namespace: 'default' });

  console.log(`📅 Creating schedule: "${SCHEDULE_ID}"...`);

  try {
    await client.schedule.create({

      // ── SCHEDULE IDENTITY ────────────────────────────────────
      scheduleId: SCHEDULE_ID,

      // ── WHEN TO FIRE ─────────────────────────────────────────
      spec: {
        // '0 7 * * 1' = 7:00 AM every Monday
        //   0   = at minute 0
        //   7   = at hour 7
        //   *   = every day of the month
        //   *   = every month
        //   1   = Monday (0=Sun, 1=Mon, ..., 6=Sat)
        cronExpressions: ['0 7 * * 1'],

        // IST = UTC + 5:30, so 7:00 AM IST = 1:30 AM UTC
        // The weekly report covers Mon–Sun of the previous week.
        // Running Monday morning means the report is ready first thing.
        timezone: 'Asia/Kolkata',
      },

      // ── WHAT WORKFLOW TO START ────────────────────────────────
      action: {
        type: 'startWorkflow',

        // Must match the exported function name in wf5-weekly-report.ts
        workflowType: 'wf5WeeklyReport',

        taskQueue: TASK_QUEUE,

        // WF5 runs 8 DB queries + email — should finish in well under 30 min.
        // If it takes longer (very slow DB?), Temporal cancels it.
        workflowExecutionTimeout: '30 minutes',

        // No args needed — getWeeklyStats() uses new Date() internally
        args: [],
      },

      // ── POLICIES ─────────────────────────────────────────────
      policies: {
        // CATCH-UP WINDOW: If Temporal Server was down on Monday morning,
        // it will catch up within 3 days. So if the server comes back up
        // on Tuesday or Wednesday, the missed weekly report still runs.
        // After 3 days, the missed run is skipped (stale data not worth it).
        catchupWindow: '3 days',

        // OVERLAP POLICY: If WF5 is somehow still running when the next
        // Monday fires (shouldn't happen — WF5 completes in ~15 seconds),
        // skip starting a new one. Prevents duplicate reports.
        overlap: ScheduleOverlapPolicy.SCHEDULE_OVERLAP_POLICY_SKIP,
      },

      // ── HUMAN-READABLE DESCRIPTION ───────────────────────────
      state: {
        note: 'Fires every Monday at 07:00 AM IST. Sends weekly vehicle access analytics email covering the previous Mon-Sun week.',
      },
    });

    console.log('');
    console.log('✅ Weekly schedule created successfully!');
    console.log('');
    console.log(`   Schedule ID : ${SCHEDULE_ID}`);
    console.log('   Fires at    : Every Monday at 07:00 AM IST');
    console.log('   Covers      : Previous Mon–Sun (last 7 complete days)');
    console.log('   Catch-up    : 3-day window (missed Mondays are recovered)');
    console.log('   Workflow    : wf5WeeklyReport');
    console.log('');
    console.log('📋 View it at: http://localhost:8233 → Schedules');
    console.log('');
    console.log('🧪 To test immediately:');
    console.log('   Option A: Temporal Web UI → Schedules → cyber-towers-weekly-report → Trigger Now');
    console.log('   Option B: cd temporal && npx ts-node src/schedules/trigger-weekly-now.ts');
    console.log('');

  } catch (err: any) {
    // Handle "schedule already exists" gracefully
    if (err.code === 6 || err.message?.includes('already exists')) {
      console.log('');
      console.log('⚠️  Schedule already exists — nothing to do.');
      console.log('');
      console.log('To update it:');
      console.log('  1. Delete in Temporal Web UI: http://localhost:8233 → Schedules → cyber-towers-weekly-report → Delete');
      console.log('  2. Re-run: npm run create-weekly-schedule');
      console.log('');
    } else {
      console.error('❌ Failed to create schedule:', err.message);
      throw err;
    }
  } finally {
    await connection.close();
  }
}

createWeeklyReportSchedule().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
