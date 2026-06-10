// ═══════════════════════════════════════════════════════════════
//  WF1 — ENTRY / EXIT TRACKING WORKFLOW  (updated — includes WF2)
// ═══════════════════════════════════════════════════════════════
//
//  WHAT TEMPORAL WORKFLOWS MUST FOLLOW:
//
//  Rule 1 — NO direct I/O inside a workflow.
//    ❌ You cannot call a database, send an email, or make an HTTP request here.
//    ✅ You call an ACTIVITY which does that work for you.
//
//  Rule 2 — DETERMINISTIC only.
//    ❌ No Math.random(), no Date.now(), no random behavior.
//    ✅ Temporal replays your workflow on restart — it must produce
//       the exact same decisions every time for the same inputs.
//
//  Rule 3 — DURABLE state.
//    The workflow's state is saved by Temporal after every step.
//    If the server crashes mid-workflow, Temporal replays from the
//    last saved step — no data is lost.
//
//  NEW CONCEPT IN THIS FILE — executeChild vs startChild:
//
//    executeChild('wf3', { args })
//      → Start child workflow and WAIT for it to finish before continuing.
//      → WF1 PAUSES until WF3 is done.
//      → Used for: WF3 (unauthorized) and WF9 (quota override)
//        because WF1 has nothing else to do in those cases.
//
//    startChild('wf2', { args })
//      → Start child workflow and CONTINUE immediately. Don't wait.
//      → WF1 and WF2 run at the SAME TIME (in parallel).
//      → Used for: WF2 (overstay) because WF1 must continue sleeping
//        for the exit while WF2 independently counts the 24h timer.
//
//  VISUAL:
//    WF1: ──[entry]──[startChild WF2]──[sleep for exit]──[exit]──
//                           ↓
//    WF2:            ──[sleep 24h]──[alert if no cancel]──
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

// import type → only TypeScript shapes, NOT the actual Node.js code
// This is REQUIRED in workflows — you cannot import real Node modules here
import type * as dbAct   from '../activities/db.activities';
import type * as gateAct from '../activities/gate.activities';

import { exitSignal, cancelOverstaySignal, vehicleExitedSignal } from '../shared/signals';
import type { EntryEvent } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
//
//  proxyActivities<T>({ timeouts }) creates FAKE versions of the
//  activity functions. When called, Temporal schedules the REAL
//  function to run in the activity worker.
//
//  startToCloseTimeout = "if activity doesn't finish in X time, FAIL it"
//  retry.maximumAttempts = "try this many times before giving up"
//
const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const gate = wf.proxyActivities<typeof gateAct>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 5 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
//
//  export async function = this workflow is exported so the worker
//  can register it. 'async' means it can use 'await'.
//
//  input: EntryEvent = the data this workflow receives when started.
//    e.g. { cardId: "5248003", vehicleNumber: "TS09AB1234", gate: "GATE_1", ... }
//
//  Promise<void> = this workflow finishes without returning a value
//
export async function wf1EntryExit(input: EntryEvent): Promise<void> {

  // ── SIGNAL HANDLERS — must be set BEFORE any awaits ───────
  //
  //  Temporal rule: register ALL signal handlers at the very top of the
  //  workflow function, before the first await. This guarantees the handler
  //  is always in place no matter when the signal arrives.
  //
  //  If setHandler is placed AFTER an await and the signal arrives while
  //  an activity is running, Temporal buffers it. On replay the buffered
  //  signal may fire before the handler is registered, resulting in
  //  `data = undefined` being passed — which causes downstream crashes.
  //
  let exitData: { timestamp: string; gate: string } | undefined;

  wf.setHandler(exitSignal, (data) => {
    exitData = data;
  });

  // ── STEP 1: Lookup who owns this card ─────────────────────
  // Calls the lookupPersonnel ACTIVITY (runs the SQL query).
  // The workflow pauses here until the activity returns.
  const personnel = await db.lookupPersonnel(input.cardId);

  // ── STEP 2: Is this vehicle authorized? ───────────────────
  // Authorized = PCode is present and not empty or '-'
  // Unauthorized = no record found, or PCode is blank/'-'
  const isAuthorized =
    personnel !== null &&
    personnel.pCode.length > 0 &&
    personnel.pCode !== '-';

  if (!isAuthorized) {
    // ── UNAUTHORIZED PATH ──────────────────────────────────
    //
    //  executeChild = "start WF3 and WAIT for it to complete"
    //  WF1 pauses here until WF3 finishes (security approves/denies).
    //  WF3 handles: block gate → alert security → wait for decision.
    //
    //  workflowId is deterministic (cardId + timestamp) so the simulate
    //  script and test runner can predict it and send signals correctly.
    //  Uses input.timestamp (not Date.now) to stay deterministic on replay.
    //
    await wf.executeChild('wf3UnauthorizedApproval', {
      args:                    [input],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf3-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      workflowExecutionTimeout: '30 minutes',
    });
    return; // WF1 ends here for unauthorized vehicles
  }

  // ── STEP 3: Check company parking quota ───────────────────
  // Only for authorized vehicles — does their company have free slots?
  const quota = await db.getCompanyQuota(personnel.pCode);

  const isQuotaFull = quota.occupiedSlots >= quota.totalSlots;

  if (isQuotaFull) {
    // ── QUOTA FULL PATH ────────────────────────────────────
    //
    //  executeChild = "start WF9 and WAIT for it to complete"
    //  WF9 handles: block gate → email admin → wait for override.
    //
    //  workflowId is deterministic (cardId + timestamp) so override
    //  signals from the dashboard/simulate script can reach WF9 directly.
    //
    await wf.executeChild('wf9QuotaOverride', {
      args:                    [input, personnel, quota],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf9-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      workflowExecutionTimeout: '30 minutes',
    });
    return; // WF1 ends here when quota is full
  }

  // ── STEP 4: ALLOW ENTRY — Open the gate ───────────────────
  // At this point: vehicle is authorized AND company has free slots.
  await gate.openGate(input.gate, input.vehicleNumber);
  await db.incrementCompanyCount(personnel.pCode);
  await db.writeAuditLog({
    eventType:     'ENTRY_AUTHORIZED',
    cardId:        input.cardId,
    vehicleNumber: input.vehicleNumber,
    gate:          input.gate,
    timestamp:     input.timestamp,
    companyCode:   personnel.pCode,
    pName:         personnel.pName,
  });

  // ── STEP 5: START WF2 — Begin overstay monitoring ─────────
  //
  //  startChild (NOT executeChild) — WF1 does NOT wait for WF2.
  //  Both run in parallel at the same time.
  //
  //  WF1 continues to STEP 6 immediately while WF2 starts sleeping.
  //  WF2 counts 24 hours independently in the background.
  //
  //  ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON means:
  //    "If WF1 ends or crashes, let WF2 continue running independently."
  //    WF2 does NOT die just because WF1 ended.
  //    This is important — WF2 must keep counting even after WF1 ends.
  //
  //  workflowId for WF2 uses input.timestamp (not Date.now!) because:
  //    - Workflows must be DETERMINISTIC
  //    - Date.now() would give a different value on each replay
  //    - input.timestamp is fixed — same value every replay
  //
  const wf2Handle = await wf.startChild('wf2OverstayAlert', {
    args: [input, personnel],
    taskQueue:               'cyber-towers-task-queue',
    workflowId:              `wf2-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
    parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    workflowExecutionTimeout: '48 hours', // WF2 max runtime (3 alerts at 24h+8h+8h = 40h)
  });

  // ── STEP 5b: START WF7 — Real-time slot tracker ────────────
  //
  //  WF7 runs at the SAME TIME as WF2 — both are started with startChild
  //  and both use PARENT_CLOSE_POLICY_ABANDON so they keep running
  //  even if WF1 ends or crashes.
  //
  //  WF7 receives: input (entry data), personnel (who), quota (slot count)
  //  quota is the pre-increment value — WF7 will re-fetch from DB internally.
  //
  const wf7Handle = await wf.startChild('wf7ParkingSlotTracker', {
    args: [input, personnel, quota],
    taskQueue:               'cyber-towers-task-queue',
    workflowId:              `wf7-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
    parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    workflowExecutionTimeout: '72 hours', // WF7 waits for exit — vehicle may stay overnight
  });

  // ── STEP 6: DURABLE SLEEP — Wait for exit ─────────────────
  //
  //  The workflow SLEEPS here until exitSignal arrives.
  //  Handler was registered at the top so no signal can be missed.
  //
  //  IMPORTANT: use != null (loose) not !== null (strict).
  //  Loose != catches BOTH null AND undefined, so even if the signal
  //  somehow delivers an undefined payload, we don't proceed with bad data.
  //
  await wf.condition(() => exitData != null);

  // ── STEP 7: Decrement slot count FIRST ───────────────────
  //
  //  IMPORTANT ORDERING:
  //    decrementCompanyCount() is called BEFORE signalling WF7.
  //    Why? Because WF7 calls db.getCompanyQuota() when it wakes up.
  //    If we signal WF7 before decrementing, WF7 would see the OLD count
  //    (still showing the vehicle as inside) and broadcast wrong data.
  //
  //    Correct order:
  //      1. Decrement DB count (slot freed)
  //      2. Signal WF7 (now WF7 fetches the already-decremented count)
  //      3. Signal WF2 (cancel overstay monitoring — order doesn't matter)
  //      4. Write audit log
  //
  await db.decrementCompanyCount(personnel.pCode);

  // ── STEP 8: Signal WF7 — Vehicle exited, broadcast exit ───
  //
  //  wf7Handle.signal(vehicleExitedSignal, exitData!)
  //    → Sends vehicleExitedSignal INTO the WF7 workflow instance.
  //    → WF7's setHandler fires: vehicleExited = true, exitEventData = data
  //    → WF7 wakes from wf.condition() and does the exit broadcast + LED update
  //
  //  We pass exitData! (not null — we already checked via wf.condition)
  //  The ! tells TypeScript "this is not null, I'm sure".
  //
  await wf7Handle.signal(vehicleExitedSignal, exitData!);

  // ── STEP 9: Signal WF2 — Cancel overstay monitoring ───────
  //
  //  Vehicle exited — no need to monitor for overstay anymore.
  //  WF2 receives cancelOverstaySignal, sets vehicleExited=true, ends.
  //
  await wf2Handle.signal(cancelOverstaySignal);

  // ── STEP 10: Write final audit log ───────────────────────
  await db.writeAuditLog({
    eventType:     'VEHICLE_EXIT',
    cardId:        input.cardId,
    vehicleNumber: input.vehicleNumber,
    gate:          exitData!.gate,
    timestamp:     exitData!.timestamp,
    companyCode:   personnel.pCode,
    pName:         personnel.pName,
    notes:         `Entry: ${input.timestamp} | Exit: ${exitData!.timestamp}`,
  });

  // WF1 ends naturally here — Temporal marks it as COMPLETED
}
