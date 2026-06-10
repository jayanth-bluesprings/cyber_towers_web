// ═══════════════════════════════════════════════════════════════
//  WF7 — PARKING SLOT REAL-TIME TRACKER
// ═══════════════════════════════════════════════════════════════
//
//  WHAT IS WF7'S JOB?
//
//  Every time a vehicle is authorized and enters (WF1), TWO companion
//  workflows start in parallel:
//
//    WF2 (Overstay Monitor) ──── "is this vehicle staying too long?"
//    WF7 (Slot Tracker)     ──── "update the dashboard in real-time"
//
//  WF7 has THREE responsibilities:
//
//  1. REAL-TIME DASHBOARD UPDATES
//     When slot count changes, all open dashboard browsers update
//     instantly via WebSocket — no refresh needed.
//     e.g. "Microsoft India: 8/10 slots" → then "9/10 slots" on next entry
//
//  2. LED DISPLAY AT THE GATE
//     After each entry/exit, WF7 shows the current slot count on the
//     LED display at the gate so the security guard can see it.
//
//  3. CAPACITY WARNING EMAIL (80% threshold)
//     When a company reaches 80% of their quota, WF7 sends a
//     proactive warning email BEFORE they hit quota full (WF9 handles
//     the 100% case as a denial — WF7 warns before that happens).
//
// ═══════════════════════════════════════════════════════════════
//
//  HOW WF7 RELATES TO WF1:
//
//    WF1 is the PARENT. WF7 is the CHILD.
//    WF1 starts WF7 using startChild() (not executeChild).
//    They run at the SAME time in parallel.
//
//    When the vehicle exits:
//      1. WF1 receives the exitSignal from the backend
//      2. WF1 decrements the DB slot count
//      3. WF1 signals WF7 via vehicleExitedSignal (WF7 wakes up)
//      4. WF1 signals WF2 via cancelOverstaySignal (WF2 stops counting)
//
//  VISUAL (same as WF2 pattern):
//
//    WF1: ─[entry]─[startChild WF7]─[startChild WF2]─[sleep for exit]─[exit]─
//                         ↓
//    WF7:          ─[broadcast ENTRY]─[LED]─[warning?]─[sleep]─[broadcast EXIT]─[LED]─
//
// ═══════════════════════════════════════════════════════════════
//
//  NEW TYPESCRIPT CONCEPTS IN THIS FILE:
//
//  1. MULTIPLE proxyActivities blocks
//     You can create MULTIPLE proxy groups with DIFFERENT timeouts.
//     DB queries need 30 seconds. Emails might need 2 minutes.
//     LED/WebSocket calls need only 10 seconds (they're fast or fail fast).
//
//  2. Promise.all([...]) — parallel execution
//     Instead of:
//       await broadcastParkingUpdate(...)   // waits 2s
//       await displayOnLED(...)             // then waits 2s = 4s total
//     We do:
//       await Promise.all([
//         broadcastParkingUpdate(...),      // both start at same time
//         displayOnLED(...),                // run in parallel = 2s total
//       ]);
//     Promise.all finishes when BOTH are done.
//
//  3. Object spread: { ...input, timestamp: newValue }
//     Takes all fields from 'input' and overrides specific ones.
//     e.g. input = { cardId: "123", gate: "GATE_1", timestamp: "T1" }
//          { ...input, timestamp: "T2" }
//     →   { cardId: "123", gate: "GATE_1", timestamp: "T2" }
//     Useful when you need the same object but with one or two changed fields.
//
//  4. ! (non-null assertion)
//     TypeScript is careful — it sees exitEventData is 'null | object'
//     and warns you it MIGHT be null. But by the time we reach the exit code,
//     we KNOW it's not null (the condition already verified it).
//     The ! tells TypeScript: "I guarantee this is not null."
//     e.g. exitEventData!.timestamp  ← access timestamp, I promise it's not null
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

// import type → only TypeScript shapes. NEVER imports real Node.js modules.
// This is the Temporal rule: workflow files cannot run real code.
import type * as dbAct   from '../activities/db.activities';
import type * as gateAct from '../activities/gate.activities';
import type * as emailAct from '../activities/email.activities';
import type * as wsAct   from '../activities/websocket.activities';

// Import the signal DEFINITIONS (not types — the actual signal objects)
// These are safe to import into workflows because defineSignal() only
// creates a signal DESCRIPTOR (a plain object with a name string).
// It does NOT import any Node.js code.
import { vehicleExitedSignal } from '../shared/signals';

// Import only the TypeScript TYPE shapes (not the real code)
import type { EntryEvent, PersonnelRecord, CompanyQuota } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
//
//  We create FOUR separate proxy groups, each with its own timeout.
//  Why separate? Because different activities have different SLAs:
//    • DB query:     needs up to 30 seconds (SQL Server can be slow)
//    • LED/Gate:     should fail quickly (10s) — it's fire-and-forget
//    • Email:        can take 2 minutes (SMTP servers are slow sometimes)
//    • WebSocket:    needs only 10 seconds (HTTP to localhost)
//
//  proxyActivities<typeof actModule>({ options })
//    → Creates fake versions of all exported functions in actModule.
//    → When called in a workflow, Temporal schedules the REAL function.
//

const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const gate = wf.proxyActivities<typeof gateAct>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
});

const email = wf.proxyActivities<typeof emailAct>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts:    3,
    initialInterval:    '15 seconds',
    backoffCoefficient: 2,
  },
});

const ws = wf.proxyActivities<typeof wsAct>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
//
//  wf7ParkingSlotTracker takes THREE input arguments:
//
//  input: EntryEvent
//    → The scan data (vehicleNumber, cardId, gate, timestamp)
//    → Same data that WF1 received
//
//  personnel: PersonnelRecord
//    → Who owns this card (pName, pCode, company)
//    → WF1 looked this up and passed it to WF7
//    → So WF7 does NOT need to query the DB for personnel — it already has it
//
//  quota: CompanyQuota
//    → Slot count AT THE TIME WF1 started WF7
//    → WF7 will call db.getCompanyQuota() again to get FRESH count
//       because WF1 already called incrementCompanyCount() before starting WF7
//
export async function wf7ParkingSlotTracker(
  input:     EntryEvent,
  personnel: PersonnelRecord,
  quota:     CompanyQuota
): Promise<void> {

  // ── VARIABLE SETUP ────────────────────────────────────────
  //
  //  'let' variables because they CHANGE after the signal arrives.
  //
  //  vehicleExited: boolean = false
  //    → Starts as false. Becomes true when WF1 sends vehicleExitedSignal.
  //    → This is the "flag" that wf.condition() watches.
  //
  //  exitEventData: { timestamp: string; gate: string } | null = null
  //    → Starts as null (nothing received yet).
  //    → The '| null' means: this variable can hold EITHER the exit object
  //      OR null. TypeScript forces you to handle the null case.
  //    → Becomes the exit data object when signal arrives.
  //
  let vehicleExited  = false;
  let exitEventData: { timestamp: string; gate: string } | null = null;

  // ── SET UP SIGNAL HANDLER FIRST ───────────────────────────
  //
  //  CRITICAL RULE: setHandler must be called BEFORE any awaits.
  //
  //  WHY? Temporal can replay your workflow at any time from the start.
  //  If the signal arrives very early (e.g. vehicle exits 2 seconds after entry),
  //  the signal might be processed during the FIRST step of replay.
  //  If setHandler is placed AFTER an await, Temporal would try to process
  //  the signal before your handler is registered → signal gets DROPPED.
  //
  //  By placing setHandler at the very top (before any awaits), you guarantee
  //  the handler is always registered, no matter when the signal arrives.
  //
  //  (data) => { vehicleExited = true; exitEventData = data; }
  //    ↑ Arrow function with one parameter 'data'.
  //    The body runs when vehicleExitedSignal is received.
  //    It saves the exit timestamp + gate into our variables.
  //
  wf.setHandler(vehicleExitedSignal, (data) => {
    vehicleExited  = true;
    exitEventData  = data;
  });

  // ────────────────────────────────────────────────────────────
  //  ENTRY PHASE — runs when vehicle just entered
  // ────────────────────────────────────────────────────────────

  // ── STEP 1: Fetch fresh slot count ────────────────────────
  //
  //  WF1 called incrementCompanyCount() BEFORE starting WF7.
  //  So the DB slot count is already updated (e.g. was 7, now 8).
  //  We fetch the fresh count so we broadcast the CORRECT current number.
  //
  //  Why not just use the 'quota' parameter we received?
  //    Because 'quota' was fetched BEFORE the increment.
  //    e.g. quota.occupiedSlots = 7 (old number before this vehicle entered)
  //    But now DB shows 8. We must show 8 to the dashboard.
  //
  const currentQuota = await db.getCompanyQuota(personnel.pCode);

  // ── STEP 2: Calculate occupancy percentage ────────────────
  //
  //  Example: occupiedSlots=8, totalSlots=10
  //    8 / 10 = 0.8
  //    0.8 * 100 = 80
  //    Math.round(80) = 80 → 80%
  //
  //  Math.round() rounds to the nearest integer.
  //    e.g. 83.33 → 83, not 83.33
  //
  //  This number is used to decide whether to send a capacity warning.
  //
  const occupancyPercent = Math.round(
    (currentQuota.occupiedSlots / currentQuota.totalSlots) * 100
  );

  // ── STEP 3: Broadcast entry + update LED in parallel ──────
  //
  //  Promise.all([taskA, taskB]) = "start BOTH tasks at the same time"
  //
  //  If we did them one-by-one:
  //    await ws.broadcastParkingUpdate(...)   // 2 seconds
  //    await gate.displayOnLED(...)           // 2 seconds  → TOTAL: 4 seconds
  //
  //  With Promise.all:
  //    Both start simultaneously. Wait for BOTH to finish. → TOTAL: 2 seconds
  //
  //  The LED message: "Microsoft India: 8/10 slots used"
  //    ${personnel.company}            → "Microsoft India"
  //    ${currentQuota.occupiedSlots}   → 8
  //    ${currentQuota.totalSlots}      → 10
  //    Template literal: `text ${variable} text` = string with embedded values
  //
  await Promise.all([
    ws.broadcastParkingUpdate('ENTRY', input, personnel, currentQuota),
    gate.displayOnLED(
      input.gate,
      `${personnel.company}: ${currentQuota.occupiedSlots}/${currentQuota.totalSlots} slots used`
    ),
  ]);

  // ── STEP 4: Capacity warning email (only if >= 80%) ───────
  //
  //  >= means "greater than OR equal to"
  //  80 is the threshold — proactive warning before quota is full.
  //
  //  We only send this if the company is getting close to capacity.
  //  Examples:
  //    occupancyPercent = 60  → no email (60 < 80)
  //    occupancyPercent = 80  → send email ← threshold
  //    occupancyPercent = 90  → send email (urgent)
  //    occupancyPercent = 100 → this case CANNOT happen here
  //                             (WF9 handles 100% — WF7 only runs for authorized entries)
  //
  //  WHY NOT WRITE AUDIT LOG for this email?
  //    WF1 already writes the ENTRY_AUTHORIZED audit log.
  //    The capacity warning is a notification, not an access control event.
  //    Keeping the audit log focused on access events keeps it clean.
  //
  if (occupancyPercent >= 80) {
    await email.sendCapacityWarningEmail(personnel, currentQuota, occupancyPercent);
  }

  // ────────────────────────────────────────────────────────────
  //  WAITING PHASE — durable sleep until vehicle exits
  // ────────────────────────────────────────────────────────────

  // ── STEP 5: Wait for exit signal ──────────────────────────
  //
  //  wf.condition(() => vehicleExited)
  //
  //  This is identical to how WF2 waits. The workflow PAUSES here.
  //  The condition function is: () => vehicleExited
  //    ↑ arrow function with no parameters () that returns the boolean vehicleExited
  //  Temporal will keep checking: is vehicleExited true yet?
  //  When vehicleExitedSignal arrives, the handler sets vehicleExited = true.
  //  Temporal sees the condition is now true → workflow RESUMES.
  //
  //  NO TIMEOUT here — unlike WF2 which has escalation timers at 24h/32h/40h.
  //  WF7 can wait indefinitely. The vehicle WILL eventually exit.
  //  (If the vehicle is abandoned, WF2 escalates alerts and handles that case.)
  //
  await wf.condition(() => vehicleExited);

  // ────────────────────────────────────────────────────────────
  //  EXIT PHASE — runs after vehicle exits
  // ────────────────────────────────────────────────────────────

  // ── STEP 6: Fetch updated slot count ─────────────────────
  //
  //  Same reasoning as Step 1.
  //  WF1 called decrementCompanyCount() BEFORE signalling WF7.
  //  So the DB count is already decremented (e.g. was 8, now 7).
  //  We fetch fresh numbers so the broadcast shows correct data.
  //
  const updatedQuota = await db.getCompanyQuota(personnel.pCode);

  // ── STEP 7: Broadcast exit + update LED in parallel ───────
  //
  //  exitEventData! — the ! means "I know this is not null"
  //  Why is it definitely not null here?
  //    Because we just passed wf.condition(() => vehicleExited).
  //    vehicleExited only becomes true in the signal handler.
  //    The signal handler ALSO sets exitEventData = data.
  //    So if vehicleExited is true, exitEventData MUST be set.
  //    TypeScript doesn't know this logic — the ! tells it to trust us.
  //
  //  { ...input, timestamp: exitEventData!.timestamp, gate: exitEventData!.gate }
  //  This SPREADS the 'input' object (takes all its fields) and
  //  OVERRIDES the timestamp and gate with the EXIT values.
  //
  //  Why override timestamp?
  //    'input' has the ENTRY timestamp (when vehicle entered).
  //    We want the EXIT timestamp (when vehicle left) for the broadcast.
  //    The exit timestamp is in exitEventData.
  //
  //  Why override gate?
  //    The vehicle might enter at GATE_1 and exit at GATE_2.
  //    The exit gate is in exitEventData.gate.
  //
  await Promise.all([
    ws.broadcastParkingUpdate(
      'EXIT',
      { ...input, timestamp: exitEventData!.timestamp, gate: exitEventData!.gate },
      personnel,
      updatedQuota
    ),
    gate.displayOnLED(
      exitEventData!.gate,
      `${personnel.company}: ${updatedQuota.occupiedSlots}/${updatedQuota.totalSlots} slots used`
    ),
  ]);

  // WF7 ends here. Temporal marks it as COMPLETED.
  // Both the dashboard and LED now show the updated slot count.
}
