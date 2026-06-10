// ═══════════════════════════════════════════════════════════════
//  WF2 — OVERSTAY ALERT WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  WHAT PROBLEM DOES THIS SOLVE?
//
//  The OLD code in backend/services/cronJobs.js has this bug:
//
//    const warned24hVehicles = {};   ← stored in RAM (memory)
//
//  When the server RESTARTS (crash, deploy, reboot):
//    • warned24hVehicles becomes empty {}
//    • The cron job runs again
//    • It finds the same vehicle still inside
//    • It sends a DUPLICATE alert email
//    • The vehicle's family gets 5 emails at 3am
//
//  WF2 FIXES THIS by using Temporal's DURABLE TIMER.
//  Instead of "check every hour if a vehicle has been inside 24h",
//  we say "sleep for exactly 24 hours, then send ONE alert".
//
//  If the server crashes during the 24h sleep:
//    → Temporal notes the crash
//    → When server restarts, Temporal replays the workflow
//    → It sees "the timer started 18 hours ago"
//    → It continues sleeping for the remaining 6 hours
//    → ONE alert is sent. No duplicates. Ever.
//
// ═══════════════════════════════════════════════════════════════
//
//  HOW WF2 CONNECTS TO WF1:
//
//    WF1 starts ──────────────────────────────────────────────┐
//         ↓                                                    │
//    Vehicle enters                                           │
//         ↓                                                    │
//    WF1 starts WF2 (background — both run at same time)     │
//         ↓                     ↓                             │
//    WF1: sleeping,          WF2: sleeping 24h               │
//    waiting for exit        waiting for cancelSignal         │
//                                                              │
//    ── IF VEHICLE EXITS BEFORE 24h ──────────────────────────┘
//    WF1 wakes up (exit scan)
//    WF1 sends cancelOverstaySignal → WF2
//    WF2 receives cancel → ENDS (no email sent)
//    WF1 logs exit, ends
//
//    ── IF VEHICLE STILL INSIDE AFTER 24h ────────────────────
//    WF2 wakes up (24h timer fires)
//    WF2 sends overstay alert email
//    WF2 waits another 8h (escalation)
//    WF1 is still sleeping (vehicle still inside)
//
// ═══════════════════════════════════════════════════════════════
//
//  NEW TYPESCRIPT CONCEPT IN THIS FILE — for...of loop:
//
//    A loop that goes through each item in an array, one by one.
//
//    const fruits = ['apple', 'banana', 'cherry'];
//    for (const fruit of fruits) {
//      console.log(fruit);   // prints apple, then banana, then cherry
//    }
//
//    In WF2, we loop through an "escalation schedule" array.
//    Each item = { waitDuration, totalHours, alertLevel }
//    The loop runs 3 times: at 24h, 32h, 40h.
//
//  NEW TYPESCRIPT CONCEPT — object literal type:
//
//    { waitDuration: string; totalHours: number; alertLevel: number }
//    = an inline type definition for what each schedule item looks like
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

// import type = only TypeScript shapes, NOT the actual module
// This is required in workflow files (see wf1 explanation)
import type * as dbAct    from '../activities/db.activities';
import type * as emailAct from '../activities/email.activities';

import { cancelOverstaySignal } from '../shared/signals';
import type { EntryEvent, PersonnelRecord } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
//
//  These create "fake" versions of the activities.
//  When called, Temporal schedules the REAL function on the task queue.
//
//  startToCloseTimeout = max time an activity can take before failing
//  retry.maximumAttempts = retry up to N times on failure
//
const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const email = wf.proxyActivities<typeof emailAct>({
  startToCloseTimeout: '60 seconds',  // email can be slower
  retry: { maximumAttempts: 3 },
});

// ─── ESCALATION SCHEDULE ─────────────────────────────────────
//
//  This defines WHEN to send alerts and what level they are.
//  Think of it like a reminder schedule:
//    • After 24h inside → Level 1 warning
//    • After another 8h (32h total) → Level 2 escalation
//    • After another 8h (40h total) → Level 3 urgent
//
//  The type after the colon describes what each object in the array looks like.
//  { waitDuration: string; totalHours: number; alertLevel: number }[]
//                                                                   ↑ [] means "array of"
//
const ESCALATION_SCHEDULE: {
  waitDuration: string;
  totalHours:   number;
  alertLevel:   number;
}[] = [
  { waitDuration: '24 hours', totalHours: 24, alertLevel: 1 },  // first alert
  { waitDuration: '8 hours',  totalHours: 32, alertLevel: 2 },  // escalation
  { waitDuration: '8 hours',  totalHours: 40, alertLevel: 3 },  // urgent — final
];

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
//
//  WF2 receives the same EntryEvent and PersonnelRecord that WF1 has.
//  WF1 passes these to WF2 when it starts it (see wf1-entry-exit.ts).
//
export async function wf2OverstayAlert(
  input:     EntryEvent,      // vehicle info (card, plate, gate, time)
  personnel: PersonnelRecord  // who the vehicle belongs to (name, company)
): Promise<void> {

  // ── STEP 1: Set up the cancellation handler ───────────────
  //
  //  This runs IMMEDIATELY when WF2 starts.
  //  It says: "if cancelOverstaySignal ever arrives, set vehicleExited = true"
  //
  //  'let' is used because vehicleExited WILL change from false to true
  //  when the signal arrives. 'const' cannot change after being set.
  //
  let vehicleExited = false;

  //  setHandler(signal, callbackFunction)
  //  callbackFunction = the code that runs when the signal arrives
  //  () => { vehicleExited = true; }
  //    ↑ arrow function with no parameters (that's what the empty () means)
  //    { vehicleExited = true; } = the body — what it does
  //
  wf.setHandler(cancelOverstaySignal, () => {
    vehicleExited = true;
  });

  // ── STEP 2: Loop through the escalation schedule ──────────
  //
  //  'for (const step of ESCALATION_SCHEDULE)' means:
  //    "go through each item in ESCALATION_SCHEDULE one by one"
  //    First run:  step = { waitDuration: '24 hours', totalHours: 24, alertLevel: 1 }
  //    Second run: step = { waitDuration: '8 hours',  totalHours: 32, alertLevel: 2 }
  //    Third run:  step = { waitDuration: '8 hours',  totalHours: 40, alertLevel: 3 }
  //
  for (const step of ESCALATION_SCHEDULE) {

    // ── DURABLE SLEEP (the key fix for the cronJobs.js bug) ──
    //
    //  wf.condition(conditionFn, timeout)
    //    conditionFn = () => vehicleExited   → "stop waiting when this is true"
    //    timeout     = step.waitDuration     → "OR stop after this much time"
    //
    //  Returns:
    //    true  = condition became true (vehicle exited) — no alert needed
    //    false = timeout fired (vehicle is still inside) — send alert
    //
    //  DURABLE means: if server crashes during this sleep,
    //  Temporal continues counting from where it was on restart.
    //  THE BUG IS FIXED. No duplicate alerts. No missed alerts.
    //
    const vehicleExitedDuringWait = await wf.condition(
      () => vehicleExited,     // "is the vehicle gone yet?"
      step.waitDuration        // "wait up to this long to find out"
    );

    // ── VEHICLE EXITED BEFORE THIS ALERT THRESHOLD ───────────
    //
    //  vehicleExitedDuringWait = true means vehicle scanned exit
    //  before the timer fired. No alert needed.
    //  'return' exits the entire workflow function immediately.
    //
    if (vehicleExitedDuringWait) {
      // Vehicle left — WF2 ends silently, no alert ever sent
      return;
    }

    // ── VEHICLE IS STILL INSIDE — SEND ALERT ─────────────────
    //
    //  We reach here ONLY if the timer fired (vehicle still inside).
    //
    //  Promise.all([a, b]) = "start BOTH at the same time, wait for BOTH"
    //  This is faster than doing them one after another.
    //  The email and the audit log write happen IN PARALLEL.
    //
    await Promise.all([
      email.sendOverstayAlert(
        input,
        personnel,
        step.totalHours,   // e.g. 24 (for the subject line)
        step.alertLevel    // e.g. 1  (controls urgency colour/text)
      ),
      db.writeAuditLog({
        // AuditEventType — level 1 uses 'OVERSTAY_24H_ALERT',
        // levels 2 and 3 use 'OVERSTAY_ESCALATION'
        eventType:     step.alertLevel === 1 ? 'OVERSTAY_24H_ALERT' : 'OVERSTAY_ESCALATION',
        cardId:        input.cardId,
        vehicleNumber: input.vehicleNumber,
        gate:          input.gate,
        timestamp:     input.timestamp,
        companyCode:   personnel.pCode,
        pName:         personnel.pName,
        notes:
          `Overstay alert level ${step.alertLevel} of 3 — ` +
          `vehicle inside for ${step.totalHours}+ hours. ` +
          `Entry: ${input.timestamp}`,
      }),
    ]);

    // ── LAST ALERT SENT — WORKFLOW ENDS ──────────────────────
    //
    //  After 3 alerts (24h, 32h, 40h), we stop automated alerts.
    //  At this point security must intervene manually.
    //  The workflow ends. If vehicle is STILL inside later, it is
    //  the security team's responsibility.
    //
    if (step.alertLevel === 3) {
      // 3 alerts sent. Workflow ends. Physical action needed.
      return;
    }

    // Otherwise the for...of loop continues to the next step.
    // e.g. after alertLevel=1, it loops to alertLevel=2 (the 8h wait)
  }

  // WF2 ends here if all 3 alerts were sent without vehicle exiting
}
